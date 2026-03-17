/**
 * Test script for the description-to-CPT matcher.
 *
 * Exercises dictionary matching, fuzzy matching, and prints results
 * for a variety of common bill descriptions.
 *
 * Run: npx tsx scripts/test-desc-match.ts
 */

import { matchDescriptionToCpt } from '../src/matcher/description-matcher.js';

const testCases = [
  // Exact dictionary matches
  { input: 'X-RAY LUMBAR SPINE 2 VW', expect: '72100' },
  { input: 'EMERGENCY DEPT VISIT LEVEL 5', expect: '99285' },
  { input: 'CHEST X-RAY 2 VIEWS', expect: '71046' },
  { input: 'CBC WITH DIFFERENTIAL', expect: '85025' },
  { input: 'COMPREHENSIVE METABOLIC PANEL', expect: '80053' },
  { input: 'VENIPUNCTURE', expect: '36415' },
  { input: 'EKG 12 LEAD', expect: '93000' },
  { input: 'IV PUSH SINGLE DRUG', expect: '96374' },
  { input: 'DEXAMETHASONE INJECTION', expect: 'J1100' },
  { input: 'CT HEAD WITHOUT CONTRAST', expect: '70450' },
  { input: 'MRI BRAIN WITHOUT CONTRAST', expect: '70551' },
  { input: 'THERAPEUTIC EXERCISE', expect: '97110' },
  { input: 'FLU VACCINE', expect: '90686' },
  { input: 'MODERATE SEDATION INITIAL 15 MIN', expect: '99152' },
  { input: 'SIMPLE WOUND REPAIR 2.5CM OR LESS', expect: '12001' },

  // Fuzzy matches (word order / abbreviation variations)
  { input: 'SPINE LUMBAR X-RAY 2 VIEWS', expect: '72100' },
  { input: 'ER VISIT LEVEL 5 HIGH COMPLEXITY', expect: '99285' },
  { input: 'AUTOMATED CBC DIFFERENTIAL', expect: '85025' },
  { input: 'XRAY CHEST PA AND LATERAL', expect: '71046' },
  { input: 'CT SCAN HEAD WITHOUT CONTRAST', expect: '70450' },

  // Should return null (no match)
  { input: 'ROOM AND BOARD SEMI-PRIVATE', expect: null },
  { input: 'MISCELLANEOUS SUPPLIES', expect: null },
];

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Description → CPT Matcher Test');
console.log('═══════════════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = await matchDescriptionToCpt(tc.input);
  const got = result?.cptCode ?? null;
  const ok = got === tc.expect;

  if (ok) {
    passed++;
    const method = result ? `[${result.matchMethod}, conf=${result.confidence}]` : '';
    console.log(`  ✓ "${tc.input}" → ${got ?? 'null'} ${method}`);
  } else {
    failed++;
    const method = result ? `[${result.matchMethod}, conf=${result.confidence}]` : '';
    console.log(`  ✗ "${tc.input}"`);
    console.log(`    Expected: ${tc.expect}`);
    console.log(`    Got:      ${got ?? 'null'} ${method}`);
  }
}

console.log(`\n${'─'.repeat(63)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${testCases.length} total`);
console.log('═══════════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
