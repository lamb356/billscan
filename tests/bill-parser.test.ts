/**
 * Tests for the bill parser.
 * Tests parsing the existing sample-er-bill.json fixture.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBill } from '../src/parser/bill-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_BILL = resolve(__dirname, '../fixtures/sample-er-bill.json');

describe('bill-parser', () => {
  describe('parseJsonBill()', () => {
    it('parses the sample ER bill fixture without errors', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      assert.ok(bill, 'Should return a parsed bill');
    });

    it('returns the correct number of line items (12)', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      assert.strictEqual(bill.lineItems.length, 12, 'ER bill fixture should have exactly 12 line items');
    });

    it('extracts facility name correctly', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      assert.strictEqual(bill.facilityName, 'Memorial General Hospital');
    });

    it('identifies facility type as ER', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      assert.strictEqual(bill.facilityType, 'er');
    });

    it('extracts CPT code 99285 (ED level 5 visit)', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      const item = bill.lineItems.find(i => i.cptCode === '99285');
      assert.ok(item, 'Should find CPT 99285');
    });

    it('extracts J-code (J1100 dexamethasone)', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      const item = bill.lineItems.find(i => i.cptCode === 'J1100');
      assert.ok(item, 'Should find J1100');
    });

    it('extracts J3490 unclassified drug', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      const item = bill.lineItems.find(i => i.cptCode === 'J3490');
      assert.ok(item, 'Should find J3490');
    });

    it('calculates correct total billed amount ($13,184.00)', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      assert.strictEqual(bill.totalBilled, 13184.00);
    });

    it('has parse confidence of 1.0 for JSON source', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      assert.strictEqual(bill.parseConfidence, 1.0);
    });

    it('has sourceType of json', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      assert.strictEqual(bill.sourceType, 'json');
    });

    it('all line items have valid CPT codes (5-char pattern)', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      for (const item of bill.lineItems) {
        const isNumeric5 = /^\d{5}$/.test(item.cptCode);
        const isAlpha4 = /^[A-Z]\d{4}$/.test(item.cptCode);
        assert.ok(isNumeric5 || isAlpha4, `${item.cptCode} should be a valid CPT/HCPCS code`);
      }
    });

    it('all line items have positive billed amounts', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      for (const item of bill.lineItems) {
        assert.ok(item.billedAmount > 0, `Line ${item.lineNumber} should have positive billedAmount`);
      }
    });

    it('extracts line item descriptions', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      for (const item of bill.lineItems) {
        assert.ok(item.description && item.description.length > 0, `Line ${item.lineNumber} should have a description`);
      }
    });

    it('line items have sequential line numbers starting at 1', async () => {
      const bill = await parseBill(SAMPLE_BILL);
      for (let i = 0; i < bill.lineItems.length; i++) {
        assert.strictEqual(bill.lineItems[i].lineNumber, i + 1, `Line number should be ${i + 1}`);
      }
    });

    it('throws on non-existent file', async () => {
      await assert.rejects(
        () => parseBill(resolve(__dirname, 'fixtures/no-bill.json')),
        'Should throw when file does not exist'
      );
    });

    it('throws on unsupported file type', async () => {
      await assert.rejects(
        () => parseBill(resolve(__dirname, 'fixtures/test-clfs.csv')),
        'Should throw for unsupported extension'
      );
    });
  });
});
