import type { AuditReport } from '../schema/report.js';

export function renderViralCard(report: AuditReport): string {
  const worst = report.summary.topOvercharges[0];
  const worstLine = worst
    ? `${worst.description.slice(0, 28)} — $${worst.billedAmount.toLocaleString()} vs $${worst.cmsRate.toFixed(2)} (${(worst.billedAmount / worst.cmsRate).toFixed(0)}x!)`
    : 'No overcharges found';

  const card = [
    '┌─────────────────────────────────────────┐',
    '│  🏥 YOUR ER BILL                        │',
    '│                                         │',
    `│  Billed:     $${report.totalBilled.toLocaleString().padEnd(25)}│`,
    `│  Fair Price: $${report.totalCmsBaseline.toLocaleString().padEnd(25)}│`,
    `│  Overcharge: $${report.totalPotentialSavings.toLocaleString().padEnd(25)}│`,
    '│                                         │',
    '│  Worst offender:                        │',
    `│  ${worstLine.slice(0, 39).padEnd(39)}│`,
    '│                                         │',
    `│  Source: CMS.gov ${report.stamp.cmsEffectiveYear} rates${' '.repeat(15)}│`,
    `│  billscan.dev/verify/${report.stamp.reportId.slice(0, 8).padEnd(12)}│`,
    '└─────────────────────────────────────────┘',
  ];

  return card.join('\n');
}
