import { getDb } from '../db/connection.js';

/**
 * CMS Locality codes and their names.
 * Each locality maps to a set of ZIP codes and has specific payment adjustments.
 *
 * The full mapping is populated from the CMS ZIP Code to Carrier Locality File:
 *   https://www.cms.gov/medicare/payment/fee-schedules
 *
 * Run scripts/import-zip-locality.ts to import ~43K ZIP records from CMS.
 */

export interface LocalityInfo {
  locality: string;
  carrier: string;
  state: string;
  name: string;
  /** Urban/Rural indicator: 'U' = urban, 'R' = rural, 'B' = super rural (low density qualified area) */
  urban_rural?: string;
}

/**
 * Resolve a ZIP code to its CMS carrier + locality information.
 *
 * The carrier+locality combination uniquely identifies a CMS Physician Fee
 * Schedule (PFS) payment locality. Use carrier and locality together to look
 * up the correct payment rates in the cms_rates table.
 *
 * Key mapping:
 *   zip_code → carrier + locality → PFS payment locality rates
 *
 * @param zip 5-digit ZIP code string (e.g. "10001")
 * @returns LocalityInfo with carrier, locality, state, and urban_rural, or null if not found.
 */
export async function resolveZipToLocality(zip: string): Promise<LocalityInfo | null> {
  const db = getDb();

  // Normalize input: strip whitespace, take first 5 digits
  const normalizedZip = zip.trim().replace(/[^0-9]/g, '').substring(0, 5).padStart(5, '0');

  const row = (await db.execute({
    sql: `SELECT zip_code, carrier, locality, state, county_name, urban_rural
     FROM zip_locality
     WHERE zip_code = ?`,
    args: [normalizedZip],
  })).rows[0] as any;

  if (!row) return null;

  return {
    locality:    row.locality,
    carrier:     row.carrier     || '',
    state:       row.state       || '',
    name:        row.county_name || '',
    urban_rural: row.urban_rural || 'U',
  };
}

/**
 * Look up locality information by carrier + locality code combination.
 * Useful when you already know the carrier/locality pair and want metadata.
 *
 * @param carrier 5-digit CMS carrier / MAC number (e.g. "05201")
 * @param locality 2-digit locality code (e.g. "01")
 * @returns First matching LocalityInfo, or null if not found.
 */
export async function resolveCarrierLocality(carrier: string, locality: string): Promise<LocalityInfo | null> {
  const db = getDb();

  const row = (await db.execute({
    sql: `SELECT zip_code, carrier, locality, state, county_name, urban_rural
     FROM zip_locality
     WHERE carrier = ? AND locality = ?
     LIMIT 1`,
    args: [carrier.trim(), locality.trim()],
  })).rows[0] as any;

  if (!row) return null;

  return {
    locality:    row.locality,
    carrier:     row.carrier     || '',
    state:       row.state       || '',
    name:        row.county_name || '',
    urban_rural: row.urban_rural || 'U',
  };
}

/**
 * Get all ZIP codes for a given carrier + locality pair.
 * Useful for locality-level batch processing.
 */
export async function getZipsForLocality(carrier: string, locality: string): Promise<string[]> {
  const db = getDb();

  const rows = (await db.execute({
    sql: `SELECT zip_code FROM zip_locality WHERE carrier = ? AND locality = ? ORDER BY zip_code`,
    args: [carrier.trim(), locality.trim()],
  })).rows as Array<{ zip_code: string }>;

  return rows.map((r) => r.zip_code);
}

/**
 * Seed ZIP-to-locality mapping with major US metro areas as a fallback.
 *
 * This function exists as a safety net if the full CMS import has not been run.
 * In production, run scripts/import-zip-locality.ts to load the complete ~43K
 * ZIP code crosswalk from the CMS ZIP Code to Carrier Locality File.
 *
 * CMS assigns ~113 payment localities across the US.
 */
