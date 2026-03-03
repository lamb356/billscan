import { getDb } from '../db/connection.js';
import type { CLFSRate } from './clfs-parser.js';
import type { ASPRate } from './asp-parser.js';
import type { OPPSRate } from './opps-parser.js';

interface ImportResult {
  snapshotId: number;
  rowCount: number;
  cached: boolean;
}

function checkCache(sourceType: string, effectiveYear: number): ImportResult | null {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id, row_count FROM data_snapshots
    WHERE source_type = ? AND effective_year = ?
      AND datetime(fetched_at) > datetime('now', '-90 days')
    ORDER BY fetched_at DESC LIMIT 1
  `).get(sourceType, effectiveYear) as { id: number; row_count: number } | undefined;

  if (existing) return { snapshotId: existing.id, rowCount: existing.row_count, cached: true };
  return null;
}

function createSnapshot(sourceType: string, sourceUrl: string, effectiveYear: number, quarter: string | null, dataHash: string, fileName: string): number {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO data_snapshots (source_type, source_url, effective_year, effective_quarter, fetched_at, data_hash, row_count, file_name)
    VALUES (?, ?, ?, ?, datetime('now'), ?, 0, ?)
  `).run(sourceType, sourceUrl, effectiveYear, quarter, dataHash, fileName);
  return Number(r.lastInsertRowid);
}

function updateSnapshotCount(snapshotId: number, count: number): void {
  const db = getDb();
  db.prepare(`UPDATE data_snapshots SET row_count = ? WHERE id = ?`).run(count, snapshotId);
}

export function importClfsRates(
  rates: CLFSRate[], sourceUrl: string, effectiveYear: number, rawHash: string, fileName: string
): ImportResult {
  const cached = checkCache('clfs', effectiveYear);
  if (cached) { console.log(`[clfs-import] Using cached snapshot #${cached.snapshotId} (${cached.rowCount} rates)`); return cached; }

  const db = getDb();
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -32000');

  const snapshotId = createSnapshot('clfs', sourceUrl, effectiveYear, 'Q1', rawHash, fileName);
  const insert = db.prepare(`INSERT INTO clfs_rates (snapshot_id, hcpcs_code, modifier, rate, short_desc, long_desc, indicator, effective_date, effective_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const BATCH = 2000;
  for (let i = 0; i < rates.length; i += BATCH) {
    const batch = rates.slice(i, i + BATCH);
    const txn = db.transaction(() => { for (const r of batch) insert.run(snapshotId, r.hcpcsCode, r.modifier, r.rate, r.shortDesc, r.longDesc, r.indicator, r.effectiveDate, r.effectiveYear); });
    txn();
  }

  updateSnapshotCount(snapshotId, rates.length);
  db.pragma('synchronous = FULL');
  console.log(`[clfs-import] Imported ${rates.length} CLFS rates into snapshot #${snapshotId}`);
  return { snapshotId, rowCount: rates.length, cached: false };
}

export function importAspRates(
  rates: ASPRate[], sourceUrl: string, effectiveYear: number, rawHash: string, fileName: string
): ImportResult {
  const cached = checkCache('asp', effectiveYear);
  if (cached) { console.log(`[asp-import] Using cached snapshot #${cached.snapshotId} (${cached.rowCount} rates)`); return cached; }

  const db = getDb();
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -32000');

  const snapshotId = createSnapshot('asp', sourceUrl, effectiveYear, 'Q1', rawHash, fileName);
  const insert = db.prepare(`INSERT INTO asp_rates (snapshot_id, hcpcs_code, short_desc, dosage, payment_limit, coinsurance_pct, vaccine_awp_pct, vaccine_limit, blood_awp_pct, blood_limit, clotting_factor, notes, effective_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const txn = db.transaction(() => { for (const r of rates) insert.run(snapshotId, r.hcpcsCode, r.shortDesc, r.dosage, r.paymentLimit, r.coinsurancePct, r.vaccineAwpPct, r.vaccineLimit, r.bloodAwpPct, r.bloodLimit, r.clottingFactor, r.notes, r.effectiveYear); });
  txn();

  updateSnapshotCount(snapshotId, rates.length);
  db.pragma('synchronous = FULL');
  console.log(`[asp-import] Imported ${rates.length} ASP rates into snapshot #${snapshotId}`);
  return { snapshotId, rowCount: rates.length, cached: false };
}

export function importOppsRates(
  rates: OPPSRate[], sourceUrl: string, effectiveYear: number, rawHash: string, fileName: string
): ImportResult {
  const cached = checkCache('opps', effectiveYear);
  if (cached) { console.log(`[opps-import] Using cached snapshot #${cached.snapshotId} (${cached.rowCount} rates)`); return cached; }

  const db = getDb();
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -32000');

  const snapshotId = createSnapshot('opps', sourceUrl, effectiveYear, 'Q1', rawHash, fileName);
  const insert = db.prepare(`INSERT INTO opps_rates (snapshot_id, hcpcs_code, short_desc, status_indicator, apc, relative_weight, payment_rate, national_copay, min_copay, effective_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const BATCH = 5000;
  for (let i = 0; i < rates.length; i += BATCH) {
    const batch = rates.slice(i, i + BATCH);
    const txn = db.transaction(() => { for (const r of batch) insert.run(snapshotId, r.hcpcsCode, r.shortDesc, r.statusIndicator, r.apc, r.relativeWeight, r.paymentRate, r.nationalCopay, r.minCopay, r.effectiveYear); });
    txn();
  }

  updateSnapshotCount(snapshotId, rates.length);
  db.pragma('synchronous = FULL');
  console.log(`[opps-import] Imported ${rates.length} OPPS rates into snapshot #${snapshotId}`);
  return { snapshotId, rowCount: rates.length, cached: false };
}
