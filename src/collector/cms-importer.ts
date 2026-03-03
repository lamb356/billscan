import { getDb } from '../db/connection.js';
import type { CMSRate } from '../schema/cms.js';

export interface ImportResult {
  snapshotId: number;
  rowCount: number;
  cached: boolean;
}

export function importCmsRates(
  rates: CMSRate[],
  sourceUrl: string,
  effectiveYear: number,
  rawHash: string,
  fileName: string,
  forceRefresh = false,
): ImportResult {
  const db = getDb();

  // Check if already imported (by hash)
  if (!forceRefresh) {
    const existing = db.prepare(
      'SELECT id FROM cms_snapshots WHERE data_hash = ?'
    ).get(rawHash) as { id: number } | undefined;

    if (existing) {
      const rowCount = db.prepare(
        'SELECT COUNT(*) as c FROM cms_rates WHERE snapshot_id = ?'
      ).get(existing.id) as { c: number };
      return { snapshotId: existing.id, rowCount: rowCount.c, cached: true };
    }
  }

  // Insert snapshot record
  const result = db.prepare(`
    INSERT INTO cms_snapshots (source_url, file_name, effective_year, data_hash)
    VALUES (?, ?, ?, ?)
  `).run(sourceUrl, fileName, effectiveYear, rawHash);

  const snapshotId = result.lastInsertRowid as number;

  // Bulk insert rates
  const insertRate = db.prepare(`
    INSERT INTO cms_rates
      (snapshot_id, hcpcs_code, modifier, description, facility_rate, non_facility_rate,
       locality_code, status_code, effective_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rates: CMSRate[]) => {
    for (const r of rates) {
      insertRate.run(
        snapshotId,
        r.hcpcsCode,
        r.modifier ?? null,
        r.description ?? null,
        r.facilityRate ?? null,
        r.nonFacilityRate ?? null,
        r.localityCode ?? null,
        r.statusCode ?? null,
        r.effectiveYear,
      );
    }
  });

  insertMany(rates);

  return { snapshotId, rowCount: rates.length, cached: false };
}
