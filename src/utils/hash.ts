import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

let blake3Module: any = null;
let blake3LoadAttempted = false;

async function loadBlake3() {
  if (blake3LoadAttempted) return blake3Module;
  blake3LoadAttempted = true;
  try {
    blake3Module = await import('blake3');
  } catch {
    blake3Module = null;
  }
  return blake3Module;
}

export async function hash(data: Buffer | string): Promise<string> {
  const b3 = await loadBlake3();
  if (b3) {
    const h = b3.createHash();
    h.update(typeof data === 'string' ? Buffer.from(data) : data);
    return 'blake3:' + h.digest('hex');
  }
  // Fallback to SHA-256
  return 'sha256:' + createHash('sha256').update(data).digest('hex');
}

export async function hashFile(filePath: string): Promise<string> {
  const b3 = await loadBlake3();
  if (b3) {
    const h = b3.createHash();
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
      h.update(chunk);
    }
    return 'blake3:' + h.digest('hex');
  }
  // Fallback
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => h.update(chunk));
    stream.on('end', () => resolve('sha256:' + h.digest('hex')));
    stream.on('error', reject);
  });
}
