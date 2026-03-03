import type { AuditReport } from '../schema/report.js';

export function renderViralCard(report: AuditReport): string {
  const savings = report.totalPotentialSavings;
  const multiplier = report.summary.averageMultiplier;

  const lines = [
    '┌────────────────────────────────────────┐',
    `│  MEDICAL BILL AUDIT RESULTS            │`,
    '├────────────────────────────────────────┤',
    `│  Billed:     $${report.totalBilled.toFixed(2).padStart(10)}              │`,
    `│  CMS Rate:   $${report.totalCmsBaseline.toFixed(2).padStart(10)}              │`,
    `│  You Save:   $${savings.toFixed(2).padStart(10)}              │`,
    '├────────────────────────────────────────┤',
    `│  Matched: ${report.matchedLineCount} lines  Unmatched: ${report.unmatchedLineCount} lines  │`,
    multiplier ? `│  Avg Overcharge: ${multiplier}x Medicare Rate        │` : '│                                        │',
    '└────────────────────────────────────────┘',
  ];

  return lines.join('\n');
}
