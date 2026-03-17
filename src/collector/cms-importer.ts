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
export async function checkCmsCache(effectiveYear: number): Promise<ImportResult | null> {
  const db = getDb();
  const existing = (await db.execute({
    sql: `
      SELECT id, row_count FROM cms_snapshots
      WHERE effective_year = ?
        AND datetime(fetched_at) > datetime('now', '-90 days')
      ORDER BY fetched_at DESC
      LIMIT 1
    `,
    args: [effectiveYear],
  })).rows[0] as { id: number; row_count: number } | undefined;

  if (existing) {
    return { snapshotId: existing.id, rowCount: existing.row_count, cached: true };
  }
  return null;
}

/**
 * Create a new snapshot record and return the snapshotId + async insertBatch and finalize functions.
 */
export async function beginCmsImport(
  sourceUrl: string,
  effectiveYear: number,
  rawHash: string,
  fileName: string
): Promise<{ snapshotId: number; insertBatch: (rates: CMSRate[]) => Promise<void>; finalize: (totalCount: number) => Promise<void> }> {
  const db = getDb();

  const snapshotResult = await db.execute({
    sql: `
      INSERT INTO cms_snapshots (source_url, effective_year, fetched_at, data_hash, row_count, file_name)
      VALUES (?, ?, datetime('now'), ?, 0, ?)
    `,
    args: [sourceUrl, effectiveYear, rawHash, fileName],
  });

  const snapshotId = Number(snapshotResult.lastInsertRowid);

  const insertSql = `
    INSERT INTO cms_rates (snapshot_id, cpt_code, modifier, description, facility_rate, non_facility_rate, locality, locality_name, status_indicator, effective_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  let totalInserted = 0;

  const insertBatch = async (rates: CMSRate[]): Promise<void> => {
    const stmts = rates.map(rate => ({
      sql: insertSql,
      args: [
        snapshotId,
        rate.cptCode,
        rate.modifier,
        rate.description,
        rate.facilityRate,
        rate.nonFacilityRate,
        rate.locality,
        rate.localityName,
        rate.statusIndicator,
        rate.effectiveYear,
      ] as any[],
    }));
    await db.batch(stmts);
    totalInserted += rates.length;

    if (totalInserted % 100000 === 0) {
      console.log(`[cms-importer] Inserted ${totalInserted} rates...`);
    }
  };

  const finalize = async (totalCount: number): Promise<void> => {
    await db.execute({
      sql: `UPDATE cms_snapshots SET row_count = ? WHERE id = ?`,
      args: [totalCount, snapshotId],
    });
    console.log(`[cms-importer] Imported ${totalCount} rates into snapshot #${snapshotId}`);
  };

  return { snapshotId, insertBatch, finalize };
}

/**
 * Legacy all-at-once import (kept for backwards compatibility).
 */
export async function importCmsRates(
  rates: CMSRate[],
  sourceUrl: string,
  effectiveYear: number,
  rawHash: string,
  fileName: string,
  forceRefresh: boolean = false
): Promise<ImportResult> {
  if (!forceRefresh) {
    const cached = await checkCmsCache(effectiveYear);
    if (cached) {
      console.log(`[cms-importer] Using cached snapshot #${cached.snapshotId} (${cached.rowCount} rates)`);
      return cached;
    }
  }

  const { snapshotId, insertBatch, finalize } = await beginCmsImport(sourceUrl, effectiveYear, rawHash, fileName);

  // Insert in batches of 5000
  const BATCH_SIZE = 5000;
  for (let i = 0; i < rates.length; i += BATCH_SIZE) {
    await insertBatch(rates.slice(i, i + BATCH_SIZE));
  }

  await finalize(rates.length);
  return { snapshotId, rowCount: rates.length, cached: false };
}
