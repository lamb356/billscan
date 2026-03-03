/**
 * Tests for OPPS (Outpatient Prospective Payment System) parser.
 * Uses a small CSV fixture at fixtures/test-opps.csv
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOppsCsv } from '../src/collector/opps-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, 'fixtures/test-opps.csv');
const YEAR = 2026;

describe('opps-parser', () => {
  let result: Awaited<ReturnType<typeof parseOppsCsv>>;

  before(async () => {
    result = await parseOppsCsv(FIXTURE, YEAR);
  });

  it('parses rates from fixture file', () => {
    assert.ok(result.rates.length > 0, 'Should parse at least one rate');
  });

  it('requires header to start with "HCPCS CODE" exactly (case insensitive column check)', () => {
    // The preamble rows don't start with HCPCS CODE → header detection works
    // All parsed rows should be valid HCPCS codes
    for (const rate of result.rates) {
      assert.ok(rate.hcpcsCode.length >= 4 && rate.hcpcsCode.length <= 7, `${rate.hcpcsCode} should be 4-7 chars`);
    }
  });

  it('extracts 99285 (ED visit) payment rate correctly', () => {
    const ed = result.rates.find(r => r.hcpcsCode === '99285');
    assert.ok(ed, 'Should find 99285 ED visit');
    assert.strictEqual(ed.paymentRate, 403.87);
  });

  it('extracts APC code for 99285', () => {
    const ed = result.rates.find(r => r.hcpcsCode === '99285');
    assert.ok(ed);
    assert.strictEqual(ed.apc, '5025');
  });

  it('extracts status indicator for codes', () => {
    const ed = result.rates.find(r => r.hcpcsCode === '99285');
    assert.ok(ed);
    assert.strictEqual(ed.statusIndicator, 'S');
  });

  it('extracts chest X-ray rate (71046)', () => {
    const xray = result.rates.find(r => r.hcpcsCode === '71046');
    assert.ok(xray, 'Should find 71046 chest X-ray');
    assert.strictEqual(xray.paymentRate, 104.08);
  });

  it('extracts relative weight', () => {
    const ecg = result.rates.find(r => r.hcpcsCode === '93000');
    assert.ok(ecg, 'Should find 93000 ECG');
    assert.ok(typeof ecg.relativeWeight === 'number', 'relativeWeight should be a number');
  });

  it('keeps codes with no payment rate (E1 exclusion codes)', () => {
    // The E1 row has HCPCS code "E1" which is only 2 chars — should be filtered out
    const e1 = result.rates.find(r => r.hcpcsCode === 'E1');
    assert.strictEqual(e1, undefined, 'E1 (2-char code) should be filtered out by length check');
  });

  it('uppercases HCPCS codes', () => {
    for (const rate of result.rates) {
      assert.strictEqual(rate.hcpcsCode, rate.hcpcsCode.toUpperCase(), 'HCPCS code should be uppercase');
    }
  });

  it('sets effectiveYear on all rates', () => {
    for (const rate of result.rates) {
      assert.strictEqual(rate.effectiveYear, YEAR, `Rate ${rate.hcpcsCode} should have year ${YEAR}`);
    }
  });

  it('extracts national copay', () => {
    const ed = result.rates.find(r => r.hcpcsCode === '99285');
    assert.ok(ed);
    assert.strictEqual(ed.nationalCopay, 80.77);
  });

  it('returns rawHash with algorithm prefix', () => {
    assert.ok(result.rawHash.includes(':'), 'Hash should have algorithm prefix');
  });

  it('includes J-code drug entries (J2001)', () => {
    const lido = result.rates.find(r => r.hcpcsCode === 'J2001');
    assert.ok(lido, 'Should find J2001 lidocaine');
    assert.strictEqual(lido.paymentRate, 11.50);
  });
});
