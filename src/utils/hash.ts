import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

// Try to use BLAKE3 (faster), fall back to SHA-256
const DEFAULT_ALGO = 'sha256';

export function getAlgorithm(): string {
  return DEFAULT_ALGO;
}

/**
 * Hash a string or Buffer using the default algorithm.
 * Returns a string in the format: "algorithm:hexdigest"
 */
export async function hash(input: string | Buffer): Promise<string> {
  const algo = getAlgorithm();
  const h = createHash(algo);
  h.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input);
  return `${algo}:${h.digest('hex')}`;
}

/**
 * Hash a file by streaming its contents.
 * Returns a string in the format: "algorithm:hexdigest"
 */
export async function hashFile(filePath: string): Promise<string> {
  const algo = getAlgorithm();
  return new Promise((resolve, reject) => {
    const h = createHash(algo);
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(`${algo}:${h.digest('hex')}`));
    stream.on('error', reject);
  });
}
