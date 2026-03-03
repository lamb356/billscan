import { getDb } from '../db/connection.js';

export interface LocalityInfo {
  locality: string;
  carrier: string;
  state: string;
  name: string;
  urban_rural?: string;
}

export function resolveZipToLocality(zip: string): LocalityInfo | null {
  const db = getDb();
  const normalizedZip = zip.trim().replace(/[^0-9]/g, '').substring(0, 5).padStart(5, '0');

  const row = db.prepare(
    `SELECT zip_code, carrier, locality, state, county_name, urban_rural
     FROM zip_locality
     WHERE zip_code = ?`
  ).get(normalizedZip) as any;

  if (!row) return null;

  return {
    locality:    row.locality,
    carrier:     row.carrier     || '',
    state:       row.state       || '',
    name:        row.county_name || '',
    urban_rural: row.urban_rural || 'U',
  };
}

export function resolveCarrierLocality(carrier: string, locality: string): LocalityInfo | null {
  const db = getDb();

  const row = db.prepare(
    `SELECT zip_code, carrier, locality, state, county_name, urban_rural
     FROM zip_locality
     WHERE carrier = ? AND locality = ?
     LIMIT 1`
  ).get(carrier.trim(), locality.trim()) as any;

  if (!row) return null;

  return {
    locality:    row.locality,
    carrier:     row.carrier     || '',
    state:       row.state       || '',
    name:        row.county_name || '',
    urban_rural: row.urban_rural || 'U',
  };
}

export function getZipsForLocality(carrier: string, locality: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT zip_code FROM zip_locality WHERE carrier = ? AND locality = ? ORDER BY zip_code`
  ).all(carrier.trim(), locality.trim()) as Array<{ zip_code: string }>;
  return rows.map((r) => r.zip_code);
}

export function seedZipLocality(): void {
  const db = getDb();

  const count = (db.prepare('SELECT COUNT(*) as c FROM zip_locality').get() as { c: number }).c;
  if (count > 1000) {
    console.log(`[zip-locality] Full CMS data already loaded (${count.toLocaleString()} records). Skipping seed.`);
    return;
  }

  const mappings: [string, string, string, string, string][] = [
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
    ['90001', '01102', '18', 'CA', 'Los Angeles'],
    ['90015', '01102', '18', 'CA', 'Los Angeles'],
    ['90024', '01102', '18', 'CA', 'Los Angeles'],
    ['90048', '01102', '18', 'CA', 'Los Angeles'],
    ['90095', '01102', '18', 'CA', 'Los Angeles'],
    ['90210', '01102', '18', 'CA', 'Los Angeles'],
    ['90401', '01102', '18', 'CA', 'Los Angeles'],
    ['94102', '01102', '07', 'CA', 'San Francisco'],
    ['94103', '01102', '07', 'CA', 'San Francisco'],
    ['94110', '01102', '07', 'CA', 'San Francisco'],
    ['94114', '01102', '07', 'CA', 'San Francisco'],
    ['94118', '01102', '07', 'CA', 'San Francisco'],
    ['94122', '01102', '07', 'CA', 'San Francisco'],
    ['60601', '00530', '16', 'IL', 'Chicago'],
    ['60602', '00530', '16', 'IL', 'Chicago'],
    ['60605', '00530', '16', 'IL', 'Chicago'],
    ['60611', '00530', '16', 'IL', 'Chicago'],
    ['60614', '00530', '16', 'IL', 'Chicago'],
    ['60657', '00530', '16', 'IL', 'Chicago'],
    ['77001', '00900', '09', 'TX', 'Houston'],
    ['77002', '00900', '09', 'TX', 'Houston'],
    ['77004', '00900', '09', 'TX', 'Houston'],
    ['77030', '00900', '09', 'TX', 'Houston'],
    ['77054', '00900', '09', 'TX', 'Houston'],
    ['75201', '00900', '11', 'TX', 'Dallas'],
    ['75204', '00900', '11', 'TX', 'Dallas'],
    ['75219', '00900', '11', 'TX', 'Dallas'],
    ['75225', '00900', '11', 'TX', 'Dallas'],
    ['33101', '00590', '04', 'FL', 'Miami-Dade'],
    ['33109', '00590', '04', 'FL', 'Miami-Dade'],
    ['33125', '00590', '04', 'FL', 'Miami-Dade'],
    ['33131', '00590', '04', 'FL', 'Miami-Dade'],
    ['33176', '00590', '04', 'FL', 'Miami-Dade'],
    ['02101', '31201', '01', 'MA', 'Boston Metro'],
    ['02108', '31201', '01', 'MA', 'Boston Metro'],
    ['02110', '31201', '01', 'MA', 'Boston Metro'],
    ['02114', '31201', '01', 'MA', 'Boston Metro'],
    ['02115', '31201', '01', 'MA', 'Boston Metro'],
    ['19101', '12201', '01', 'PA', 'Philadelphia'],
    ['19103', '12201', '01', 'PA', 'Philadelphia'],
    ['19104', '12201', '01', 'PA', 'Philadelphia'],
    ['19107', '12201', '01', 'PA', 'Philadelphia'],
    ['98101', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['98104', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['98109', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['98112', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['98122', '01102', '02', 'WA', 'Seattle (King Co)'],
    ['20001', '00903', '01', 'DC', 'Washington DC'],
    ['20002', '00903', '01', 'DC', 'Washington DC'],
    ['20005', '00903', '01', 'DC', 'Washington DC'],
    ['20010', '00903', '01', 'DC', 'Washington DC'],
    ['30301', '00510', '01', 'GA', 'Atlanta Metro'],
    ['30303', '00510', '01', 'GA', 'Atlanta Metro'],
    ['30309', '00510', '01', 'GA', 'Atlanta Metro'],
    ['30322', '00510', '01', 'GA', 'Atlanta Metro'],
    ['80201', '00825', '01', 'CO', 'Denver Metro'],
    ['80202', '00825', '01', 'CO', 'Denver Metro'],
    ['80205', '00825', '01', 'CO', 'Denver Metro'],
    ['21201', '00901', '01', 'MD', 'Baltimore Metro'],
    ['21202', '00901', '01', 'MD', 'Baltimore Metro'],
    ['21287', '00901', '01', 'MD', 'Baltimore Metro'],
    ['15201', '12201', '02', 'PA', 'Pittsburgh'],
    ['15213', '12201', '02', 'PA', 'Pittsburgh'],
    ['00000', '00000', '99', 'US', 'National Average'],
  ];

  const insert = db.prepare(`INSERT OR IGNORE INTO zip_locality (zip_code, carrier, locality, state, county_name) VALUES (?, ?, ?, ?, ?)`);

  const txn = db.transaction(() => {
    for (const [zip, carrier, locality, state, county] of mappings) {
      insert.run(zip, carrier, locality, state, county);
    }
  });
  txn();

  console.log(`[zip-locality] Seeded ${mappings.length} ZIP-to-locality mappings (fallback mode)`);
  console.log('[zip-locality] Run: npx tsx scripts/import-zip-locality.ts for full CMS data (~43K ZIPs)');
}
