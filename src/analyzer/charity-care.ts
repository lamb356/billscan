import { getDb } from '../db/connection.js';

export interface CharityCareResult {
  isNonprofit: boolean;
  hospitalName: string | null;
  ein: string | null;
  fapUrl: string | null;
  state: string | null;
  advice: string[];
}

/**
 * Check if a hospital is a nonprofit and may offer charity care / financial assistance.
 * Uses a built-in database of known 501(c)(3) hospitals.
 * All nonprofit hospitals are required by the ACA to have a Financial Assistance Policy (FAP).
 */
export async function checkCharityCare(facilityName: string, zip?: string, state?: string): Promise<CharityCareResult> {
  const db = getDb();
  const advice: string[] = [];

  // Try exact name match first
  let row = (await db.execute({
    sql: `SELECT ein, name, city, state, zip_code, fap_url FROM charity_hospitals WHERE LOWER(name) LIKE ?`,
    args: [`%${facilityName.toLowerCase()}%`],
  })).rows[0] as any;

  // Try by ZIP code
  if (!row && zip) {
    row = (await db.execute({
      sql: `SELECT ein, name, city, state, zip_code, fap_url FROM charity_hospitals WHERE zip_code = ? LIMIT 1`,
      args: [zip],
    })).rows[0];
  }

  if (row) {
    advice.push(
      `${row.name} is a 501(c)(3) nonprofit hospital.`,
      `Under the ACA, nonprofit hospitals MUST offer a Financial Assistance Policy (FAP).`,
      `Request their FAP/charity care application before paying.`,
      `You may qualify for free or reduced-cost care based on income.`,
    );
    if (row.fap_url) {
      advice.push(`Financial Assistance Policy: ${row.fap_url}`);
    }
    return {
      isNonprofit: true,
      hospitalName: row.name,
      ein: row.ein,
      fapUrl: row.fap_url,
      state: row.state,
      advice,
    };
  }

  // If no match found, still give general advice
  advice.push(
    `Could not confirm nonprofit status for "${facilityName}".`,
    `However, many hospitals are nonprofits. Ask the billing department:`,
    `  1. "Is this hospital a 501(c)(3) nonprofit organization?"`,
    `  2. "Do you have a Financial Assistance Policy (FAP)?"`,
    `  3. "Can I get a charity care application?"`,
    `Even for-profit hospitals often offer payment plans and discounts.`,
  );

  return {
    isNonprofit: false,
    hospitalName: facilityName,
    ein: null,
    fapUrl: null,
    state: state || null,
    advice,
  };
}

/**
 * Seed the charity hospital database with known major nonprofit hospital systems.
 * In production, this would be populated from IRS 990 filings and CMS Provider of Services data.
 */
export async function seedCharityHospitals(): Promise<void> {
  const db = getDb();

  const hospitals = [
    { ein: '36-2170833', name: 'Northwestern Memorial Hospital', city: 'Chicago', state: 'IL', zip: '60611' },
    { ein: '13-1740114', name: 'NewYork-Presbyterian Hospital', city: 'New York', state: 'NY', zip: '10065' },
    { ein: '95-1644600', name: 'Cedars-Sinai Medical Center', city: 'Los Angeles', state: 'CA', zip: '90048' },
    { ein: '04-2312909', name: 'Massachusetts General Hospital', city: 'Boston', state: 'MA', zip: '02114' },
    { ein: '41-0402507', name: 'Mayo Clinic Hospital', city: 'Rochester', state: 'MN', zip: '55902' },
    { ein: '34-0714587', name: 'Cleveland Clinic Foundation', city: 'Cleveland', state: 'OH', zip: '44195' },
    { ein: '59-0624458', name: 'Baptist Hospital', city: 'Miami', state: 'FL', zip: '33176' },
    { ein: '23-1352166', name: 'UPMC Presbyterian Hospital', city: 'Pittsburgh', state: 'PA', zip: '15213' },
    { ein: '52-0619006', name: 'Johns Hopkins Hospital', city: 'Baltimore', state: 'MD', zip: '21287' },
    { ein: '56-0532129', name: 'Duke University Hospital', city: 'Durham', state: 'NC', zip: '27710' },
    { ein: '62-0476822', name: 'Vanderbilt University Medical Center', city: 'Nashville', state: 'TN', zip: '37232' },
    { ein: '74-0855340', name: 'Memorial Hermann Hospital', city: 'Houston', state: 'TX', zip: '77030' },
    { ein: '95-1643344', name: 'UCLA Medical Center', city: 'Los Angeles', state: 'CA', zip: '90095' },
    { ein: '53-0196549', name: 'MedStar Washington Hospital Center', city: 'Washington', state: 'DC', zip: '20010' },
    { ein: '38-1365850', name: 'Beaumont Hospital', city: 'Royal Oak', state: 'MI', zip: '48073' },
    { ein: '86-0206928', name: 'Banner University Medical Center', city: 'Tucson', state: 'AZ', zip: '85724' },
    { ein: '91-0563833', name: 'Swedish Medical Center', city: 'Seattle', state: 'WA', zip: '98122' },
    { ein: '84-0388619', name: 'Intermountain Medical Center', city: 'Murray', state: 'UT', zip: '84107' },
    { ein: '58-0566194', name: 'Emory University Hospital', city: 'Atlanta', state: 'GA', zip: '30322' },
    { ein: '39-0806390', name: 'Aurora Medical Center', city: 'Milwaukee', state: 'WI', zip: '53215' },
  ];

  const sql = `
    INSERT OR IGNORE INTO charity_hospitals (ein, name, city, state, zip_code)
    VALUES (?, ?, ?, ?, ?)
  `;

  const stmts = hospitals.map(h => ({
    sql,
    args: [h.ein, h.name, h.city, h.state, h.zip] as any[],
  }));

  await db.batch(stmts);

  console.log(`[charity] Seeded ${hospitals.length} nonprofit hospitals`);
}
