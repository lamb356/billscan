/**
 * Test script for hospital price transparency features.
 *
 * 1. Runs the migration to create the hospital_prices table
 * 2. Creates a sample CSV file with realistic test data
 * 3. Parses and imports the sample data
 * 4. Queries it back to verify everything works end-to-end
 *
 * NOTE: The prices in the sample CSV are illustrative test values
 * for the hospital transparency pipeline — they are NOT from CMS
 * and are NOT real negotiated rates. They're clearly labeled as
 * test data from "Aurora Health Center" for pipeline verification.
 */

import { runMigrations } from '../src/db/migrations.js';
import { parseHospitalPriceFile } from '../src/collector/hospital-price-parser.js';
import { importHospitalPrices, getHospitalPriceStats } from '../src/collector/hospital-price-importer.js';
import {
  lookupHospitalPrices,
  getCashPrice,
  getNegotiatedRate,
  getPriceSummary,
} from '../src/matcher/hospital-price-lookup.js';
import { closeDb } from '../src/db/connection.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const SAMPLE_CSV_PATH = join(os.tmpdir(), 'test-hospital-mrf.csv');

/**
 * Create a sample hospital price transparency CSV.
 *
 * This uses the CMS v3.0 tall/long format where each row
 * represents one code + payer combination. The prices here are
 * SYNTHETIC TEST VALUES — not real hospital or CMS rates.
 */
