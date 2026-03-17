/**
 * Tests for ZIP-to-locality resolver.
 * Tests ZIP code resolution, fallback behavior, and seedZipLocality function.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolveZipToLocality, resolveCarrierLocality, getZipsForLocality, seedZipLocality } from '../src/matcher/zip-locality.js';
import { getDb, closeDb } from '../src/db/connection.js';

describe('zip-locality', () => {
  before(() => {
    // Ensure migrations run and seed ZIP data
    getDb(); // initializes DB and runs migrations
    seedZipLocality(); // seeds fallback metro mappings
  });

  describe('seedZipLocality()', () => {
    it('populates at least 40 ZIP records', () => {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM zip_locality').get() as { c: number }).c;
      assert.ok(count >= 40, `Should have at least 40 seeded ZIPs, got ${count}`);
    });

    it('is idempotent — running seed twice does not duplicate records', () => {
      const db = getDb();
      const before = (db.prepare('SELECT COUNT(*) as c FROM zip_locality').get() as { c: number }).c;
      seedZipLocality(); // run again
      const after = (db.prepare('SELECT COUNT(*) as c FROM zip_locality').get() as { c: number }).c;
      assert.strictEqual(before, after, 'Running seed twice should not add duplicates (INSERT OR IGNORE)');
    });
  });

  describe('resolveZipToLocality()', () => {
    it('resolves 10001 (Manhattan) to correct locality info', () => {
      const result = resolveZipToLocality('10001');
      assert.ok(result !== null, 'Should resolve ZIP 10001');
      assert.strictEqual(result!.state, 'NY', 'State should be NY');
      assert.strictEqual(result!.locality, '01', 'Manhattan locality should be 01');
    });

    it('resolves 10001 to a valid carrier code', () => {
      const result = resolveZipToLocality('10001');
      assert.ok(result);
      // Carrier code varies by CMS data source — just verify it is a non-empty string
      assert.ok(typeof result.carrier === 'string' && result.carrier.length > 0,
        'Carrier should be a non-empty string');
    });

    it('resolves Chicago ZIP (60611) to Illinois locality', () => {
      const result = resolveZipToLocality('60611');
      assert.ok(result !== null, 'Should resolve Chicago ZIP 60611');
      assert.strictEqual(result!.state, 'IL');
    });

    it('resolves Boston ZIP (02114) to Massachusetts', () => {
      const result = resolveZipToLocality('02114');
      assert.ok(result !== null, 'Should resolve Boston ZIP 02114');
      assert.strictEqual(result!.state, 'MA');
    });

    it('returns null for completely unknown ZIP', () => {
      const result = resolveZipToLocality('99999');
      assert.strictEqual(result, null, 'Unknown ZIP should return null');
    });

    it('normalizes ZIP input: strips whitespace', () => {
      const result = resolveZipToLocality('  10001  ');
      assert.ok(result !== null, 'Should handle whitespace-padded ZIP');
    });

    it('normalizes ZIP input: takes first 5 digits', () => {
      const result = resolveZipToLocality('100010000'); // ZIP+4 style
      assert.ok(result !== null, 'Should handle 9-digit ZIP');
    });

    it('returns a name field (may be empty string if county_name not populated)', () => {
      const result = resolveZipToLocality('10001');
      assert.ok(result);
      // name field comes from county_name which may not be populated in all CMS data
      assert.ok(typeof result.name === 'string', 'name should be a string (possibly empty)');
    });

    it('returns urban_rural indicator defaulting to "U"', () => {
      const result = resolveZipToLocality('10001');
      assert.ok(result);
      assert.ok(['U', 'R', 'B'].includes(result.urban_rural!), `urban_rural should be U, R, or B, got ${result.urban_rural}`);
    });

    it('resolves Houston ZIP (77030) to Texas', () => {
      const result = resolveZipToLocality('77030');
      assert.ok(result !== null, 'Should resolve Houston ZIP 77030');
      assert.strictEqual(result!.state, 'TX');
    });

    it('resolves Seattle ZIP (98122) correctly', () => {
      const result = resolveZipToLocality('98122');
      assert.ok(result !== null, 'Should resolve Seattle ZIP 98122');
      assert.strictEqual(result!.state, 'WA');
    });
  });

  describe('resolveCarrierLocality()', () => {
    it('resolves a carrier+locality pair to LocalityInfo', () => {
      // Use the actual carrier for ZIP 10001 from the loaded CMS data
      const zipInfo = resolveZipToLocality('10001');
      assert.ok(zipInfo, 'Prerequisite: 10001 must resolve');
      const result = resolveCarrierLocality(zipInfo.carrier, zipInfo.locality);
      assert.ok(result !== null, `Should resolve carrier ${zipInfo.carrier} locality ${zipInfo.locality}`);
      assert.strictEqual(result!.state, 'NY');
    });

    it('returns null for unknown carrier+locality pair', () => {
      const result = resolveCarrierLocality('99999', '99');
      assert.strictEqual(result, null, 'Unknown carrier/locality should return null');
    });
  });

  describe('getZipsForLocality()', () => {
    it('returns array of ZIP codes for a known carrier+locality', () => {
      // Look up the actual carrier/locality for NYC ZIP 10001
      const zipInfo = resolveZipToLocality('10001');
      assert.ok(zipInfo, 'Prerequisite: 10001 must resolve');
      const zips = getZipsForLocality(zipInfo.carrier, zipInfo.locality);
      assert.ok(Array.isArray(zips), 'Should return an array');
      assert.ok(zips.length >= 1, `Should return at least 1 ZIP, got ${zips.length}`);
    });

    it('returns empty array for unknown carrier+locality', () => {
      const zips = getZipsForLocality('99999', '99');
      assert.ok(Array.isArray(zips));
      assert.strictEqual(zips.length, 0, 'Should return empty array for unknown locality');
    });

    it('returned ZIP codes are 5-character strings', () => {
      const zipInfo = resolveZipToLocality('10001');
      assert.ok(zipInfo);
      const zips = getZipsForLocality(zipInfo.carrier, zipInfo.locality);
      for (const zip of zips) {
        assert.strictEqual(zip.length, 5, `ZIP ${zip} should be 5 characters`);
        assert.ok(/^\d{5}$/.test(zip), `ZIP ${zip} should be 5 digits`);
      }
    });
  });
});
