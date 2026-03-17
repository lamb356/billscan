import { runAudit } from '../src/analyzer/audit.js';

async function main() {
  const result = await runAudit('/tmp/test-eob.png', { zip: '53179' });
  console.log('isEob:', result.isEob);
  console.log('eob:', !!result.eob);
  console.log('eobRaw type:', typeof result.eobRaw);
  console.log('eobRaw truthy:', !!result.eobRaw);
  if (result.eobRaw) {
    console.log('eobRaw.insurerName:', result.eobRaw.insurerName);
    console.log('eobRaw.summary:', JSON.stringify(result.eobRaw.summary));
    console.log('eobRaw.isEob:', result.eobRaw.isEob);
  } else {
    console.log('eobRaw value:', JSON.stringify(result.eobRaw));
  }
}
main().catch(console.error);
