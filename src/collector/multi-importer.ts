import { getDb } from '../db/connection.js';
import type { CLFSRate } from './clfs-parser.js';
import type { ASPRate } from './asp-parser.js';
import type { OPPSRate } from './opps-parser.js';

export interface ImportResult {
  snapshotId: number;
  rowCount: number;
  cached: boolean;
}

export function importClfsRates(
  rates: CLFSRate[],
  sourceUrl: string,
  effectiveYear: number,
  rawHash: string,
  fileName: string,
): ImportResult {
  const db = getDb();

  // Check if already imported
  const existing = db.prepare(
    `SELECT id FROM cms_snapshots WHERE data_hash = ?`
  ).get(rawHash) as { id: number } | undefined;

  if (existing) {
    const rowCount = db.prepare(
      `SELECT COUNT(*) as c FROM clfs_rates WHERE snapshot_id = ?`
    ).get(existing.id) as { c: number };
    return { snapshotId: existing.id, rowCount: rowCount.c, cached: true };
  }

  const result = db.prepare(`
    INSERT INTO cms_snapshots (source_url, file_name, effective_year, data_hash)
    VALUES (?, ?, ?, ?)
  `).run(sourceUrl, fileName, effectiveYear, rawHash);

  const snapshotId = result.lastInsertRowid as number;

  const insertRate = db.prepare(`
    INSERT INTO clfs_rates
      (snapshot_id, hcpcs_code, modifier, eff_date, indicator, rate, short_desc, long_desc, effective_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rates: CLFSRate[]) => {
    for (const r of rates) {
      insertRate.run(
        snapshotId, r.hcpcsCode, r.modifier, r.effDate, r.indicator, r.rate,
        r.shortDesc, r.longDesc, r.effectiveYear
      );
    }
  });

  insertMany(rates);
  return { snapshotId, rowCount: rates.length, cached: false };
}

export function importAspRates(
  rates: ASPRate[],
  sourceUrl: string,
  effectiveYear: number,
  rawHash: string,
  fileName: string,
): ImportResult {
  const db = getDb();

  const existing = db.prepare(
    `SELECT id FROM cms_snapshots WHERE data_hash = ?`
  ).get(rawHash) as { id: number } | undefined;

  if (existing) {
    const rowCount = db.prepare(
      `SELECT COUNT(*) as c FROM asp_rates WHERE snapshot_id = ?`
    ).get(existing.id) as { c: number };
    return { snapshotId: existing.id, rowCount: rowCount.c, cached: true };
  }

  const result = db.prepare(`
    INSERT INTO cms_snapshots (source_url, file_name, effective_year, data_hash)
    VALUES (?, ?, ?, ?)
  `).run(sourceUrl, fileName, effectiveYear, rawHash);

  const snapshotId = result.lastInsertRowid as number;

  const insertRate = db.prepare(`
    INSERT INTO asp_rates
      (snapshot_id, hcpcs_code, short_desc, dosage, payment_limit,
       coinsurance_pct, vaccine_awp_pct, vaccine_limit,
       blood_awp_pct, blood_limit, clotting_factor, notes, effective_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rates: ASPRate[]) => {
    for (const r of rates) {
      insertRate.run(
        snapshotId, r.hcpcsCode, r.shortDesc, r.dosage, r.paymentLimit,
        r.coinsurancePct, r.vaccineAwpPct, r.vaccineLimit,
        r.bloodAwpPct, r.bloodLimit, r.clottingFactor, r.notes, r.effectiveYear
      );
    }
  });

  insertMany(rates);
  return { snapshotId, rowCount: rates.length, cached: false };
}

export function importOppsRates(
  rates: OPPSRate[],
  sourceUrl: string,
  effectiveYear: number,
  rawHash: string,
  fileName: string,
): ImportResult {
  const db = getDb();

  const existing = db.prepare(
    `SELECT id FROM cms_snapshots WHERE data_hash = ?`
  ).get(rawHash) as { id: number } | undefined;

  if (existing) {
    const rowCount = db.prepare(
      `SELECT COUNT(*) as c FROM opps_rates WHERE snapshot_id = ?`
    ).get(existing.id) as { c: number };
    return { snapshotId: existing.id, rowCount: rowCount.c, cached: true };
  }

  const result = db.prepare(`
    INSERT INTO cms_snapshots (source_url, file_name, effective_year, data_hash)
    VALUES (?, ?, ?, ?)
  `).run(sourceUrl, fileName, effectiveYear, rawHash);

  const snapshotId = result.lastInsertRowid as number;

  const insertRate = db.prepare(`
    INSERT INTO opps_rates
      (snapshot_id, hcpcs_code, short_desc, apc, si, relative_weight, payment_rate,
       min_unadjusted, notes, effective_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rates: OPPSRate[]) => {
    for (const r of rates) {
      insertRate.run(
        snapshotId, r.hcpcsCode, r.shortDesc, r.apc, r.si, r.relativeWeight,
        r.paymentRate, r.minUnadjusted, r.notes, r.effectiveYear
      );
    }
  });

  insertMany(rates);
  return { snapshotId, rowCount: rates.length, cached: false };
}
