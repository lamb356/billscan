import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Handlebars from 'handlebars';
import type { AuditReport } from '../schema/report.js';

export function generateDisputeLetter(report: AuditReport): string {
  const templatePath = resolve(process.cwd(), 'templates', 'dispute-letter.hbs');
  const templateSource = readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateSource);

  const matched = report.findings.filter(f => f.matchMode !== 'unmatched' && f.overchargeAmount && f.overchargeAmount > 0);

  const data = {
    currentDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    facilityName: report.facilityName || 'Healthcare Provider',
    facilityAddress: '[Facility Address]',
    statementDate: report.stamp.generatedAt.split('T')[0],
    patientAccount: '[Account Number]',
    cmsYear: report.stamp.cmsEffectiveYear,
    cmsSourceUrl: `https://www.cms.gov/medicare/physician-fee-schedule/search`,
    reportId: report.stamp.reportId,
    totalBilled: report.totalBilled.toFixed(2),
    totalCmsBaseline: report.totalCmsBaseline.toFixed(2),
    totalSavings: report.totalPotentialSavings.toFixed(2),
    topFindings: matched.slice(0, 5).map(f => ({
      cptCode: f.cptCode,
      description: f.description,
      billedAmount: f.billedAmount.toFixed(2),
      cmsRateUsed: f.cmsRateUsed?.toFixed(2),
      rateContext: f.rateContext,
      overchargeMultiplier: f.overchargeMultiplier?.toFixed(1),
    })),
  };

  return template(data);
}
