/**
 * import-zip-locality.ts
 *
 * Imports the full CMS ZIP Code to Carrier Locality File into billscan.db.
 *
 * Source: https://www.cms.gov/medicare/payment/fee-schedules
 *   File: ZIP Code to Carrier Locality File – Revised 02/18/2026
 *   Data file: data/cms-downloads/zip-locality-2026/ZIP5_APR2026.txt
 *
 * Usage:
 *   cd /home/user/workspace/billscan && npx tsx scripts/import-zip-locality.ts
 *
 * What it does:
 *   1. Parses the CMS ZIP5 fixed-width file (~43K records)
 *   2. Clears the existing zip_locality table
 *   3. Bulk-inserts all records via a transaction
 *   4. Reports counts and sample data
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseZipLocalityFileSync } from '../src/collector/zip-locality-parser.js';

const ZIP5_FILE = resolve('data/cms-downloads/zip-locality-2026/ZIP5_APR2026.txt');
const DB_PATH   = resolve('data/billscan.db');

async function main(): Promise<void> {
  console.log('=== BillScan: CMS ZIP-to-Locality Import ===');
  console.log(`Source file: ${ZIP5_FILE}`);
  console.log(`Database:    ${DB_PATH}`);
  console.log('');

  const start = Date.now();

  // ── 1. Parse the CMS file ───────────────────────────────────────────
  console.log('Parsing CMS ZIP5 file...');
  const records = parseZipLocalityFileSync(ZIP5_FILE);
  console.log(`  Parsed ${records.length.toLocaleString()} records`);

  if (records.length === 0) {
    console.error('ERROR: No records parsed. Check the source file path.');
    process.exit(1);
  }

  // ── 2. Open DB and ensure schema ──────────────────────────────────────────
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');

  // Add urban_rural column if it doesn't exist (migration)
  try {
    db.exec(`ALTER TABLE zip_locality ADD COLUMN urban_rural TEXT;`);
    console.log('  Added urban_rural column to zip_locality table.');
  } catch {
    // Column already exists – that's fine
  }

  // ── 3. Clear existing data ────────────────────────────────────────────
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM zip_locality').get() as { c: number }).c;
  console.log(`\nClearing existing zip_locality table (${existingCount} seed entries)...`);
  db.exec('DELETE FROM zip_locality;');
  console.log('  Cleared.');

  // ── 4. Bulk insert ────────────────────────────────────────────────
  console.log('\nImporting records...');

  const insert = db.prepare(`
    INSERT OR REPLACE INTO zip_locality
      (zip_code, carrier, locality, state, county_name, urban_rural)
    VALUES
      (@zip_code, @carrier, @locality, @state, @county_name, @urban_rural)
  `);

  // Use a transaction for speed (single commit for all ~43K rows)
  const insertMany = db.transaction((rows: typeof records) => {
    for (const rec of rows) {
      insert.run({
        zip_code:    rec.zip_code,
        carrier:     rec.carrier,
        locality:    rec.locality,
        state:       rec.state,
        // county_name is not in the ZIP5 file — set to NULL
        county_name: null,
        // Map CMS rural indicator: U=urban(blank), R=rural, B=super rural
        urban_rural: rec.urban_rural_indicator,
      });
    }
  });

  insertMany(records);

  // ── 5. Verify ─────────────────────────────────────────────────────────────
  const newCount = (db.prepare('SELECT COUNT(*) as c FROM zip_locality').get() as { c: number }).c;
  const elapsed  = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n✓ Import complete in ${elapsed}s`);
  console.log(`  Records inserted: ${newCount.toLocaleString()}`);

  // Distribution by state
  const byState = db.prepare(`
    SELECT state, COUNT(*) as cnt
    FROM zip_locality
    GROUP BY state
    ORDER BY cnt DESC
    LIMIT 10
  `).all() as Array<{ state: string; cnt: number }>;

  console.log('\nTop 10 states by ZIP count:');
  for (const row of byState) {
    console.log(`  ${row.state.padEnd(4)} ${row.cnt.toString().padStart(5)}`);
  }

  // Distribution by urban/rural
  const byRural = db.prepare(`
    SELECT urban_rural, COUNT(*) as cnt
    FROM zip_locality
    GROUP BY urban_rural
    ORDER BY cnt DESC
  `).all() as Array<{ urban_rural: string; cnt: number }>;

  console.log('\nRural indicator breakdown:');
  const ruralLabels: Record<string, string> = { U: 'Urban', R: 'Rural', B: 'Super Rural (Low Density)' };
  for (const row of byRural) {
    const label = ruralLabels[row.urban_rural] ?? row.urban_rural;
    console.log(`  ${label.padEnd(28)} ${row.cnt.toString().padStart(6)}`);
  }

  // Sample records
  const samples = db.prepare(`
    SELECT zip_code, carrier, locality, state, urban_rural
    FROM zip_locality
    ORDER BY state, zip_code
    LIMIT 5
  `).all() as Array<{ zip_code: string; carrier: string; locality: string; state: string; urban_rural: string }>;

  console.log('\nSample records:');
  for (const s of samples) {
    console.log(
      `  ZIP=${s.zip_code} carrier=${s.carrier} locality=${s.locality} ` +
      `state=${s.state} urban_rural=${s.urban_rural}`
    );
  }

  // Known good spot-check
  const nyc = db.prepare(`SELECT * FROM zip_locality WHERE zip_code = '10001'`).get() as any;
  if (nyc) {
    console.log(`\nSpot-check 10001 (Manhattan): carrier=${nyc.carrier} locality=${nyc.locality} state=${nyc.state}`);
  } else {
    console.log('\nWARN: ZIP 10001 not found in imported data');
  }

  const la = db.prepare(`SELECT * FROM zip_locality WHERE zip_code = '90001'`).get() as any;
  if (la) {
    console.log(`Spot-check 90001 (Los Angeles): carrier=${la.carrier} locality=${la.locality} state=${la.state}`);
  }

  db.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
