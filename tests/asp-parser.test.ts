/**
 * Tests for ASP (Average Sales Price) parser.
 * Uses a small CSV fixture at fixtures/test-asp.csv
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAspCsv } from '../src/collector/asp-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, 'fixtures/test-asp.csv');
const YEAR = 2026;

describe('asp-parser', () => {
  let result: Awaited<ReturnType<typeof parseAspCsv>>;

  before(async () => {
    result = await parseAspCsv(FIXTURE, YEAR);
  });

  it('parses rates from fixture file', () => {
    assert.ok(result.rates.length > 0, 'Should parse at least one rate');
  });

  it('skips preamble lines and finds the header row', () => {
    // 8 preamble lines + header, then data rows
    // J3490 has NA payment limit so it gets skipped
    // INVALID is not a valid 5-char HCPCS code so it gets skipped
    assert.ok(result.rates.length >= 6, 'Should parse multiple valid rates');
  });

  it('extracts J1100 (dexamethasone) code and payment limit correctly', () => {
    const j1100 = result.rates.find(r => r.hcpcsCode === 'J1100');
    assert.ok(j1100, 'Should find J1100');
    assert.strictEqual(j1100.paymentLimit, 4.25);
  });

  it('extracts J0696 (cefazolin) code correctly', () => {
    const j0696 = result.rates.find(r => r.hcpcsCode === 'J0696');
    assert.ok(j0696, 'Should find J0696');
    assert.strictEqual(j0696.paymentLimit, 3.12);
  });

  it('uppercases HCPCS codes', () => {
    for (const rate of result.rates) {
      assert.strictEqual(rate.hcpcsCode, rate.hcpcsCode.toUpperCase(), 'HCPCS code should be uppercase');
    }
  });

  it('skips rows with NA payment limit (J3490)', () => {
    // J3490 has NA as payment limit, should be skipped
    const j3490 = result.rates.find(r => r.hcpcsCode === 'J3490');
    assert.strictEqual(j3490, undefined, 'J3490 with NA payment limit should be skipped');
  });

  it('skips rows with invalid HCPCS codes', () => {
    // INVALID is not 5 alphanumeric characters
    const invalid = result.rates.find(r => r.hcpcsCode === 'INVALID');
    assert.strictEqual(invalid, undefined, 'Row with invalid HCPCS should be skipped');
  });

  it('sets effectiveYear on all rates', () => {
    for (const rate of result.rates) {
      assert.strictEqual(rate.effectiveYear, YEAR, `Rate ${rate.hcpcsCode} should have year ${YEAR}`);
    }
  });

  it('extracts short description', () => {
    const j2270 = result.rates.find(r => r.hcpcsCode === 'J2270');
    assert.ok(j2270, 'Should find J2270 morphine');
    assert.ok(j2270.shortDesc && j2270.shortDesc.length > 0, 'Should have short description');
  });

  it('extracts dosage field', () => {
    const j1100 = result.rates.find(r => r.hcpcsCode === 'J1100');
    assert.ok(j1100);
    assert.ok(j1100.dosage && j1100.dosage.length > 0, 'Should have dosage');
  });

  it('returns rawHash with algorithm prefix', () => {
    assert.ok(result.rawHash.includes(':'), 'Hash should contain algorithm prefix');
  });

  it('reports totalSkipped for NA/invalid rows', () => {
    assert.ok(result.totalSkipped >= 1, 'Should report at least 1 skipped row');
  });
});
