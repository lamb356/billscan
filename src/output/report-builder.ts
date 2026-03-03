import type { AuditReport } from '../schema/report.js';
import type { AuditFinding } from '../schema/finding.js';

export function formatReportConsole(report: AuditReport): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════');
  lines.push('  BILLSCAN AUDIT REPORT');
  lines.push('═══════════════════════════════════════════════════════');

  if (report.facilityName) {
    lines.push(`  Facility: ${report.facilityName}`);
  }

  lines.push(`  Total Billed:        $${report.totalBilled.toFixed(2)}`);
  lines.push(`  CMS Baseline:        $${report.totalCmsBaseline.toFixed(2)}`);
  lines.push(`  Potential Savings:   $${report.totalPotentialSavings.toFixed(2)}`);
  lines.push(`  Lines Matched:       ${report.matchedLineCount}`);
  lines.push(`  Lines Unmatched:     ${report.unmatchedLineCount}`);

  if (report.summary.averageMultiplier) {
    lines.push(`  Avg Overcharge:      ${report.summary.averageMultiplier}x Medicare Rate`);
  }

  lines.push('');
  lines.push('  Data Sources: ' + report.stamp.dataSources.join(', '));
  lines.push(`  CMS Year: ${report.stamp.cmsEffectiveYear}`);
  lines.push(`  Report ID: ${report.stamp.reportId}`);
  lines.push('');

  // Line items
  lines.push('───────────────────────────────────────────────────────');
  lines.push('  LINE ITEMS');
  lines.push('───────────────────────────────────────────────────────');

  for (const finding of report.findings) {
    lines.push(`\n  CPT: ${finding.cptCode}  |  ${finding.description || 'Unknown Service'}`);
    lines.push(`    Billed: $${finding.billedAmount.toFixed(2)}`);

    if (finding.cmsRateUsed !== null) {
      lines.push(`    CMS Rate: $${finding.cmsRateUsed.toFixed(2)} (${finding.rateSource} ${finding.matchMode})`);

      if (finding.overchargeAmount !== null) {
        const indicator = finding.overchargeAmount > 0 ? '⚠️ OVERCHARGE' : '✅ FAIR';
        lines.push(`    ${indicator}: $${finding.overchargeAmount.toFixed(2)} (${finding.overchargeMultiplier}x)`);
      }

      if (finding.severity) {
        lines.push(`    Severity: ${finding.severity.toUpperCase()} | Dispute: ${finding.disputeStrength}`);
      }

      if (finding.dosage) {
        lines.push(`    Dosage: ${finding.dosage}`);
      }

      if (finding.apc) {
        lines.push(`    APC: ${finding.apc}`);
      }
    } else {
      lines.push(`    CMS Rate: NOT FOUND (${finding.matchMode})`);
    }
  }

  // Top overcharges
  if (report.summary.topOvercharges.length > 0) {
    lines.push('');
    lines.push('───────────────────────────────────────────────────────');
    lines.push('  TOP OVERCHARGES');
    lines.push('───────────────────────────────────────────────────────');
    for (const oc of report.summary.topOvercharges) {
      lines.push(`  ${oc.cptCode}: $${oc.savings.toFixed(2)} overcharged (billed $${oc.billedAmount.toFixed(2)} vs CMS $${oc.cmsRate.toFixed(2)})`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(`  Hash: ${report.stamp.inputHash}`);
  lines.push(`  CMS Hash: ${report.stamp.cmsDataHash}`);
  lines.push('═══════════════════════════════════════════════════════');

  return lines.join('\n');
}
