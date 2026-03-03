import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Handlebars from 'handlebars';
import type { AuditReport } from '../schema/report.js';

export function generatePhoneScript(report: AuditReport): string {
  const templatePath = resolve(process.cwd(), 'templates', 'phone-script.hbs');
  const templateSource = readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateSource);

  const matched = report.findings.filter(f => f.matchMode !== 'unmatched' && f.overchargeAmount && f.overchargeAmount > 0);

  const data = {
    facilityName: report.facilityName || 'Healthcare Provider',
    statementDate: report.stamp.generatedAt.split('T')[0],
    totalBilled: report.totalBilled.toFixed(2),
    totalCmsBaseline: report.totalCmsBaseline.toFixed(2),
    totalSavings: report.totalPotentialSavings.toFixed(2),
    averageMultiplier: report.summary.averageMultiplier?.toFixed(1) || 'N/A',
    reportId: report.stamp.reportId,
    topFindings: matched.slice(0, 5).map(f => ({
      cptCode: f.cptCode,
      description: f.description,
      billedAmount: f.billedAmount.toFixed(2),
      cmsRateUsed: f.cmsRateUsed?.toFixed(2),
      overchargeMultiplier: f.overchargeMultiplier?.toFixed(1),
    })),
  };

  return template(data);
}
