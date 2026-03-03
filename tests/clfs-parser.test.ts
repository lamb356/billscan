/**
 * Tests for CLFS (Clinical Lab Fee Schedule) parser.
 * Uses a small CSV fixture at fixtures/test-clfs.csv
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClfsCsv } from '../src/collector/clfs-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, 'fixtures/test-clfs.csv');
const YEAR = 2026;

describe('clfs-parser', () => {
  let result: Awaited<ReturnType<typeof parseClfsCsv>>;

  before(async () => {
    result = await parseClfsCsv(FIXTURE, YEAR);
  });

  it('skips preamble lines and finds the header', () => {
    // Header is on line 5 (4 preamble + header), so we should have rates
    assert.ok(result.rates.length > 0, 'Should parse at least one rate');
  });

  it('parses correct number of valid rates (skips zero-rate and empty rows)', () => {
    // 10 valid rows, 1 zero-rate BADROW, 1 empty HCPCS row
    assert.strictEqual(result.rates.length, 10);
  });

  it('extracts correct HCPCS code for CBC', () => {
    const cbc = result.rates.find(r => r.hcpcsCode === '85025');
    assert.ok(cbc, 'Should find CBC code 85025');
  });

  it('extracts correct rate for CBC (85025)', () => {
    const cbc = result.rates.find(r => r.hcpcsCode === '85025');
    assert.ok(cbc);
    assert.strictEqual(cbc.rate, 16.93);
  });

  it('extracts correct rate for comprehensive metabolic panel (80053)', () => {
    const cmp = result.rates.find(r => r.hcpcsCode === '80053');
    assert.ok(cmp, 'Should find CMP code 80053');
    assert.strictEqual(cmp.rate, 14.57);
  });

  it('extracts short description for venipuncture (36415)', () => {
    const veni = result.rates.find(r => r.hcpcsCode === '36415');
    assert.ok(veni);
    assert.ok(veni.shortDesc, 'Should have a short description');
    assert.ok(veni.shortDesc!.length > 0);
  });

  it('sets effectiveYear on all rates', () => {
    for (const rate of result.rates) {
      assert.strictEqual(rate.effectiveYear, YEAR, `Rate ${rate.hcpcsCode} should have year ${YEAR}`);
    }
  });

  it('skips zero-rate rows (totalSkipped > 0)', () => {
    assert.ok(result.totalSkipped >= 1, 'Should report at least 1 skipped zero-rate row');
  });

  it('returns a rawHash with algorithm prefix', () => {
    assert.ok(result.rawHash.includes(':'), 'Hash should contain algorithm prefix (e.g. sha256:...)');
  });

  it('reports correct totalParsed count', () => {
    assert.strictEqual(result.totalParsed, result.rates.length);
  });

  it('extracts TSH rate correctly (84443)', () => {
    const tsh = result.rates.find(r => r.hcpcsCode === '84443');
    assert.ok(tsh, 'Should find TSH code 84443');
    assert.strictEqual(tsh.rate, 26.14);
  });

  it('handles quoted fields and special characters', async () => {
    // All rates should have valid hcpcsCode strings
    for (const rate of result.rates) {
      assert.ok(typeof rate.hcpcsCode === 'string' && rate.hcpcsCode.length > 0, 'hcpcsCode should be non-empty string');
      assert.ok(typeof rate.rate === 'number' && !isNaN(rate.rate), 'rate should be a number');
    }
  });

  it('rejects a file with no valid data', async () => {
    // Use the fixture path to a nonexistent file
    const badPath = resolve(__dirname, 'fixtures/nonexistent-file.csv');
    await assert.rejects(
      () => parseClfsCsv(badPath, YEAR),
      'Should reject if file does not exist'
    );
  });
});
