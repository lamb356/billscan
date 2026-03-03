import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditReport } from '../schema/report.js';

export function generateDisputeLetter(report: AuditReport): string {
  const template = readFileSync(
    join(process.cwd(), 'templates', 'dispute-letter.hbs'),
    'utf-8'
  );

  const topFinding = report.findings
    .filter(f => f.overchargeAmount !== null && f.overchargeAmount > 0)
    .sort((a, b) => (b.overchargeAmount ?? 0) - (a.overchargeAmount ?? 0))[0];

  const overchargedLines = report.findings
    .filter(f => f.overchargeAmount !== null && f.overchargeAmount > 0);

  let result = template
    .replace('{{facilityName}}', report.facilityName || 'Healthcare Provider')
    .replace('{{totalBilled}}', report.totalBilled.toFixed(2))
    .replace('{{totalCmsBaseline}}', report.totalCmsBaseline.toFixed(2))
    .replace('{{totalPotentialSavings}}', report.totalPotentialSavings.toFixed(2))
    .replace('{{reportId}}', report.stamp.reportId)
    .replace('{{generatedAt}}', new Date(report.stamp.generatedAt).toLocaleDateString())
    .replace('{{cmsYear}}', String(report.stamp.cmsEffectiveYear));

  if (topFinding) {
    result = result
      .replace('{{topCptCode}}', topFinding.cptCode)
      .replace('{{topDescription}}', topFinding.description || 'Medical Service')
      .replace('{{topBilled}}', topFinding.billedAmount.toFixed(2))
      .replace('{{topCmsRate}}', (topFinding.cmsRateUsed ?? 0).toFixed(2))
      .replace('{{topOvercharge}}', (topFinding.overchargeAmount ?? 0).toFixed(2));
  } else {
    result = result
      .replace('{{topCptCode}}', 'N/A')
      .replace('{{topDescription}}', 'N/A')
      .replace('{{topBilled}}', '0.00')
      .replace('{{topCmsRate}}', '0.00')
      .replace('{{topOvercharge}}', '0.00');
  }

  result = result
    .replace('{{overchargedLineCount}}', String(overchargedLines.length))
    .replace('{{matchedLineCount}}', String(report.matchedLineCount));

  return result;
}