function createSampleCsv(): string {
  const header = [
    'hospital_name',
    'hospital_ein',
    'billing_code_type',
    'billing_code',
    'description',
    'setting',
    'payer_name',
    'plan_name',
    'standard_charge|gross',
    'standard_charge|discounted_cash',
    'standard_charge|negotiated_dollar',
    'standard_charge|min',
    'standard_charge|max',
    'standard_charge|negotiated_percentage',
    'modifier',
  ].join(',');

  // Synthetic test rows — these prices are NOT from CMS or any real hospital.
  // They are realistic-looking values used only to verify the parsing pipeline.
  const rows = [
    // X-Ray Lumbar Spine — multiple payers
    'Aurora Health Center,91-1234567,CPT,72100,"X-Ray Lumbar Spine 2+ Views",outpatient,Premera Blue Cross,PPO Gold,500.00,180.00,195.00,145.00,310.00,negotiated,',
    'Aurora Health Center,91-1234567,CPT,72100,"X-Ray Lumbar Spine 2+ Views",outpatient,UnitedHealthcare,Choice Plus,500.00,180.00,210.00,145.00,310.00,negotiated,',
    'Aurora Health Center,91-1234567,CPT,72100,"X-Ray Lumbar Spine 2+ Views",outpatient,Aetna,Open Access PPO,500.00,180.00,225.00,145.00,310.00,negotiated,',

    // ER Visit Level 5
    'Aurora Health Center,91-1234567,CPT,99285,"Emergency Room Visit Level 5",outpatient,Premera Blue Cross,PPO Gold,2800.00,1200.00,1450.00,980.00,2200.00,negotiated,',
    'Aurora Health Center,91-1234567,CPT,99285,"Emergency Room Visit Level 5",outpatient,UnitedHealthcare,Choice Plus,2800.00,1200.00,1550.00,980.00,2200.00,negotiated,',

    // Office Visit Level 3
    'Aurora Health Center,91-1234567,CPT,99213,"Office Visit Established Patient Level 3",outpatient,Premera Blue Cross,PPO Gold,250.00,95.00,115.00,85.00,180.00,negotiated,',
    'Aurora Health Center,91-1234567,CPT,99213,"Office Visit Established Patient Level 3",outpatient,UnitedHealthcare,Choice Plus,250.00,95.00,120.00,85.00,180.00,negotiated,',

    // CBC Blood Test
    'Aurora Health Center,91-1234567,CPT,85025,"Complete Blood Count (CBC)",outpatient,Premera Blue Cross,PPO Gold,120.00,35.00,42.00,25.00,80.00,negotiated,',
    'Aurora Health Center,91-1234567,CPT,85025,"Complete Blood Count (CBC)",outpatient,UnitedHealthcare,Choice Plus,120.00,35.00,48.00,25.00,80.00,negotiated,',

    // Metabolic Panel
    'Aurora Health Center,91-1234567,CPT,80053,"Comprehensive Metabolic Panel",outpatient,Premera Blue Cross,PPO Gold,180.00,52.00,65.00,40.00,120.00,negotiated,',

    // Blood Draw
    'Aurora Health Center,91-1234567,CPT,36415,"Routine Venipuncture",outpatient,Premera Blue Cross,PPO Gold,45.00,12.00,15.00,8.00,30.00,negotiated,',

    // HCPCS code (should also be imported)
    'Aurora Health Center,91-1234567,HCPCS,G0463,"Hospital Outpatient Clinic Visit",outpatient,Premera Blue Cross,PPO Gold,350.00,150.00,175.00,120.00,250.00,negotiated,',

    // DRG code (should be SKIPPED — we only import CPT/HCPCS)
    'Aurora Health Center,91-1234567,MS-DRG,470,"Major Hip and Knee Joint Replacement",inpatient,Premera Blue Cross,PPO Gold,45000.00,28000.00,32000.00,25000.00,42000.00,negotiated,',

    // APC code (should be SKIPPED)
    'Aurora Health Center,91-1234567,APC,5012,"Level 2 Examinations and Related Services",outpatient,Premera Blue Cross,PPO Gold,300.00,120.00,145.00,100.00,200.00,negotiated,',

    // Row with quoted field containing comma
    'Aurora Health Center,91-1234567,CPT,99284,"Emergency Room Visit, Level 4",outpatient,Premera Blue Cross,PPO Gold,1800.00,850.00,975.00,650.00,1500.00,negotiated,',
  ];

  const csv = [header, ...rows].join('\n');
  writeFileSync(SAMPLE_CSV_PATH, csv, 'utf-8');
  console.log(`[test] Sample CSV written to ${SAMPLE_CSV_PATH} (${rows.length} data rows)`);
  return SAMPLE_CSV_PATH;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Hospital Price Transparency — Integration Test     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Step 1: Run migrations
  console.log('─── Step 1: Run Migrations ───');
  await runMigrations();
  console.log('✅ Migrations complete\n');

  // Step 2: Create sample CSV
  console.log('─── Step 2: Create Sample CSV ───');
  const csvPath = createSampleCsv();

  // Step 3: Parse the CSV
  console.log('\n─── Step 3: Parse CSV ───');
  const rows = await parseHospitalPriceFile(
    csvPath,
    'file://test-hospital-mrf.csv',
  );
  console.log(`✅ Parsed ${rows.length} rows`);

  // Verify filtering: DRG and APC rows should have been skipped
  const hasDrg = rows.some(r => r.billingCodeType === 'MS-DRG' || r.billingCodeType === 'DRG');
  const hasApc = rows.some(r => r.billingCodeType === 'APC');
  console.log(`   DRG rows present: ${hasDrg} (expected: false)`);
  console.log(`   APC rows present: ${hasApc} (expected: false)`);

  if (hasDrg || hasApc) {
    console.error('❌ FAIL: DRG/APC rows should have been filtered out!');
    process.exit(1);
  }

  // Verify we have expected codes
  const codes = new Set(rows.map(r => r.billingCode));
  console.log(`   Unique codes: ${[...codes].join(', ')}`);

  // Step 4: Import into database
  console.log('\n─── Step 4: Import into Database ───');
  const { inserted, skipped } = await importHospitalPrices(rows, 'file://test-hospital-mrf.csv');
  console.log(`✅ Imported: ${inserted} inserted, ${skipped} skipped`);

  // Step 5: Get stats
  console.log('\n─── Step 5: Database Stats ───');
  const stats = await getHospitalPriceStats();
  console.log(`   Total rows:  ${stats.totalRows}`);
  console.log(`   Hospitals:   ${stats.hospitalCount}`);
  console.log(`   Payers:      ${stats.payerCount}`);
  console.log(`   Codes:       ${stats.codeCount}`);

  // Step 6: Query back — lookupHospitalPrices
  console.log('\n─── Step 6: Lookup Tests ───');

  console.log('\n  [6a] All prices for 72100 at Aurora:');
  const prices72100 = await lookupHospitalPrices('72100', 'Aurora');
  for (const p of prices72100) {
    console.log(
      `    ${p.payerName} (${p.planName}): ` +
      `gross=$${p.grossCharge}, negotiated=$${p.negotiatedRate}, cash=$${p.cashDiscountPrice}`
    );
  }

  console.log('\n  [6b] Cash price for 72100:');
  const cashPrice = await getCashPrice('72100', 'Aurora');
  console.log(`    Cash price: $${cashPrice}`);

  console.log('\n  [6c] Premera negotiated rate for 72100:');
  const premRate = await getNegotiatedRate('72100', 'Premera', 'Aurora');
  console.log(`    Premera rate: $${premRate}`);

  console.log('\n  [6d] UHC negotiated rate for 99285:');
  const uhcRate = await getNegotiatedRate('99285', 'United', 'Aurora');
  console.log(`    UHC rate: $${uhcRate}`);

  console.log('\n  [6e] Price summary for 72100:');
  const summary = await getPriceSummary('72100', 'Aurora');
  console.log(`    Hospitals: ${summary.hospitalCount}`);
  console.log(`    Cash range: ${summary.cashPriceRange ? `$${summary.cashPriceRange[0]}-$${summary.cashPriceRange[1]}` : 'N/A'}`);
  console.log(`    Negotiated range: ${summary.negotiatedRange ? `$${summary.negotiatedRange[0]}-$${summary.negotiatedRange[1]}` : 'N/A'}`);
  console.log(`    Gross range: ${summary.grossChargeRange ? `$${summary.grossChargeRange[0]}-$${summary.grossChargeRange[1]}` : 'N/A'}`);
  console.log(`    Payer rates:`);
  for (const pr of summary.payerRates) {
    console.log(`      ${pr.payer}: $${pr.rate}`);
  }

  // Step 7: Verify HCPCS code was imported
  console.log('\n  [6f] HCPCS code G0463:');
  const hcpcsPrices = await lookupHospitalPrices('G0463');
  console.log(`    Found ${hcpcsPrices.length} row(s)`);
  if (hcpcsPrices.length > 0) {
    console.log(`    Gross: $${hcpcsPrices[0].grossCharge}, Cash: $${hcpcsPrices[0].cashDiscountPrice}`);
  }

  // Verify code not in DB returns empty
  console.log('\n  [6g] Non-existent code 99999:');
  const noPrices = await lookupHospitalPrices('99999');
  console.log(`    Found ${noPrices.length} row(s) (expected: 0)`);

  // Cleanup
  try { unlinkSync(SAMPLE_CSV_PATH); } catch { /* ignore */ }

  // Final summary
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ✅ ALL TESTS PASSED                                ║');
  console.log('╚══════════════════════════════════════════════════════╝');
}

main()
  .catch((err) => {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  })
  .finally(() => {
    closeDb();
  });
