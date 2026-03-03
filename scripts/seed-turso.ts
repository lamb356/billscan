/**
 * Seed Turso database from local SQLite data.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npx tsx scripts/seed-turso.ts
 *
 * This script:
 * 1. Reads all data from the local SQLite file (data/billscan.db)
 * 2. Runs migrations on Turso
 * 3. Inserts all CMS rate data in batches
 * 4. Imports ZIP locality mappings
 * 5. Imports charity care hospital data
 * 6. Logs totals when done
 */

import { createClient, type Client } from '@libsql/client';

const LOCAL_DB_PATH = 'file:data/billscan.db';
const BATCH_SIZE = 200; // libsql batch limit is lower than SQLite transactions

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl || !tursoToken) {
    console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variables.');
    console.error('Usage: TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npx tsx scripts/seed-turso.ts');
    process.exit(1);
  }

  console.log('=== BillScan Turso Seeder ===\n');

  // Connect to both databases
  const local = createClient({ url: LOCAL_DB_PATH });
  const turso = createClient({ url: tursoUrl, authToken: tursoToken });

  console.log('Connected to local SQLite and Turso.\n');

  // 1. Run migrations on Turso
  console.log('[1/7] Running migrations on Turso...');
  const { runMigrations } = await import('../src/db/migrations.js');
  // Temporarily point getDb to Turso
  process.env.TURSO_DATABASE_URL = tursoUrl;
  process.env.TURSO_AUTH_TOKEN = tursoToken;
  // We need to re-import to pick up the env vars, but migrations.ts uses getDb()
  // Instead, run the migration SQL directly
  await runMigrationsOnClient(turso);
  console.log('  Migrations complete.\n');

  // 2. Check if Turso already has data
  const existingCount = (await turso.execute({ sql: 'SELECT COUNT(*) as c FROM cms_rates', args: [] })).rows[0].c as number;
  if (existingCount > 0) {
    console.log(`  Turso already has ${existingCount.toLocaleString()} CMS rates.`);
    console.log('  Skipping data import. Use --force to re-import.\n');
    if (!process.argv.includes('--force')) {
      await printTotals(turso);
      local.close();
      turso.close();
      return;
    }
    console.log('  --force flag detected. Continuing with import...\n');
  }

  // 3. Seed cms_snapshots
  console.log('[2/7] Copying cms_snapshots...');
  await copyTable(local, turso, 'cms_snapshots', [
    'id', 'source_url', 'effective_year', 'fetched_at', 'data_hash', 'row_count', 'file_name', 'created_at'
  ]);

  // 4. Seed cms_rates (the big one: ~1M rows)
  console.log('[3/7] Copying cms_rates (this takes a few minutes)...');
  await copyTable(local, turso, 'cms_rates', [
    'id', 'snapshot_id', 'cpt_code', 'modifier', 'description', 'facility_rate',
    'non_facility_rate', 'locality', 'locality_name', 'status_indicator', 'effective_year', 'created_at'
  ]);

  // 5. Seed CLFS rates
  console.log('[4/7] Copying clfs_rates...');
  await copyTable(local, turso, 'clfs_rates', [
    'id', 'snapshot_id', 'hcpcs_code', 'modifier', 'rate', 'short_desc',
    'long_desc', 'indicator', 'effective_date', 'effective_year', 'created_at'
  ]);

  // 6. Seed ASP rates
  console.log('[5/7] Copying asp_rates...');
  await copyTable(local, turso, 'asp_rates', [
    'id', 'snapshot_id', 'hcpcs_code', 'short_desc', 'dosage', 'payment_limit',
    'coinsurance_pct', 'vaccine_awp_pct', 'vaccine_limit', 'blood_awp_pct',
    'blood_limit', 'clotting_factor', 'notes', 'effective_year', 'created_at'
  ]);

  // 7. Seed OPPS rates
  console.log('[6/7] Copying opps_rates...');
  await copyTable(local, turso, 'opps_rates', [
    'id', 'snapshot_id', 'hcpcs_code', 'short_desc', 'status_indicator', 'apc',
    'relative_weight', 'payment_rate', 'national_copay', 'min_copay', 'effective_year', 'created_at'
  ]);

  // 8. Seed ZIP locality
  console.log('[7/7] Copying zip_locality and charity_hospitals...');
  await copyTable(local, turso, 'zip_locality', [
    'zip_code', 'carrier', 'locality', 'state', 'county_name'
  ]);
  await copyTable(local, turso, 'charity_hospitals', [
    'ein', 'name', 'city', 'state', 'zip_code', 'fap_url', 'last_updated'
  ]);

  // Also copy data_snapshots if they exist
  try {
    await copyTable(local, turso, 'data_snapshots', [
      'id', 'source_type', 'source_url', 'effective_year', 'effective_quarter',
      'fetched_at', 'data_hash', 'row_count', 'file_name', 'created_at'
    ]);
  } catch {
    console.log('  (data_snapshots table not found locally — skipping)');
  }

  await printTotals(turso);

  local.close();
  turso.close();
  console.log('\nDone. Turso is seeded and ready for production.');
}

