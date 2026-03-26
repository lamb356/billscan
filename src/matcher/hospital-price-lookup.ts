/**
 * Hospital Price Transparency Lookup
 *
 * Query hospital-specific prices for CPT codes from the hospital_prices table.
 * Supports lookups by hospital name, payer name, and CPT code.
 */

import { getDb } from '../db/connection.js';

export interface HospitalPriceLookup {
  cptCode: string;
  hospitalName: string;
  payerName: string | null;
  planName: string | null;
  negotiatedRate: number | null;
  grossCharge: number | null;
  cashDiscountPrice: number | null;
  minNegotiated: number | null;
  maxNegotiated: number | null;
  setting: string | null;
  sourceUrl: string | null;
}

interface PriceRow {
  billing_code: string;
  hospital_name: string;
  payer_name: string | null;
  plan_name: string | null;
  negotiated_rate: number | null;
  gross_charge: number | null;
  cash_discount_price: number | null;
  min_negotiated: number | null;
  max_negotiated: number | null;
  setting: string | null;
  source_url: string | null;
}

function rowToLookup(row: PriceRow): HospitalPriceLookup {
  return {
    cptCode: row.billing_code,
    hospitalName: row.hospital_name,
    payerName: row.payer_name,
    planName: row.plan_name,
    negotiatedRate: row.negotiated_rate,
    grossCharge: row.gross_charge,
    cashDiscountPrice: row.cash_discount_price,
    minNegotiated: row.min_negotiated,
    maxNegotiated: row.max_negotiated,
    setting: row.setting,
    sourceUrl: row.source_url,
  };
}

/**
 * Look up all prices for a CPT code, optionally filtered by hospital and payer.
 */
export async function lookupHospitalPrices(
  cptCode: string,
  hospitalName?: string,
  payerName?: string
): Promise<HospitalPriceLookup[]> {
  const db = getDb();

  let sql = `
    SELECT billing_code, hospital_name, payer_name, plan_name,
           negotiated_rate, gross_charge, cash_discount_price,
           min_negotiated, max_negotiated, setting, source_url
    FROM hospital_prices
    WHERE billing_code = ?
  `;
  const args: any[] = [cptCode];

  if (hospitalName) {
    sql += ` AND hospital_name LIKE ?`;
    args.push(`%${hospitalName}%`);
  }

  if (payerName) {
    sql += ` AND payer_name LIKE ?`;
    args.push(`%${payerName}%`);
  }

  sql += ` ORDER BY hospital_name, payer_name LIMIT 200`;

  const result = await db.execute({ sql, args });
  return (result.rows as unknown as PriceRow[]).map(rowToLookup);
}

/**
 * Get the cash/self-pay price for a CPT code.
 * Returns the lowest non-null cash_discount_price found.
 */
export async function getCashPrice(
  cptCode: string,
  hospitalName?: string
): Promise<number | null> {
  const db = getDb();

  let sql = `
    SELECT cash_discount_price
    FROM hospital_prices
    WHERE billing_code = ?
      AND cash_discount_price IS NOT NULL
      AND cash_discount_price > 0
  `;
  const args: any[] = [cptCode];

  if (hospitalName) {
    sql += ` AND hospital_name LIKE ?`;
    args.push(`%${hospitalName}%`);
  }

  sql += ` ORDER BY cash_discount_price ASC LIMIT 1`;

  const row = (await db.execute({ sql, args })).rows[0] as
    { cash_discount_price: number } | undefined;

  return row?.cash_discount_price ?? null;
}

/**
 * Get the negotiated rate for a specific payer.
 * Returns the first match found.
 */