export async function seedZipLocality(): Promise<void> {
  const db = getDb();

  // Check if we already have full CMS data loaded
  const countRow = (await db.execute({
    sql: 'SELECT COUNT(*) as c FROM zip_locality',
    args: [],
  })).rows[0] as { c: number };
  const count = countRow.c;
  if (count > 1000) {
    console.log(`[zip-locality] Full CMS data already loaded (${count.toLocaleString()} records). Skipping seed.`);
    return;
  }

  // Major metro ZIP → CMS locality mappings
  // Locality codes: https://www.cms.gov/Medicare/Medicare-Fee-for-Service-Payment/PhysicianFeeSched
  const mappings: [string, string, string, string, string][] = [
    // [zip, carrier, locality, state, county]
    // New York City area
    ['10001', '05201', '01', 'NY', 'Manhattan'],
    ['10002', '05201', '01', 'NY', 'Manhattan'],
    ['10003', '05201', '01', 'NY', 'Manhattan'],
    ['10010', '05201', '01', 'NY', 'Manhattan'],
    ['10016', '05201', '01', 'NY', 'Manhattan'],
    ['10019', '05201', '01', 'NY', 'Manhattan'],
    ['10021', '05201', '01', 'NY', 'Manhattan'],
    ['10025', '05201', '01', 'NY', 'Manhattan'],
    ['10028', '05201', '01', 'NY', 'Manhattan'],
    ['10065', '05201', '01', 'NY', 'Manhattan'],
    ['10075', '05201', '01', 'NY', 'Manhattan'],
    ['11201', '05201', '02', 'NY', 'Brooklyn'],
    ['11215', '05201', '02', 'NY', 'Brooklyn'],
    ['10301', '05201', '03', 'NY', 'Staten Island'],
    // Los Angeles area
    ['90001', '01102', '18', 'CA', 'Los Angeles'],
    ['90015', '01102', '18', 'CA', 'Los Angeles'],
    ['90024', '01102', '18', 'CA', 'Los Angeles'],
    ['90048', '01102', '18', 'CA', 'Los Angeles'],
    ['90095', '01102', '18', 'CA', 'Los Angeles'],
    ['90210', '01102', '18', 'CA', 'Los Angeles'],
    ['90401', '01102', '18', 'CA', 'Los Angeles'],
    // San Francisco area
    ['94102', '01102', '07', 'CA', 'San Francisco'],
    ['94103', '01102', '07', 'CA', 'San Francisco'],
    ['94110', '01102', '07', 'CA', 'San Francisco'],
    ['94114', '01102', '07', 'CA', 'San Francisco'],
    ['94118', '01102', '07', 'CA', 'San Francisco'],
    ['94122', '01102', '07', 'CA', 'San Francisco'],
    // Chicago area
    ['60601', '00530', '16', 'IL', 'Chicago'],
    ['60602', '00530', '16', 'IL', 'Chicago'],
    ['60605', '00530', '16', 'IL', 'Chicago'],
    ['60611', '00530', '16', 'IL', 'Chicago'],
    ['60614', '00530', '16', 'IL', 'Chicago'],
    ['60657', '00530', '16', 'IL', 'Chicago'],
    // Houston area
    ['77001', '00900', '09', 'TX', 'Houston'],
    ['77002', '00900', '09', 'TX', 'Houston'],
    ['77004', '00900', '09', 'TX', 'Houston'],
    ['77030', '00900', '09', 'TX', 'Houston'],
    ['77054', '00900', '09', 'TX', 'Houston'],
    // Dallas area
    ['75201', '00900', '11', 'TX', 'Dallas'],
    ['75204', '00900', '11', 'TX', 'Dallas'],
    ['75219', '00900', '11', 'TX', 'Dallas'],
    ['75225', '00900', '11', 'TX', 'Dallas'],
    // Miami area
    ['33101', '00590', '04', 'FL', 'Miami-Dade'],
    ['33109', '00590', '04', 'FL', 'Miami-Dade'],
    ['33125', '00590', '04', 'FL', 'Miami-Dade'],
    ['33131', '00590', '04', 'FL', 'Miami-Dade'],
    ['33176', '00590', '04', 'FL', 'Miami-Dade'],
    // Boston area
    ['02101', '31201', '01', 'MA', 'Boston Metro'],
    ['02108', '31201', '01', 'MA', 'Boston Metro'],
    ['02110', '31201', '01', 'MA', 'Boston Metro'],
    ['02114', '31201', '01', 'MA', 'Boston Metro'],
    ['02115', '31201', '01', 'MA', 'Boston Metro'],
    // Philadelphia area
    ['19101', '12201', '01', 'PA', 'Philadelphia'],
    ['19103', '12201', '01', 'PA', 'Philadelphia'],
    ['19104', '12201', '01', 'PA', 'Philadelphia'],
    ['19107', '12201', '01', 'PA', 'Philadelphia'],
    // Seattle area
    ['98101', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['98104', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['98109', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['98112', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['98122', '01102', '02', 'WA', 'Seattle (King Co)'],
    // Washington DC area
    ['20001', '00903', '01', 'DC', 'Washington DC'],
    ['20002', '00903', '01', 'DC', 'Washington DC'],
    ['20005', '00903', '01', 'DC', 'Washington DC'],
    ['20010', '00903', '01', 'DC', 'Washington DC'],
    // Atlanta area
    ['30301', '00510', '01', 'GA', 'Atlanta Metro'],
    ['30303', '00510', '01', 'GA', 'Atlanta Metro'],
    ['30309', '00510', '01', 'GA', 'Atlanta Metro'],
    ['30322', '00510', '01', 'GA', 'Atlanta Metro'],
    // Denver area
    ['80201', '00825', '01', 'CO', 'Denver Metro'],
    ['80202', '00825', '01', 'CO', 'Denver Metro'],
    ['80205', '00825', '01', 'CO', 'Denver Metro'],
    // Baltimore area
    ['21201', '00901', '01', 'MD', 'Baltimore Metro'],
    ['21202', '00901', '01', 'MD', 'Baltimore Metro'],
    ['21287', '00901', '01', 'MD', 'Baltimore Metro'],
    // Pittsburgh area
    ['15201', '12201', '02', 'PA', 'Pittsburgh'],
    ['15213', '12201', '02', 'PA', 'Pittsburgh'],
    // Rest of state fallback (locality 99 = rest of state for most carriers)
    ['00000', '00000', '99', 'US', 'National Average'],
  ];

  const insertSql = `
    INSERT OR IGNORE INTO zip_locality (zip_code, carrier, locality, state, county_name)
    VALUES (?, ?, ?, ?, ?)
  `;

  const stmts = mappings.map(([zip, carrier, locality, state, county]) => ({
    sql: insertSql,
    args: [zip, carrier, locality, state, county] as any[],
  }));

  await db.batch(stmts);

  console.log(`[zip-locality] Seeded ${mappings.length} ZIP-to-locality mappings (fallback mode)`);
  console.log('[zip-locality] Run: npx tsx scripts/import-zip-locality.ts for full CMS data (~43K ZIPs)');
}
