/**
 * Tests for the hashing utility.
 * Tests hash() and hashFile() functions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, hashFile, getAlgorithm } from '../src/utils/hash.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('hash utility', () => {
  describe('hash()', () => {
    it('returns a string with format algorithm:hexdigest', async () => {
      const result = await hash('hello world');
      assert.ok(typeof result === 'string', 'Result should be a string');
      assert.ok(result.includes(':'), 'Result should contain a colon separator');
      const [algo, digest] = result.split(':');
      assert.ok(algo.length > 0, 'Algorithm prefix should be non-empty');
      assert.ok(digest.length > 0, 'Digest should be non-empty');
    });

    it('returns consistent results for the same input (string)', async () => {
      const a = await hash('hello world');
      const b = await hash('hello world');
      assert.strictEqual(a, b, 'Same input should produce same hash');
    });

    it('returns different hashes for different inputs', async () => {
      const a = await hash('hello world');
      const b = await hash('hello world!');
      assert.notStrictEqual(a, b, 'Different inputs should produce different hashes');
    });

    it('handles Buffer input', async () => {
      const buf = Buffer.from('test data');
      const result = await hash(buf);
      assert.ok(result.includes(':'), 'Buffer input should produce algorithm:digest format');
    });

    it('Buffer and string of same content produce same hash', async () => {
      const content = 'same content';
      const fromString = await hash(content);
      const fromBuffer = await hash(Buffer.from(content));
      assert.strictEqual(fromString, fromBuffer, 'Same content from string and buffer should hash identically');
    });

    it('returns hex digest (lowercase hex characters)', async () => {
      const result = await hash('test');
      const digest = result.split(':')[1];
      assert.ok(/^[0-9a-f]+$/.test(digest), `Digest should be hex: got ${digest}`);
    });

    it('uses sha256 or blake3 algorithm', async () => {
      const result = await hash('test');
      const algo = result.split(':')[0];
      assert.ok(['sha256', 'blake3'].includes(algo), `Algorithm should be sha256 or blake3, got ${algo}`);
    });
  });

  describe('hashFile()', () => {
    it('hashes an existing file and returns algorithm:hexdigest', async () => {
      const fixturePath = resolve(__dirname, 'fixtures/test-clfs.csv');
      const result = await hashFile(fixturePath);
      assert.ok(result.includes(':'), 'File hash should have algorithm prefix');
    });

    it('returns consistent hashes for the same file', async () => {
      const fixturePath = resolve(__dirname, 'fixtures/test-clfs.csv');
      const a = await hashFile(fixturePath);
      const b = await hashFile(fixturePath);
      assert.strictEqual(a, b, 'Same file should produce same hash');
    });

    it('produces different hashes for different files', async () => {
      const clfs = resolve(__dirname, 'fixtures/test-clfs.csv');
      const asp = resolve(__dirname, 'fixtures/test-asp.csv');
      const hashA = await hashFile(clfs);
      const hashB = await hashFile(asp);
      assert.notStrictEqual(hashA, hashB, 'Different files should have different hashes');
    });

    it('rejects on nonexistent file', async () => {
      await assert.rejects(
        () => hashFile(resolve(__dirname, 'fixtures/no-such-file.csv')),
        'Should reject when file does not exist'
      );
    });
  });

  describe('getAlgorithm()', () => {
    it('extracts algorithm prefix from hash string', () => {
      assert.strictEqual(getAlgorithm('sha256:abc123'), 'sha256');
      assert.strictEqual(getAlgorithm('blake3:def456'), 'blake3');
    });

    it('works with the output of hash()', async () => {
      const h = await hash('test');
      const algo = getAlgorithm(h);
      assert.ok(['sha256', 'blake3'].includes(algo));
    });
  });
});
