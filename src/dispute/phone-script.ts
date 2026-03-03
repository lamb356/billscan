import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReport } from '../schema/report.js';

export function generatePhoneScript(report: AuditReport): string {
  const template = readFileSync(
    join(process.cwd(), 'templates', 'phone-script.hbs'),
    'utf-8'
  );

  const topFindings = report.findings
    .filter(f => f.overchargeAmount !== null && f.overchargeAmount > 0)
    .sort((a, b) => (b.overchargeAmount ?? 0) - (a.overchargeAmount ?? 0))
    .slice(0, 3);

  let result = template
    .replace('{{facilityName}}', report.facilityName || 'Healthcare Provider')
    .replace('{{totalBilled}}', report.totalBilled.toFixed(2))
    .replace('{{totalCmsBaseline}}', report.totalCmsBaseline.toFixed(2))
    .replace('{{totalPotentialSavings}}', report.totalPotentialSavings.toFixed(2));

  // Build finding lines
  const findingLines = topFindings.map((f, i) =>
    `${i + 1}. CPT ${f.cptCode}: billed $${f.billedAmount}, CMS rate $${(f.cmsRateUsed ?? 0).toFixed(2)}, overcharge $${(f.overchargeAmount ?? 0).toFixed(2)}`
  ).join('\n');

  result = result.replace('{{topFindings}}', findingLines || 'No significant overcharges found.');

  return result;
}
