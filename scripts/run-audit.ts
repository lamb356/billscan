import { runAudit } from '../src/analyzer/audit.js';
import { formatReportConsole } from '../src/output/report-builder.js';
import { renderViralCard } from '../src/output/card-renderer.js';
import { closeDb } from '../src/db/connection.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/run-audit.ts <bill-file>');
  process.exit(1);
}

try {
  const report = await runAudit(file, { save: process.argv.includes('--save') });
  console.log(formatReportConsole(report));
  console.log(renderViralCard(report));
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
} finally {
  closeDb();
}
