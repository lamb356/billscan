import { detectBillingErrors } from '../src/analyzer/billing-errors.js';
import { compareSiteOfService } from '../src/analyzer/site-of-service.js';
import { detectBalanceBilling } from '../src/analyzer/balance-billing.js';
import { buildSavingsSummary } from '../src/analyzer/savings-summary.js';

async function main() {
  const lineItems = [
    { cptCode: '99285', description: 'ER VISIT LEVEL 5', billedAmount: 2800, lineNumber: 1 },
    { cptCode: '72100', description: 'X-RAY LUMBAR 2VW', billedAmount: 314, lineNumber: 2 },
    { cptCode: '99213', description: 'OFFICE VISIT', billedAmount: 250, lineNumber: 3 },
    { cptCode: '36415', description: 'BLOOD DRAW', billedAmount: 45, lineNumber: 4 },
    { cptCode: '85025', description: 'CBC', billedAmount: 120, lineNumber: 5 },
    { cptCode: '80053', description: 'METABOLIC PANEL', billedAmount: 180, lineNumber: 6 },
  ];

  console.log("=== BILLING ERRORS ===");
  try {
    const errors = await detectBillingErrors(lineItems, 'facility', '00');
    console.log(`Found ${errors.length} errors:`);
    errors.forEach(e => console.log(`  [${e.severity}] ${e.type}: ${e.description.slice(0,80)}`));
  } catch(e) { console.error("ERROR:", e); }

  console.log("\n=== SITE OF SERVICE ===");
  try {
    const sos = await compareSiteOfService(lineItems, '00');
    console.log(`Found ${sos.length} comparisons:`);
    sos.forEach(s => {
      if (s.potentialSavings && s.potentialSavings > 0) {
        console.log(`  ${s.cptCode}: fac=$${s.facilityRate}, office=$${s.nonFacilityRate}, save $${s.potentialSavings} (${s.savingsPercent}%), shoppable=${s.isShoppable}`);
      }
    });
  } catch(e) { console.error("ERROR:", e); }

  console.log("\n=== BALANCE BILLING ===");
  try {
    const findings = lineItems.map(l => ({ ...l, cmsRateUsed: 50 }));
    const bb = await detectBalanceBilling(findings);
    console.log(`Found ${bb.length} alerts:`);
    bb.forEach(b => console.log(`  [${b.severity}] ${b.type}: ${b.description.slice(0,80)}`));
  } catch(e) { console.error("ERROR:", e); }

  console.log("\n=== SAVINGS SUMMARY ===");
  try {
    const errors = await detectBillingErrors(lineItems, 'facility', '00');
    const sos = await compareSiteOfService(lineItems, '00');
    const bb = await detectBalanceBilling(lineItems.map(l => ({ ...l, cmsRateUsed: 50 })));
    const summary = buildSavingsSummary(3709, 300, errors, sos, bb);
    console.log(JSON.stringify(summary, null, 2));
  } catch(e) { console.error("ERROR:", e); }
}
main().catch(console.error);
