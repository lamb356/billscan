import type { AuditReport } from '../schema/report.js';

const SEVERITY_ICONS: Record<string, string> = {
  extreme: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};

const MATCH_LABELS: Record<string, string> = {
  exact_code_modifier_locality: 'exact+loc',
  exact_code_modifier: 'exact+mod',
  exact_code_only: 'exact',
  unmatched: 'NONE',
};

export function formatReportConsole(report: AuditReport): string {
  const lines: string[] = [];

  // Header
  lines.push('╔═══════════════════════════════════════════════════════════════════════════╗');
  lines.push(`║  BILLSCAN AUDIT REPORT                                                  ║`);
  lines.push(`║  Generated: ${report.stamp.generatedAt.padEnd(58)}║`);
  lines.push(`║  Report ID: ${report.stamp.reportId.padEnd(58)}║`);
  lines.push(`║  CMS Data: ${report.stamp.cmsEffectiveYear} Fee Schedule (hash: ${report.stamp.cmsDataHash.slice(0, 16)}...)       ║`);
  lines.push('╚═══════════════════════════════════════════════════════════════════════════╝');
  lines.push('');

  // Facility info
  const facilityInfo = report.facilityName
    ? `${report.facilityName} (detected: ${report.facilityType})`
    : `Unknown facility (${report.facilityType})`;
  lines.push(`Facility: ${facilityInfo}`);
  lines.push('');

  // Table header
  lines.push('┌─────┬────────┬──────────────────────────┬──────────┬───────────┬───────────┬──────────┬────────────┐');
  lines.push('│  #  │ CPT    │ Description              │  Billed  │ CMS Fac.  │ CMS NonF. │  Delta   │ Match      │');
  lines.push('├─────┼────────┼──────────────────────────┼──────────┼───────────┼───────────┼──────────┼────────────┤');

  for (const f of report.findings) {
    const desc = f.description.length > 24 ? f.description.slice(0, 21) + '...' : f.description.padEnd(24);
    const billed = `$${f.billedAmount.toLocaleString()}`.padStart(8);
    const fac = f.cmsFacilityRate !== null ? `$${f.cmsFacilityRate.toFixed(2)}`.padStart(9) : '     N/A '.padStart(9);
    const nfac = f.cmsNonFacilityRate !== null ? `$${f.cmsNonFacilityRate.toFixed(2)}`.padStart(9) : '     N/A '.padStart(9);
    const delta = f.overchargeAmount !== null ? `$${f.overchargeAmount.toLocaleString()}`.padStart(8) : '     N/A'.padStart(8);
    const match = (MATCH_LABELS[f.matchMode] || f.matchMode).padEnd(10);
    lines.push(`│ ${String(f.lineNumber).padStart(3)} │ ${f.cptCode.padEnd(6)} │ ${desc} │ ${billed} │ ${fac} │ ${nfac} │ ${delta} │ ${match} │`);
  }

  lines.push('└─────┴────────┴──────────────────────────┴──────────┴───────────┴───────────┴──────────┴────────────┘');
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push(`  Total Billed:       $${report.totalBilled.toLocaleString()}`);
  lines.push(`  CMS Baseline:       $${report.totalCmsBaseline.toLocaleString()}  (${report.findings[0]?.rateContext || 'facility'} rates)`);
  lines.push(`  Potential Savings:  $${report.totalPotentialSavings.toLocaleString()}`);
  lines.push(`  Average Multiplier:     ${report.summary.averageMultiplier ?? 'N/A'}x`);
  lines.push(`  Findings:           ${report.matchedLineCount} matched / ${report.unmatchedLineCount} unmatched`);
  lines.push('');

  // Top findings with severity icons
  for (const f of report.findings.filter(f => f.severity).sort((a, b) => {
    const order = { extreme: 0, high: 1, medium: 2, low: 3 };
    return (order[a.severity!] ?? 4) - (order[b.severity!] ?? 4);
  }).slice(0, 5)) {
    const icon = SEVERITY_ICONS[f.severity!] || '⚪';
    const label = f.severity!.toUpperCase().padEnd(8);
    lines.push(`${icon} ${label} ${f.description.slice(0, 30)} — billed $${f.billedAmount.toLocaleString()} vs CMS $${f.cmsRateUsed?.toFixed(2)} (${f.overchargeMultiplier}x)`);
  }

  lines.push('');
  lines.push(`Source: CMS ${report.stamp.cmsEffectiveYear} Physician Fee Schedule`);
  lines.push(`Hash: ${report.stamp.hashAlgorithm} | input=${report.stamp.inputHash.slice(0, 24)}... | cms=${report.stamp.cmsDataHash.slice(0, 24)}...`);
  lines.push(`Stamp: report_id=${report.stamp.reportId}`);

  return lines.join('\n');
}
