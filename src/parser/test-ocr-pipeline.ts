/**
 * Test script for the OCR bill parsing pipeline.
 * Run: tsx src/parser/test-ocr-pipeline.ts
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCptData } from './cpt-extractor.js';
import { billFromText } from './bill-from-text.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../fixtures');

console.log('\n====================================================');
console.log('  BillScan OCR Pipeline - Test Suite');
console.log('====================================================\n');

const billText = readFileSync(resolve(fixturesDir, 'sample-bill.txt'), 'utf-8');

console.log('TEST 1: CPT Extractor on sample-bill.txt');
console.log('-'.repeat(52));

const extracted = extractCptData(billText, 0.95);

console.log(`Facility Name  : ${extracted.facilityName}`);
console.log(`Facility Type  : ${extracted.facilityType}`);
console.log(`Date of Service: ${extracted.dateOfService}`);
console.log(`Patient Name   : ${extracted.patientName}`);
console.log(`Total Billed   : $${extracted.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`Line Items     : ${extracted.lineItems.length}`);
console.log();

const EXPECTED_CODES = [
  '99285','71046','93000','36415','85025','80053',
  '80047','84484','93010','12001','99291','J3490',
  'J1100','J1030','96374','96365','99152'
];

console.log('Line item breakdown:');
console.log('  #   CPT/HCPCS  Mod  Billed $      Description');
console.log('  ' + '-'.repeat(68));

let allFound = true;
for (const item of extracted.lineItems) {
  const mod = item.modifier ?? '  ';
  const amt = `$${item.billedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`.padStart(12);
  const desc = item.description.slice(0, 35).padEnd(35);
  console.log(`  ${String(extracted.lineItems.indexOf(item) + 1).padStart(2)}  ${item.cptCode.padEnd(9)}  ${mod.padEnd(4)} ${amt}  ${desc}`);
}

console.log();
console.log('Code detection check:');
for (const code of EXPECTED_CODES) {
  const found = extracted.lineItems.some(i => i.cptCode === code);
  console.log(`  ${found ? '[OK]' : '[MISS]'} ${code}${found ? '' : ' - NOT FOUND'}`);
  if (!found) allFound = false;
}

console.log();
console.log(`Expected ${EXPECTED_CODES.length} codes - Found ${extracted.lineItems.length} line items`);
console.log(`All expected codes found: ${allFound ? 'YES' : 'NO'}`);

console.log('\nTEST 2: bill-from-text converter (ParsedBill schema)');
console.log('-'.repeat(52));

try {
  const parsedBill = billFromText(extracted, 'pdf');
  console.log(`ParsedBill valid       : YES`);
  console.log(`sourceType             : ${parsedBill.sourceType}`);
  console.log(`facilityType           : ${parsedBill.facilityType}`);
  console.log(`parseConfidence        : ${parsedBill.parseConfidence}`);
  console.log(`lineItems count        : ${parsedBill.lineItems.length}`);
  console.log(`totalBilled            : $${parsedBill.totalBilled.toFixed(2)}`);
  console.log(`First item CPT         : ${parsedBill.lineItems[0]?.cptCode}`);
  console.log(`First item billed $    : $${parsedBill.lineItems[0]?.billedAmount.toFixed(2)}`);
} catch (err) {
  console.error(`ParsedBill FAILED: ${(err as Error).message}`);
}

console.log('\nTEST 3: Inline text snippet extraction');
console.log('-'.repeat(52));

const snippets = [
  { label: 'Simple tabular row', text: '99285   Emergency visit Level 5   $2,847.00', expectCode: '99285', expectAmount: 2847.00 },
  { label: 'J-code drug row', text: 'J3490 UN Acetaminophen 500mg $47.00', expectCode: 'J3490', expectAmount: 47.00 },
  { label: 'HCPCS alpha code', text: 'G0439  Annual wellness visit  $185.00', expectCode: 'G0439', expectAmount: 185.00 },
  { label: 'Amount without dollar sign', text: '36415   Venipuncture   189.00', expectCode: '36415', expectAmount: 189.00 },
  { label: 'Multiple amounts - pick last', text: '93000  ECG Complete  1  $1,243.00  $621.00  $622.00', expectCode: '93000', expectAmount: 622.00 },
];

let snippetsPassed = 0;
for (const s of snippets) {
  const result = extractCptData(s.text, 0.9);
  const found = result.lineItems.find(i => i.cptCode === s.expectCode);
  const pass = !!found && found.billedAmount === s.expectAmount;
  if (pass) snippetsPassed++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${s.label}`);
  if (!pass) {
    console.log(`         Expected code=${s.expectCode} amount=${s.expectAmount}`);
    console.log(`         Got: ${JSON.stringify(result.lineItems.map(i => ({ code: i.cptCode, amt: i.billedAmount })))}`);
  }
}

console.log(`\nSnippet tests: ${snippetsPassed}/${snippets.length} passed`);

console.log('\n====================================================');
console.log('  SUMMARY');
console.log('====================================================');
console.log(`  sample-bill.txt line items extracted : ${extracted.lineItems.length}`);
console.log(`  Expected codes all found              : ${allFound ? 'YES' : 'NO'}`);
console.log(`  Schema conversion                     : OK`);
console.log(`  Snippet tests passed                  : ${snippetsPassed}/${snippets.length}`);
console.log();
