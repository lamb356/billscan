/**
 * Tests for multi-source rate matcher.
 * Tests PFS, CLFS, ASP fallback logic, severity, and dispute strength calculation.
 * DB-dependent tests gracefully skip if the database is empty.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { matchRateMulti, calculateSeverity, calculateDisputeStrength } from '../src/matcher/multi-matcher.js';
import { getDb, closeDb } from '../src/db/connection.js';

// Helper: check if specific table has data
function tableHasData(tableName: string): boolean {
  try {
    const db = getDb();
    const result = db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number };
    return result.c > 0;
  } catch {
    return false;
  }
}

function hasPfsData(): boolean {
  try {
    const db = getDb();
    const snap = db.prepare('SELECT COUNT(*) as c FROM cms_snapshots').get() as { c: number };
    if (snap.c === 0) return false;
    const rates = db.prepare('SELECT COUNT(*) as c FROM cms_rates').get() as { c: number };
    return rates.c > 0;
  } catch {
    return false;
  }
}

describe('multi-matcher', () => {
  // ── calculateSeverity (pure function, no DB needed) ──────────────────────

  describe('calculateSeverity()', () => {
    it('returns "extreme" for multiplier > 10', () => {
      assert.strictEqual(calculateSeverity(11), 'extreme');
      assert.strictEqual(calculateSeverity(100), 'extreme');
    });

    it('returns "high" for multiplier > 5 and <= 10', () => {
      assert.strictEqual(calculateSeverity(5.1), 'high');
      assert.strictEqual(calculateSeverity(10), 'high');
    });

    it('returns "medium" for multiplier > 2 and <= 5', () => {
      assert.strictEqual(calculateSeverity(2.1), 'medium');
      assert.strictEqual(calculateSeverity(5), 'medium');
    });

    it('returns "low" for multiplier <= 2', () => {
      assert.strictEqual(calculateSeverity(1), 'low');
      assert.strictEqual(calculateSeverity(2), 'low');
      assert.strictEqual(calculateSeverity(0.5), 'low');
    });
  });

  // ── calculateDisputeStrength (pure function, no DB needed) ───────────────

  describe('calculateDisputeStrength()', () => {
    it('returns "none" for unmatched mode', () => {
      assert.strictEqual(calculateDisputeStrength('unmatched', null, null), 'none');
      assert.strictEqual(calculateDisputeStrength('unmatched', 'pfs', 5), 'none');
    });

    it('returns "none" when multiplier is null', () => {
      assert.strictEqual(calculateDisputeStrength('exact_code_only', 'pfs', null), 'none');
    });

    it('returns "strong" for exact match with PFS and high multiplier', () => {
      // PFS has sourceBonus 0.5, threshold for strong is 3 - 0.5 = 2.5
      const result = calculateDisputeStrength('exact_code_only', 'pfs', 3);
      assert.strictEqual(result, 'strong');
    });

    it('returns "strong" for exact match with CLFS and high multiplier', () => {
      const result = calculateDisputeStrength('exact_code_only', 'clfs', 3);
      assert.strictEqual(result, 'strong');
    });

    it('returns "moderate" for exact match with PFS and moderate multiplier', () => {
      // Threshold for moderate with pfs: > 2 - 0.5 = 1.5 and <= 2.5
      const result = calculateDisputeStrength('exact_code_only', 'pfs', 2);
      assert.strictEqual(result, 'moderate');
    });

    it('returns "weak" for exact match with low multiplier', () => {
      // Below moderate threshold even with source bonus
      const result = calculateDisputeStrength('exact_code_only', 'pfs', 1.2);
      assert.strictEqual(result, 'weak');
    });

    it('returns "strong" for exact+modifier match with high multiplier and pfs', () => {
      const result = calculateDisputeStrength('exact_code_modifier', 'pfs', 5);
      assert.strictEqual(result, 'strong');
    });

    it('returns "moderate" for ASP source with multiplier > 2 but <= 3', () => {
      // ASP has no sourceBonus, threshold for moderate is multiplier > 2.0
      const result = calculateDisputeStrength('exact_code_only', 'asp', 2.5);
      assert.strictEqual(result, 'moderate');
    });

    it('returns "weak" for ASP source with multiplier <= 2', () => {
      // Below the moderate threshold for ASP (no source bonus)
      const result = calculateDisputeStrength('exact_code_only', 'asp', 1.8);
      assert.strictEqual(result, 'weak');
    });
  });

  // ── matchRateMulti (DB-dependent) ────────────────────────────────────────

  describe('matchRateMulti() - unmatched code (no DB needed)', () => {
    it('returns unmatched result for a completely nonexistent code', () => {
      // Even with DB loaded, "ZZZZ9" is not a real code
      const result = matchRateMulti('ZZZZ9');
      assert.strictEqual(result.matchMode, 'unmatched');
      assert.strictEqual(result.rateSource, null);
      assert.strictEqual(result.cmsRateUsed, null);
      assert.strictEqual(result.facilityRate, null);
      assert.strictEqual(result.nonFacilityRate, null);
    });

    it('returns disputeStrength "none" for unmatched code', () => {
      const result = matchRateMulti('ZZZZ9');
      assert.strictEqual(result.disputeStrength, 'none');
    });
  });

  describe('matchRateMulti() - PFS match (requires populated DB)', () => {
    it('matches 99285 from PFS when PFS data is loaded', function() {
      if (!hasPfsData()) {
        this.skip('PFS data not loaded — skipping');
        return;
      }
      const result = matchRateMulti('99285', undefined, 'facility');
      assert.ok(['pfs', 'opps'].includes(result.rateSource!), `Expected pfs or opps rateSource, got ${result.rateSource}`);
      assert.ok(result.cmsRateUsed !== null && result.cmsRateUsed > 0, 'CMS rate should be > 0');
      assert.ok(['exact_code_only', 'exact_code_modifier', 'exact_code_modifier_locality'].includes(result.matchMode));
    });
  });

  describe('matchRateMulti() - CLFS fallback (requires CLFS data)', () => {
    it('matches 85025 (CBC) using CLFS when data is loaded', function() {
      if (!tableHasData('clfs_rates')) {
        this.skip('CLFS data not loaded — skipping');
        return;
      }
      const result = matchRateMulti('85025', undefined, 'facility');
      // Lab code — should try CLFS first
      assert.ok(result.rateSource !== null, 'Should find a rate source');
      assert.ok(result.cmsRateUsed !== null && result.cmsRateUsed > 0, 'Should have a positive rate');
    });
  });

  describe('matchRateMulti() - ASP fallback (requires ASP data)', () => {
    it('matches J1100 (dexamethasone) using ASP when data is loaded', function() {
      if (!tableHasData('asp_rates')) {
        this.skip('ASP data not loaded — skipping');
        return;
      }
      const result = matchRateMulti('J1100', undefined, 'facility');
      assert.ok(result.rateSource !== null, 'Should find a rate source');
      // J-codes should first try ASP
      assert.ok(result.cmsRateUsed !== null && result.cmsRateUsed > 0);
    });
  });

  describe('matchRateMulti() - result shape', () => {
    it('always returns all expected fields', () => {
      const result = matchRateMulti('99999');
      // Check all required fields are present (even if null)
      assert.ok('facilityRate' in result);
      assert.ok('nonFacilityRate' in result);
      assert.ok('cmsRateUsed' in result);
      assert.ok('matchMode' in result);
      assert.ok('rateSource' in result);
      assert.ok('severity' in result);
      assert.ok('disputeStrength' in result);
      assert.ok('locality' in result);
      assert.ok('description' in result);
      assert.ok('apc' in result);
      assert.ok('statusIndicator' in result);
      assert.ok('dosage' in result);
    });

    it('normalizes CPT code to uppercase', () => {
      // Both cases should give same result
      const upper = matchRateMulti('j1100');
      const lower = matchRateMulti('J1100');
      assert.strictEqual(upper.matchMode, lower.matchMode);
    });
  });
});
