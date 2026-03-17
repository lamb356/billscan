import { createClient } from '@libsql/client';

const db = createClient({ url: 'file:data/billscan.db' });

async function main() {
  // Look up CPT 72100 - Lumbar spine x-ray 2 views
  console.log('=== CPT 72100: X-RAY LUMBAR SPINE 2 VIEWS ===');
  const rates = await db.execute({ 
    sql: "SELECT cpt_code, facility_rate, non_facility_rate, locality, description FROM cms_rates WHERE cpt_code = '72100' ORDER BY locality LIMIT 20", 
    args: [] 
  });
  console.log(`Found ${rates.rows.length} rows`);
  for (const r of rates.rows.slice(0, 5)) {
    console.log(`  Locality ${(r as any).locality}: facility=$${(r as any).facility_rate}, non-facility=$${(r as any).non_facility_rate}`);
  }

  // Get WI-specific rate (locality 00, carrier 06302)
  const wiRate = await db.execute({
    sql: "SELECT * FROM cms_rates WHERE cpt_code = '72100' AND locality = '00'",
    args: []
  });
  console.log(`\nWI (locality 00) rows: ${wiRate.rows.length}`);
  for (const r of wiRate.rows) {
    console.log(`  facility=$${(r as any).facility_rate}, non-facility=$${(r as any).non_facility_rate}, desc=${(r as any).description}`);
  }

  // National average
  const allRates = await db.execute({
    sql: "SELECT AVG(facility_rate) as avg_fac, AVG(non_facility_rate) as avg_nonfac, MIN(facility_rate) as min_fac, MAX(facility_rate) as max_fac FROM cms_rates WHERE cpt_code = '72100' AND facility_rate > 0",
    args: []
  });
  console.log('\nNational stats:', JSON.stringify(allRates.rows[0], null, 2));

  // Also check 72110 (4+ views) 
  console.log('\n=== CPT 72110: X-RAY LUMBAR SPINE 4+ VIEWS ===');
  const r2 = await db.execute({
    sql: "SELECT cpt_code, facility_rate, non_facility_rate FROM cms_rates WHERE cpt_code = '72110' AND locality = '00' LIMIT 5",
    args: []
  });
  for (const r of r2.rows) {
    console.log(`  facility=$${(r as any).facility_rate}, non-facility=$${(r as any).non_facility_rate}`);
  }

  // The billed amount was $314 - calculate overcharge
  const wiRow = wiRate.rows[0] as any;
  if (wiRow) {
    const billed = 314.00;
    console.log('\n=== YOUR BILL ANALYSIS ===');
    console.log(`Billed: $${billed}`);
    console.log(`CMS Facility Rate (WI): $${wiRow.facility_rate}`);
    console.log(`CMS Non-Facility Rate (WI): $${wiRow.non_facility_rate}`);
    console.log(`Overcharge (facility): $${(billed - wiRow.facility_rate).toFixed(2)} (${(billed / wiRow.facility_rate).toFixed(1)}x CMS)`);
    console.log(`Overcharge (non-facility): $${(billed - wiRow.non_facility_rate).toFixed(2)} (${(billed / wiRow.non_facility_rate).toFixed(1)}x CMS)`);
  }
}

main();
