import { hash, hashFile, hashSync, getAlgorithm } from '../src/utils/hash.js';

async function main() {
  const h1 = await hash('test medical bill data');
  console.log('hash():', h1);
  console.log('Algorithm:', getAlgorithm(h1));
  
  const h2 = hashSync('test medical bill data');
  console.log('hashSync():', h2);
  console.log('Match:', h1 === h2);
  
  // Write temp file and hash it
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/test-hash-file.txt', 'test file content');
  const h3 = await hashFile('/tmp/test-hash-file.txt');
  console.log('hashFile():', h3);
  console.log('All BLAKE3:', [h1, h2, h3].every(h => h.startsWith('blake3:')));
}
main();
