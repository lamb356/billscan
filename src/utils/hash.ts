import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

let blake3Module: any = null;
let blake3LoadAttempted = false;

async function loadBlake3() {
  if (blake3LoadAttempted) return blake3Module;
  blake3LoadAttempted = true;
  try {
    blake3Module = await import('blake3' as string);
  } catch {
    console.warn('[hash] BLAKE3 not available, falling back to SHA-256');
    blake3Module = null;
  }
  return blake3Module;
}

export async function hash(data: Buffer | string): Promise<string> {
  const b3 = await loadBlake3();
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  if (b3) {
    const result = b3.hash(buf);
    return `blake3:${Buffer.from(result).toString('hex')}`;
  }
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

export async function hashFile(filePath: string): Promise<string> {
  const b3 = await loadBlake3();
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    if (b3) {
      const hasher = b3.createHash();
      stream.on('data', (chunk: Buffer) => hasher.update(chunk));
      stream.on('end', () => resolve(`blake3:${Buffer.from(hasher.digest()).toString('hex')}`));
      stream.on('error', reject);
    } else {
      const sha = createHash('sha256');
      stream.on('data', (chunk: Buffer) => sha.update(chunk));
      stream.on('end', () => resolve(`sha256:${sha.digest('hex')}`));
      stream.on('error', reject);
    }
  });
}

export function getAlgorithm(hashString: string): string {
  return hashString.split(':')[0];
}
