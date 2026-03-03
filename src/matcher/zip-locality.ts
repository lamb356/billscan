import { getDb } from '../db/connection.js';

export interface ZipLocalityResult {
  zipCode: string;
  locality: string;
  state: string | null;
  county: string | null;
}

export function lookupZipLocality(zip: string): ZipLocalityResult | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT zip_code, locality, state, county FROM zip_locality WHERE zip_code = ?'
  ).get(zip) as any;

  if (!row) return null;

  return {
    zipCode: row.zip_code,
    locality: row.locality,
    state: row.state || null,
    county: row.county || null,
  };
}

/**
 * Seed the ZIP-to-locality mapping with a sample of major US ZIP codes.
 * In production, this would come from the CMS Zip Code to Carrier Locality file.
 * Source: https://www.cms.gov/Medicare/Medicare-Fee-for-Service-Payment/PhysicianFeeSched/PFS-Federal-Regulation-Notices
 */
export function seedZipLocality(): void {
  const db = getDb();

  // Representative sample of ZIP codes mapped to CMS localities
  // Format: ZIP code -> CMS locality code
  const zipMappings = [
    // New York
    { zip: '10001', locality: '01', state: 'NY', county: 'New York' },
    { zip: '10002', locality: '01', state: 'NY', county: 'New York' },
    { zip: '10003', locality: '01', state: 'NY', county: 'New York' },
    { zip: '10019', locality: '01', state: 'NY', county: 'New York' },
    { zip: '10065', locality: '01', state: 'NY', county: 'New York' },
    { zip: '11201', locality: '02', state: 'NY', county: 'Kings' },
    { zip: '11215', locality: '02', state: 'NY', county: 'Kings' },
    { zip: '10451', locality: '03', state: 'NY', county: 'Bronx' },
    { zip: '10301', locality: '04', state: 'NY', county: 'Richmond' },
    { zip: '11101', locality: '05', state: 'NY', county: 'Queens' },
    // Los Angeles
    { zip: '90001', locality: '26', state: 'CA', county: 'Los Angeles' },
    { zip: '90048', locality: '26', state: 'CA', county: 'Los Angeles' },
    { zip: '90095', locality: '26', state: 'CA', county: 'Los Angeles' },
    { zip: '90210', locality: '26', state: 'CA', county: 'Los Angeles' },
    // Chicago
    { zip: '60601', locality: '16', state: 'IL', county: 'Cook' },
    { zip: '60611', locality: '16', state: 'IL', county: 'Cook' },
    { zip: '60614', locality: '16', state: 'IL', county: 'Cook' },
    // Houston
    { zip: '77001', locality: '43', state: 'TX', county: 'Harris' },
    { zip: '77030', locality: '43', state: 'TX', county: 'Harris' },
    // Phoenix
    { zip: '85001', locality: '05', state: 'AZ', county: 'Maricopa' },
    { zip: '85724', locality: '05', state: 'AZ', county: 'Pima' },
    // Philadelphia
    { zip: '19101', locality: '05', state: 'PA', county: 'Philadelphia' },
    { zip: '19104', locality: '05', state: 'PA', county: 'Philadelphia' },
    // San Antonio
    { zip: '78201', locality: '44', state: 'TX', county: 'Bexar' },
    // San Diego
    { zip: '92101', locality: '27', state: 'CA', county: 'San Diego' },
    // Dallas
    { zip: '75201', locality: '45', state: 'TX', county: 'Dallas' },
    // San Jose
    { zip: '95101', locality: '22', state: 'CA', county: 'Santa Clara' },
    // Austin
    { zip: '78701', locality: '44', state: 'TX', county: 'Travis' },
    // Jacksonville
    { zip: '32099', locality: '13', state: 'FL', county: 'Duval' },
    // Fort Worth
    { zip: '76101', locality: '45', state: 'TX', county: 'Tarrant' },
    // Columbus
    { zip: '43085', locality: '34', state: 'OH', county: 'Franklin' },
    // Charlotte
    { zip: '28201', locality: '33', state: 'NC', county: 'Mecklenburg' },
    // Indianapolis
    { zip: '46201', locality: '15', state: 'IN', county: 'Marion' },
    // San Francisco
    { zip: '94102', locality: '22', state: 'CA', county: 'San Francisco' },
    { zip: '94115', locality: '22', state: 'CA', county: 'San Francisco' },
    // Seattle
    { zip: '98101', locality: '50', state: 'WA', county: 'King' },
    { zip: '98122', locality: '50', state: 'WA', county: 'King' },
    // Denver
    { zip: '80201', locality: '07', state: 'CO', county: 'Denver' },
    // Nashville
    { zip: '37201', locality: '42', state: 'TN', county: 'Davidson' },
    { zip: '37232', locality: '42', state: 'TN', county: 'Davidson' },
    // Oklahoma City
    { zip: '73101', locality: '36', state: 'OK', county: 'Oklahoma' },
    // El Paso
    { zip: '79901', locality: '45', state: 'TX', county: 'El Paso' },
    // Washington DC
    { zip: '20001', locality: '49', state: 'DC', county: 'District of Columbia' },
    { zip: '20010', locality: '49', state: 'DC', county: 'District of Columbia' },
    // Las Vegas
    { zip: '89101', locality: '28', state: 'NV', county: 'Clark' },
    // Louisville
    { zip: '40201', locality: '19', state: 'KY', county: 'Jefferson' },
    // Baltimore
    { zip: '21201', locality: '20', state: 'MD', county: 'Baltimore City' },
    { zip: '21287', locality: '20', state: 'MD', county: 'Baltimore City' },
    // Milwaukee
    { zip: '53201', locality: '52', state: 'WI', county: 'Milwaukee' },
    { zip: '53215', locality: '52', state: 'WI', county: 'Milwaukee' },
    // Albuquerque
    { zip: '87101', locality: '30', state: 'NM', county: 'Bernalillo' },
    // Tucson
    { zip: '85701', locality: '05', state: 'AZ', county: 'Pima' },
    // Fresno
    { zip: '93650', locality: '25', state: 'CA', county: 'Fresno' },
    // Sacramento
    { zip: '95814', locality: '25', state: 'CA', county: 'Sacramento' },
    // Long Beach
    { zip: '90802', locality: '26', state: 'CA', county: 'Los Angeles' },
    // Kansas City
    { zip: '64101', locality: '24', state: 'MO', county: 'Jackson' },
    // Mesa
    { zip: '85201', locality: '05', state: 'AZ', county: 'Maricopa' },
    // Atlanta
    { zip: '30301', locality: '10', state: 'GA', county: 'Fulton' },
    { zip: '30322', locality: '10', state: 'GA', county: 'DeKalb' },
    // Omaha
    { zip: '68101', locality: '27', state: 'NE', county: 'Douglas' },
    // Colorado Springs
    { zip: '80901', locality: '07', state: 'CO', county: 'El Paso' },
    // Raleigh
    { zip: '27601', locality: '33', state: 'NC', county: 'Wake' },
    // Cleveland
    { zip: '44101', locality: '34', state: 'OH', county: 'Cuyahoga' },
    { zip: '44195', locality: '34', state: 'OH', county: 'Cuyahoga' },
    // Miami
    { zip: '33101', locality: '13', state: 'FL', county: 'Miami-Dade' },
    { zip: '33176', locality: '13', state: 'FL', county: 'Miami-Dade' },
    // Pittsburgh
    { zip: '15201', locality: '05', state: 'PA', county: 'Allegheny' },
    { zip: '15213', locality: '05', state: 'PA', county: 'Allegheny' },
    // Boston
    { zip: '02101', locality: '21', state: 'MA', county: 'Suffolk' },
    { zip: '02114', locality: '21', state: 'MA', county: 'Suffolk' },
    // Rochester MN
    { zip: '55901', locality: '23', state: 'MN', county: 'Olmsted' },
    { zip: '55902', locality: '23', state: 'MN', county: 'Olmsted' },
    // Durham
    { zip: '27701', locality: '33', state: 'NC', county: 'Durham' },
    { zip: '27710', locality: '33', state: 'NC', county: 'Durham' },
    // Royal Oak MI
    { zip: '48067', locality: '22', state: 'MI', county: 'Oakland' },
    { zip: '48073', locality: '22', state: 'MI', county: 'Oakland' },
    // Murray UT
    { zip: '84107', locality: '46', state: 'UT', county: 'Salt Lake' },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO zip_locality (zip_code, locality, state, county)
    VALUES (?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    for (const m of zipMappings) {
      insert.run(m.zip, m.locality, m.state, m.county);
    }
  });
  txn();

  console.log(`[zip-locality] Seeded ${zipMappings.length} ZIP-to-locality mappings`);
}
