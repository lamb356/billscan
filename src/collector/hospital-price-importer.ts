/**
 * Hospital Price Transparency Importer
 *
 * Imports parsed hospital price transparency rows into the database.
 * Uses batch inserts within transactions for performance.
 */

import { getDb } from '../db/connection.js';
import type { HospitalPriceRow } from './hospital-price-parser.js';

export interface ImportResult {
  inserted: number;
  skipped: number;
}

/**
 * Import parsed hospital price rows into the hospital_prices table.
 *
 * @param rows - Parsed rows from parseHospitalPriceFile
 * @param sourceUrl - URL of the hospital's MRF
 * @returns Count of inserted and skipped rows
 */
export async function importHospitalPrices(
  rows: HospitalPriceRow[],
  sourceUrl: string
): Promise<ImportResult> {
  const db = getDb();
  let inserted = 0;
  let skipped = 0;

  const BATCH_SIZE = 2000;

  const insertSql = `
    INSERT INTO hospital_prices (
      hospital_name, hospital_ein, payer_name, plan_name,
      billing_code_type, billing_code, description,
      negotiated_rate, negotiated_type,
      gross_charge, cash_discount_price,
      min_negotiated, max_negotiated,
      setting, modifier, source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const stmts: Array<{ sql: string; args: any[] }> = [];

    for (const row of batch) {
      // Skip rows without a billing code
      if (!row.billingCode) {
        skipped++;
        continue;
      }

      // Skip non-CPT/HCPCS codes
      const codeType = row.billingCodeType.toUpperCase();
      if (codeType !== 'CPT' && codeType !== 'HCPCS') {
        skipped++;
        continue;
      }

      stmts.push({
        sql: insertSql,
        args: [
          row.hospitalName,
          row.hospitalEin,
          row.payerName,
          row.planName,
          row.billingCodeType,
          row.billingCode,
          row.description,
          row.negotiatedRate,
          row.negotiatedType,
          row.grossCharge,
          row.cashDiscountPrice,
          row.minNegotiated,
          row.maxNegotiated,
          row.setting,
          row.modifier,
          row.sourceUrl ?? sourceUrl,
        ],
      });
    }

    if (stmts.length > 0) {
      await db.batch(stmts);
      inserted += stmts.length;
    }

    if (inserted % 10000 === 0 && inserted > 0) {
      console.log(`[hospital-price-importer] Inserted ${inserted} rows...`);
    }
  }

  console.log(
    `[hospital-price-importer] Import complete: ${inserted} inserted, ${skipped} skipped`
  );

  return { inserted, skipped };
}

/**
 * Delete all hospital prices for a given source URL.
 * Useful for re-importing updated data.
 */
export async function deleteHospitalPricesBySource(sourceUrl: string): Promise<number> {
  const db = getDb();
  const result = await db.execute({
    sql: 'DELETE FROM hospital_prices WHERE source_url = ?',
    args: [sourceUrl],
  });
  const deleted = Number(result.rowsAffected);
  console.log(`[hospital-price-importer] Deleted ${deleted} rows for source: ${sourceUrl}`);
  return deleted;
}

/**
 * Get stats about imported hospital price data.
 */
export async function getHospitalPriceStats(): Promise<{
  totalRows: number;
  hospitalCount: number;
  payerCount: number;
  codeCount: number;
}> {
  const db = getDb();

  const totalRow = (await db.execute({
    sql: 'SELECT COUNT(*) as c FROM hospital_prices',
    args: [],
  })).rows[0] as { c: number };

  const hospitalRow = (await db.execute({
    sql: 'SELECT COUNT(DISTINCT hospital_name) as c FROM hospital_prices',
    args: [],
  })).rows[0] as { c: number };

  const payerRow = (await db.execute({
    sql: 'SELECT COUNT(DISTINCT payer_name) as c FROM hospital_prices WHERE payer_name IS NOT NULL',
    args: [],
  })).rows[0] as { c: number };

  const codeRow = (await db.execute({
    sql: 'SELECT COUNT(DISTINCT billing_code) as c FROM hospital_prices',
    args: [],
  })).rows[0] as { c: number };

  return {
    totalRows: totalRow.c,
    hospitalCount: hospitalRow.c,
    payerCount: payerRow.c,
    codeCount: codeRow.c,
  };
}