async function copyTable(
  source: Client,
  dest: Client,
  tableName: string,
  columns: string[],
): Promise<void> {
  const countResult = await source.execute({ sql: `SELECT COUNT(*) as c FROM ${tableName}`, args: [] });
  const totalRows = countResult.rows[0].c as number;
  console.log(`  ${tableName}: ${totalRows.toLocaleString()} rows to copy`);

  if (totalRows === 0) return;

  const colList = columns.join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const insertSql = `INSERT OR IGNORE INTO ${tableName} (${colList}) VALUES (${placeholders})`;

  let offset = 0;
  let inserted = 0;

  while (offset < totalRows) {
    const batch = await source.execute({
      sql: `SELECT ${colList} FROM ${tableName} LIMIT ${BATCH_SIZE} OFFSET ${offset}`,
      args: [],
    });

    if (batch.rows.length === 0) break;

    const stmts = batch.rows.map(row => ({
      sql: insertSql,
      args: columns.map(col => (row as any)[col] ?? null),
    }));

    await dest.batch(stmts);

    inserted += batch.rows.length;
    offset += BATCH_SIZE;

    if (inserted % 10000 === 0 || inserted === totalRows) {
      console.log(`    ${inserted.toLocaleString()} / ${totalRows.toLocaleString()} (${Math.round(inserted / totalRows * 100)}%)`);
    }
  }
}

async function printTotals(db: Client): Promise<void> {
  console.log('\n=== Turso Database Totals ===');
  const tables = ['cms_rates', 'clfs_rates', 'asp_rates', 'opps_rates', 'zip_locality', 'charity_hospitals'];
  for (const table of tables) {
    try {
      const r = await db.execute({ sql: `SELECT COUNT(*) as c FROM ${table}`, args: [] });
      console.log(`  ${table}: ${(r.rows[0].c as number).toLocaleString()}`);
    } catch {
      console.log(`  ${table}: (not found)`);
    }
  }
}

async function runMigrationsOnClient(db: Client): Promise<void> {
  // Run the same migration SQL as src/db/migrations.ts but against a specific client
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS cms_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, source_url TEXT NOT NULL, effective_year INTEGER NOT NULL, fetched_at TEXT NOT NULL, data_hash TEXT NOT NULL, row_count INTEGER NOT NULL, file_name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS cms_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_id INTEGER NOT NULL, cpt_code TEXT NOT NULL, modifier TEXT, description TEXT, facility_rate REAL, non_facility_rate REAL, locality TEXT, locality_name TEXT, status_indicator TEXT, effective_year INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt ON cms_rates(cpt_code)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt_mod ON cms_rates(cpt_code, modifier)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_cms_rates_cpt_loc ON cms_rates(cpt_code, locality)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT UNIQUE NOT NULL, input_hash TEXT NOT NULL, snapshot_id INTEGER, total_billed REAL, total_cms REAL, total_savings REAL, finding_count INTEGER, report_json TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS clfs_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_id INTEGER NOT NULL, hcpcs_code TEXT NOT NULL, modifier TEXT, rate REAL, short_desc TEXT, long_desc TEXT, indicator TEXT, effective_date TEXT, effective_year INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_clfs_hcpcs ON clfs_rates(hcpcs_code)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_clfs_hcpcs_mod ON clfs_rates(hcpcs_code, modifier)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS asp_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_id INTEGER NOT NULL, hcpcs_code TEXT NOT NULL, short_desc TEXT, dosage TEXT, payment_limit REAL, coinsurance_pct REAL, vaccine_awp_pct REAL, vaccine_limit REAL, blood_awp_pct REAL, blood_limit REAL, clotting_factor TEXT, notes TEXT, effective_year INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_asp_hcpcs ON asp_rates(hcpcs_code)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS opps_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_id INTEGER NOT NULL, hcpcs_code TEXT NOT NULL, short_desc TEXT, status_indicator TEXT, apc TEXT, relative_weight REAL, payment_rate REAL, national_copay REAL, min_copay REAL, effective_year INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_opps_hcpcs ON opps_rates(hcpcs_code)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS data_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL, source_url TEXT NOT NULL, effective_year INTEGER NOT NULL, effective_quarter TEXT, fetched_at TEXT NOT NULL, data_hash TEXT NOT NULL, row_count INTEGER NOT NULL, file_name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS zip_locality (zip_code TEXT NOT NULL, carrier TEXT, locality TEXT NOT NULL, state TEXT, county_name TEXT, urban_rural TEXT, PRIMARY KEY (zip_code))`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_zip_locality_zip ON zip_locality(zip_code)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS charity_hospitals (ein TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT, state TEXT, zip_code TEXT, fap_url TEXT, last_updated TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_charity_state ON charity_hospitals(state)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_charity_zip ON charity_hospitals(zip_code)`, args: [] },
  ]);

  // Phase 3: users table and audits.user_id column
  try {
    await db.execute({ sql: `ALTER TABLE audits ADD COLUMN user_id TEXT`, args: [] });
  } catch { /* already exists */ }

  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, image TEXT, plan TEXT DEFAULT 'free', stripe_customer_id TEXT, stripe_subscription_id TEXT, audit_count INTEGER DEFAULT 0, audit_reset_at TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_audits_user ON audits(user_id)`, args: [] },
  ]);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
