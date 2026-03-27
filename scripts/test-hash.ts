import { hash } from '../src/utils/hash.js';
async function m() {
  const result = await hash('test data');
  console.log('Hash result:', result);
  console.log('Algorithm:', result.split(':')[0]);
}
m();