export async function getNegotiatedRate(
  cptCode: string,
  payerName: string,
  hospitalName?: string
): Promise<number | null> {
  const db = getDb();

  let sql = `
    SELECT negotiated_rate
    FROM hospital_prices
    WHERE billing_code = ?
      AND payer_name LIKE ?
      AND negotiated_rate IS NOT NULL
      AND negotiated_rate > 0
  `;
  const args: any[] = [cptCode, `%${payerName}%`];

  if (hospitalName) {
    sql += ` AND hospital_name LIKE ?`;
    args.push(`%${hospitalName}%`);
  }

  sql += ` ORDER BY negotiated_rate ASC LIMIT 1`;

  const row = (await db.execute({ sql, args })).rows[0] as
    { negotiated_rate: number } | undefined;

  return row?.negotiated_rate ?? null;
}

/**
 * Get a summary of all available prices for a CPT code across all hospitals/payers.
 */
export async function getPriceSummary(
  cptCode: string,
  hospitalName?: string
): Promise<{
  cptCode: string;
  hospitalCount: number;
  cashPriceRange: [number, number] | null;
  negotiatedRange: [number, number] | null;
  grossChargeRange: [number, number] | null;
  payerRates: Array<{ payer: string; rate: number }>;
}> {
  const db = getDb();

  const baseWhere = hospitalName
    ? `billing_code = ? AND hospital_name LIKE ?`
    : `billing_code = ?`;
  const baseArgs: any[] = hospitalName ? [cptCode, `%${hospitalName}%`] : [cptCode];

  // Hospital count
  const hCountRow = (await db.execute({
    sql: `SELECT COUNT(DISTINCT hospital_name) as c FROM hospital_prices WHERE ${baseWhere}`,
    args: baseArgs,
  })).rows[0] as { c: number };

  // Cash price range
  const cashRow = (await db.execute({
    sql: `SELECT MIN(cash_discount_price) as mn, MAX(cash_discount_price) as mx
          FROM hospital_prices
          WHERE ${baseWhere} AND cash_discount_price IS NOT NULL AND cash_discount_price > 0`,
    args: baseArgs,
  })).rows[0] as { mn: number | null; mx: number | null };

  // Negotiated rate range
  const negRow = (await db.execute({
    sql: `SELECT MIN(negotiated_rate) as mn, MAX(negotiated_rate) as mx
          FROM hospital_prices
          WHERE ${baseWhere} AND negotiated_rate IS NOT NULL AND negotiated_rate > 0`,
    args: baseArgs,
  })).rows[0] as { mn: number | null; mx: number | null };

  // Gross charge range
  const grossRow = (await db.execute({
    sql: `SELECT MIN(gross_charge) as mn, MAX(gross_charge) as mx
          FROM hospital_prices
          WHERE ${baseWhere} AND gross_charge IS NOT NULL AND gross_charge > 0`,
    args: baseArgs,
  })).rows[0] as { mn: number | null; mx: number | null };

  // Per-payer rates (distinct payers with their average negotiated rate)
  const payerRows = (await db.execute({
    sql: `SELECT payer_name as payer, AVG(negotiated_rate) as rate
          FROM hospital_prices
          WHERE ${baseWhere}
            AND payer_name IS NOT NULL
            AND negotiated_rate IS NOT NULL
            AND negotiated_rate > 0
          GROUP BY payer_name
          ORDER BY rate ASC
          LIMIT 20`,
    args: baseArgs,
  })).rows as unknown as Array<{ payer: string; rate: number }>;

  return {
    cptCode,
    hospitalCount: hCountRow.c,
    cashPriceRange: cashRow.mn !== null && cashRow.mx !== null
      ? [cashRow.mn, cashRow.mx]
      : null,
    negotiatedRange: negRow.mn !== null && negRow.mx !== null
      ? [negRow.mn, negRow.mx]
      : null,
    grossChargeRange: grossRow.mn !== null && grossRow.mx !== null
      ? [grossRow.mn, grossRow.mx]
      : null,
    payerRates: payerRows.map(r => ({
      payer: r.payer,
      rate: Math.round(r.rate * 100) / 100,
    })),
  };
}
