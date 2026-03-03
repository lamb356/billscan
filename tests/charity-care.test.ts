/**
 * Tests for charity care checker.
 * Tests nonprofit hospital lookup, unknown hospital fallback, and ZIP-based lookup.
 * Uses a seeded in-memory database approach.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkCharityCare, seedCharityHospitals } from '../src/analyzer/charity-care.js';
import { getDb, closeDb } from '../src/db/connection.js';

describe('charity-care', () => {
  before(() => {
    // Ensure migrations run and seed the charity hospitals table
    const db = getDb();
    // Seed the known hospitals
    seedCharityHospitals();
  });

  describe('checkCharityCare() - known nonprofit hospitals', () => {
    it('finds Johns Hopkins Hospital by name', () => {
      const result = checkCharityCare('Johns Hopkins Hospital');
      assert.strictEqual(result.isNonprofit, true);
      assert.ok(result.hospitalName && result.hospitalName.includes('Johns Hopkins'), 'Hospital name should contain "Johns Hopkins"');
    });

    it('returns ein for Johns Hopkins', () => {
      const result = checkCharityCare('Johns Hopkins Hospital');
      assert.ok(result.ein, 'Should have an EIN');
      assert.ok(result.ein!.includes('-'), 'EIN should be formatted with hyphen');
    });

    it('includes ACA advice in results for nonprofit', () => {
      const result = checkCharityCare('Johns Hopkins Hospital');
      assert.ok(result.advice.length >= 3, 'Should have multiple advice items');
      const allAdvice = result.advice.join(' ');
      assert.ok(allAdvice.includes('FAP') || allAdvice.includes('Financial Assistance'), 'Advice should mention FAP');
    });

    it('finds Mayo Clinic Hospital by name', () => {
      const result = checkCharityCare('Mayo Clinic Hospital');
      assert.strictEqual(result.isNonprofit, true);
    });

    it('finds hospital by partial name match (case insensitive)', () => {
      const result = checkCharityCare('cleveland clinic');
      assert.strictEqual(result.isNonprofit, true);
      assert.ok(result.hospitalName, 'Should have hospital name');
    });

    it('returns state for matched hospital', () => {
      const result = checkCharityCare('Massachusetts General Hospital');
      assert.strictEqual(result.isNonprofit, true);
      assert.strictEqual(result.state, 'MA');
    });
  });

  describe('checkCharityCare() - unknown hospital returns general advice', () => {
    it('returns isNonprofit=false for unknown hospital', () => {
      const result = checkCharityCare('Totally Unknown Medical Center XYZ12345');
      assert.strictEqual(result.isNonprofit, false);
    });

    it('returns general advice for unknown hospital', () => {
      const result = checkCharityCare('Unknown Hospital');
      assert.ok(result.advice.length > 0, 'Should return advice even for unknown hospital');
      const allAdvice = result.advice.join(' ');
      assert.ok(
        allAdvice.includes('501(c)(3)') || allAdvice.includes('Financial Assistance') || allAdvice.includes('nonprofit'),
        'Advice should include guidance about checking nonprofit status'
      );
    });

    it('includes the facility name in the "could not confirm" advice', () => {
      const facilityName = 'Unknown Medical Center';
      const result = checkCharityCare(facilityName);
      const allAdvice = result.advice.join(' ');
      assert.ok(allAdvice.includes(facilityName), 'Advice should mention the queried facility name');
    });

    it('returns null ein for unknown hospital', () => {
      const result = checkCharityCare('Unknown Hospital XYZ');
      assert.strictEqual(result.ein, null);
    });

    it('returns null fapUrl for unknown hospital', () => {
      const result = checkCharityCare('Unknown Hospital XYZ');
      assert.strictEqual(result.fapUrl, null);
    });
  });

  describe('checkCharityCare() - ZIP-based lookup', () => {
    it('finds a hospital by ZIP code when name does not match', () => {
      // Baptist Hospital is at zip 33176 (Miami FL)
      const result = checkCharityCare('Some Unknown Name', '33176');
      // The ZIP lookup should find Baptist Hospital
      assert.strictEqual(result.isNonprofit, true, 'Should find nonprofit hospital by ZIP 33176');
    });

    it('falls back to general advice for unrecognized ZIP', () => {
      const result = checkCharityCare('Unknown Hospital', '00001');
      assert.strictEqual(result.isNonprofit, false, 'Unknown ZIP should not match');
    });

    it('prefers name match over ZIP match', () => {
      // Johns Hopkins is in 21287, but providing a different hospital name with that ZIP
      // Name match takes priority
      const result = checkCharityCare('Johns Hopkins Hospital', '99999');
      assert.strictEqual(result.isNonprofit, true, 'Name match should succeed regardless of ZIP');
    });
  });

  describe('seedCharityHospitals()', () => {
    it('seeds at least 15 known hospitals', () => {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM charity_hospitals').get() as { c: number }).c;
      assert.ok(count >= 15, `Should have at least 15 seeded hospitals, got ${count}`);
    });

    it('is idempotent (running seed twice does not error)', () => {
      assert.doesNotThrow(() => seedCharityHospitals(), 'Seed should not throw on second call');
    });
  });
});
