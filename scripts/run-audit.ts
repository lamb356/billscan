import { runAudit } from '../src/analyzer/audit.js';
import { formatReportConsole } from '../src/output/report-builder.js';
import { closeDb } from '../src/db/connection.js';

const billPath = process.argv[2];
if (!billPath) {
  console.error('Usage: npx tsx scripts/run-audit.ts <bill.json>');
  process.exit(1);
}

try {
  const report = await runAudit(billPath, { save: true });
  console.log('\n' + formatReportConsole(report));
} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
} finally {
  closeDb();
}
