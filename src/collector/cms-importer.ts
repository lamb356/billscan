import { getDb } from '../db/connection.js';
import type { CMSRate } from '../schema/cms.js';

interface ImportResult {
  snapshotId: number;
  rowCount: number;
  cached: boolean;
}

/**
 * Check if there's a cached snapshot for the given year.
 */
export function checkCmsCache(effectiveYear: number): ImportResult | null {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id, row_count FROM cms_snapshots
    WHERE effective_year = ?
      AND datetime(fetched_at) > datetime('now', '-90 days')
    ORDER BY fetched_at DESC
    LIMIT 1
  `).get(effectiveYear) as { id: number; row_count: number } | undefined;

  if (existing) {
    return { snapshotId: existing.id, rowCount: existing.row_count, cached: true };
  }
  return null;
}

/**
 * Create a new snapshot record and return the snapshotId + prepared insert statement.
 */
export function beginCmsImport(
  sourceUrl: string,
  effectiveYear: number,
  rawHash: string,
  fileName: string
): { snapshotId: number; insertBatch: (rates: CMSRate[]) => void; finalize: (totalCount: number) => void } {
  const db = getDb();

  // Optimize SQLite for bulk writes
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -64000'); // 64MB cache

  const snapshotResult = db.prepare(`
    INSERT INTO cms_snapshots (source_url, effective_year, fetched_at, data_hash, row_count, file_name)
    VALUES (?, ?, datetime('now'), ?, 0, ?)
  `).run(sourceUrl, effectiveYear, rawHash, fileName);

  const snapshotId = Number(snapshotResult.lastInsertRowid);

  const insert = db.prepare(`
    INSERT INTO cms_rates (snapshot_id, cpt_code, modifier, description, facility_rate, non_facility_rate, locality, locality_name, status_indicator, effective_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalInserted = 0;

  const insertBatch = (rates: CMSRate[]) => {
    const txn = db.transaction(() => {
      for (const rate of rates) {
        insert.run(
          snapshotId,
          rate.cptCode,
          rate.modifier,
          rate.description,
          rate.facilityRate,
          rate.nonFacilityRate,
          rate.locality,
          rate.localityName,
          rate.statusIndicator,
          rate.effectiveYear
        );
      }
    });
    txn();
    totalInserted += rates.length;

    if (totalInserted % 100000 === 0) {
      console.log(`[cms-importer] Inserted ${totalInserted} rates...`);
    }
  };

  const finalize = (totalCount: number) => {
    db.prepare(`UPDATE cms_snapshots SET row_count = ? WHERE id = ?`).run(totalCount, snapshotId);
    db.pragma('synchronous = FULL');
    console.log(`[cms-importer] Imported ${totalCount} rates into snapshot #${snapshotId}`);
  };

  return { snapshotId, insertBatch, finalize };
}

/**
 * Legacy all-at-once import (kept for backwards compatibility).
 */
export function importCmsRates(
  rates: CMSRate[],
  sourceUrl: string,
  effectiveYear: number,
  rawHash: string,
  fileName: string,
  forceRefresh: boolean = false
): ImportResult {
  if (!forceRefresh) {
    const cached = checkCmsCache(effectiveYear);
    if (cached) {
      console.log(`[cms-importer] Using cached snapshot #${cached.snapshotId} (${cached.rowCount} rates)`);
      return cached;
    }
  }

  const { snapshotId, insertBatch, finalize } = beginCmsImport(sourceUrl, effectiveYear, rawHash, fileName);

  // Insert in batches of 5000
  const BATCH_SIZE = 5000;
  for (let i = 0; i < rates.length; i += BATCH_SIZE) {
    insertBatch(rates.slice(i, i + BATCH_SIZE));
  }

  finalize(rates.length);
  return { snapshotId, rowCount: rates.length, cached: false };
}
