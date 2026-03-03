import type { AuditReport } from '../schema/report.js';
import type { EOBAuditReport } from '../analyzer/eob-audit.js';
import { getPlanRange, getPlanMidpoint, planLabel } from '../analyzer/insurance-comparison.js';
import type { PlanType } from '../analyzer/insurance-comparison.js';

const SEVERITY_ICONS: Record<string, string> = {
  extreme: '[!!]',
  high: '[!]',
  medium: '[~]',
  low: '[.]',
};

const MATCH_LABELS: Record<string, string> = {
  exact_code_modifier_locality: 'exact+loc',
  exact_code_modifier: 'exact+mod',
  exact_code_only: 'exact',
  unmatched: 'NONE',
};

const SOURCE_LABELS: Record<string, string> = {
  pfs: 'PFS',
  clfs: 'CLFS',
  asp: 'ASP',
  opps: 'OPPS',
};

export function formatReportConsole(report: AuditReport): string {
  const lines: string[] = [];

  lines.push('===================================================================================');
  lines.push(`  BILLSCAN AUDIT REPORT  v${report.stamp.toolVersion}`);
  lines.push(`  Generated: ${report.stamp.generatedAt}`);
  lines.push(`  Report ID: ${report.stamp.reportId}`);
  const sources = report.stamp.dataSources?.join('+') || 'PFS';
  lines.push(`  CMS Data: ${report.stamp.cmsEffectiveYear} [${sources}] (hash: ${report.stamp.cmsDataHash.slice(0, 16)}...)`);
  lines.push('===================================================================================');
  lines.push('');

  const facilityInfo = report.facilityName
    ? `${report.facilityName} (detected: ${report.facilityType})`
    : `Unknown facility (${report.facilityType})`;
  lines.push(`Facility: ${facilityInfo}`);
  lines.push('');

  lines.push(' #    CPT      Description               Billed     CMS Fac.   CMS NonF.  Delta     Source  Match');
  lines.push('-'.repeat(100));

  for (const f of report.findings) {
    const desc = f.description.length > 24 ? f.description.slice(0, 21) + '...' : f.description.padEnd(24);
    const billed = `$${f.billedAmount.toLocaleString()}`.padStart(8);
    const fac = f.cmsFacilityRate !== null ? `$${f.cmsFacilityRate.toFixed(2)}`.padStart(9) : '     N/A '.padStart(9);
    const nfac = f.cmsNonFacilityRate !== null ? `$${f.cmsNonFacilityRate.toFixed(2)}`.padStart(9) : '     N/A '.padStart(9);
    const delta = f.overchargeAmount !== null ? `$${f.overchargeAmount.toLocaleString()}`.padStart(8) : '     N/A'.padStart(8);
    const source = (SOURCE_LABELS[f.rateSource || ''] || '---').padEnd(6);
    const match = (MATCH_LABELS[f.matchMode] || f.matchMode).padEnd(10);
    lines.push(`${String(f.lineNumber).padStart(3)}   ${f.cptCode.padEnd(7)}  ${desc}  ${billed}  ${fac}  ${nfac}  ${delta}  ${source}  ${match}`);
  }

  lines.push('-'.repeat(100));
  lines.push('');

  lines.push('SUMMARY');
  lines.push(`  Total Billed:       $${report.totalBilled.toLocaleString()}`);
  lines.push(`  CMS Baseline:       $${report.totalCmsBaseline.toLocaleString()}  (${report.findings[0]?.rateContext || 'facility'} rates)`);
  lines.push(`  Potential Savings:  $${report.totalPotentialSavings.toLocaleString()}`);
  lines.push(`  Average Multiplier:     ${report.summary.averageMultiplier ?? 'N/A'}x`);
  lines.push(`  Findings:           ${report.matchedLineCount} matched / ${report.unmatchedLineCount} unmatched`);
  lines.push(`  Data Sources:       ${sources}`);
  lines.push('');

  for (const f of report.findings.filter(f => f.severity).sort((a, b) => {
    const order = { extreme: 0, high: 1, medium: 2, low: 3 };
    return (order[a.severity!] ?? 4) - (order[b.severity!] ?? 4);
  }).slice(0, 5)) {
    const icon = SEVERITY_ICONS[f.severity!] || '[ ]';
    const label = f.severity!.toUpperCase().padEnd(8);
    const src = SOURCE_LABELS[f.rateSource || ''] || '---';
    lines.push(`${icon} ${label} ${f.description.slice(0, 30)} - billed $${f.billedAmount.toLocaleString()} vs CMS $${f.cmsRateUsed?.toFixed(2)} [${src}] (${f.overchargeMultiplier}x)`);
  }

  lines.push('');
  lines.push(`Source: CMS ${report.stamp.cmsEffectiveYear} Fee Schedules [${sources}]`);
  lines.push(`Hash: ${report.stamp.hashAlgorithm} | input=${report.stamp.inputHash.slice(0, 24)}... | cms=${report.stamp.cmsDataHash.slice(0, 24)}...`);
  lines.push(`Stamp: report_id=${report.stamp.reportId}`);

  return lines.join('\n');
}

export function formatEobAuditConsole(eobReport: EOBAuditReport): string {
  const lines: string[] = [];
  const { baseReport, eob, plan, comparisons } = eobReport;
  const sources = baseReport.stamp.dataSources?.join('+') || 'PFS';

  lines.push('======================================================================================');
  lines.push(`  BILLSCAN AUDIT REPORT WITH INSURANCE COMPARISON  v${baseReport.stamp.toolVersion}`);
  lines.push(`  Generated: ${baseReport.stamp.generatedAt}`);
  lines.push(`  Report ID: ${baseReport.stamp.reportId}`);
  const cmsLine = `CMS ${baseReport.stamp.cmsEffectiveYear} [${sources}] (hash: ${baseReport.stamp.cmsDataHash.slice(0, 16)}...)`;
  lines.push(`  ${cmsLine}`);

  if (eob) {
    const eobLine = `EOB: ${eob.insurerName} | ${eob.planType} | Claim: ${eob.claimNumber} | DOS: ${eob.dateOfService}`;
    lines.push(`  ${eobLine}`);
  } else if (plan) {
    const planLine = `Insurance Estimate Mode: ${planLabel(plan)} [ESTIMATES ONLY - NOT REAL INSURER DATA]`;
    lines.push(`  ${planLine}`);
  }
  lines.push('======================================================================================');
  lines.push('');

  const facilityInfo = baseReport.facilityName
    ? `${baseReport.facilityName} (detected: ${baseReport.facilityType})`
    : `Unknown facility (${baseReport.facilityType})`;
  lines.push(`Facility: ${facilityInfo}`);
  if (eob) lines.push(`Patient:  ${eob.patientName}  |  Provider: ${eob.providerName}`);
  lines.push('');

  const hasEob = eob !== null;
  const hasPlan = plan !== null;
  const allowedColHeader = hasEob ? 'Actual Allowed' : hasPlan ? `Est. Allowed (${plan!.toUpperCase()})` : 'Ins. Allowed';
  const vsAllowedHeader   = hasEob ? 'vs Allowed'    : hasPlan ? 'vs Est.'       : 'vs Ins.';

  lines.push(` #    CPT      Description               Billed     CMS Rate   ${allowedColHeader.padEnd(18)} vs CMS    ${vsAllowedHeader}`);
  lines.push('-'.repeat(110));

  for (let i = 0; i < baseReport.findings.length; i++) {
    const f = baseReport.findings[i]!;
    const c = comparisons[i]!;

    const desc    = f.description.length > 24 ? f.description.slice(0, 21) + '...' : f.description.padEnd(24);
    const billed  = `$${f.billedAmount.toLocaleString()}`.padStart(8);
    const cms     = f.cmsRateUsed !== null ? `$${f.cmsRateUsed.toFixed(2)}`.padStart(9) : '      N/A'.padStart(9);
    const vsCms   = f.overchargeAmount !== null ? `$${f.overchargeAmount.toLocaleString()}`.padStart(8) : '     N/A'.padStart(8);

    let allowedCol: string;
    let vsAllowedCol: string;

    if (hasEob && c.actualAllowed !== null) {
      allowedCol  = `$${c.actualAllowed.toFixed(2)}`.padStart(17);
      vsAllowedCol = c.overchargeVsActual !== null
        ? `$${c.overchargeVsActual.toLocaleString()}`.padStart(10)
        : '       N/A'.padStart(10);
    } else if (hasPlan && f.cmsRateUsed !== null) {
      const [lo, hi] = getPlanRange(c, plan!);
      if (lo !== null && hi !== null) {
        allowedCol  = `$${lo.toFixed(0)}-$${hi.toFixed(0)}`.padStart(17);
      } else {
        allowedCol  = '              N/A'.padStart(17);
      }
      const mid = getPlanMidpoint(c, plan!);
      vsAllowedCol = mid !== null
        ? `$${+(f.billedAmount - mid).toFixed(0)}`.padStart(10)
        : '       N/A'.padStart(10);
    } else {
      allowedCol   = '              N/A'.padStart(17);
      vsAllowedCol = '       N/A'.padStart(10);
    }

    lines.push(`${String(f.lineNumber).padStart(3)}   ${f.cptCode.padEnd(7)}  ${desc}  ${billed}  ${cms}  ${allowedCol}  ${vsCms}  ${vsAllowedCol}`);
  }

  lines.push('-'.repeat(110));
  lines.push('');

  lines.push('INSURANCE COMPARISON SUMMARY');
  lines.push(`  Total Billed:            $${eobReport.totalBilled.toLocaleString()}`);
  lines.push(`  CMS Medicare Baseline:   $${eobReport.totalCmsBaseline.toLocaleString()}  (${baseReport.findings[0]?.rateContext || 'facility'} rates)`);

  if (eobReport.totalActualAllowed !== null) {
    lines.push(`  Insurance Allowed (EOB): $${eobReport.totalActualAllowed.toLocaleString()}`);
    lines.push(`  Insurance Paid:          $${(eobReport.totalInsurancePaid ?? 0).toLocaleString()}`);
    lines.push(`  Patient Responsibility:  $${(eobReport.totalPatientResponsibility ?? 0).toLocaleString()}`);
    const writtenOff = +(eobReport.totalBilled - eobReport.totalActualAllowed).toFixed(2);
    const pctWrittenOff = ((writtenOff / eobReport.totalBilled) * 100).toFixed(1);
    lines.push(`  Written Off (bill-allowed): $${writtenOff.toLocaleString()} (${pctWrittenOff}% of billed)`);
  } else if (eobReport.totalEstimatedAllowed !== null) {
    lines.push(`  Est. Allowed (${plan!.toUpperCase()} midpoint): $${eobReport.totalEstimatedAllowed.toLocaleString()} [ESTIMATE]`);
    const overEst = +(eobReport.totalBilled - eobReport.totalEstimatedAllowed).toFixed(2);
    lines.push(`  Billed Over Est. Allowed: $${overEst.toLocaleString()}`);
  }

  lines.push(`  CMS Potential Savings:   $${baseReport.totalPotentialSavings.toLocaleString()}`);
  lines.push(`  Average Multiplier:          ${baseReport.summary.averageMultiplier ?? 'N/A'}x (billed vs CMS)`);
  lines.push(`  Findings:                ${baseReport.matchedLineCount} matched / ${baseReport.unmatchedLineCount} unmatched`);
  lines.push('');

  if (eobReport.insights.length > 0) {
    lines.push('INSURANCE INSIGHTS');
    const ICONS: Record<string, string> = { info: '[i]', warning: '[!]', alert: '[!!]' };
    for (const insight of eobReport.insights) {
      const icon = ICONS[insight.type] || '   ';
      lines.push(`  ${icon} [${insight.cptCode}] ${insight.message}`);
    }
    lines.push('');
  }

  lines.push('NOTE: ' + eobReport.footnote);
  lines.push('');
  lines.push(`Source: CMS ${baseReport.stamp.cmsEffectiveYear} Fee Schedules [${sources}]`);
  lines.push(`Hash: ${baseReport.stamp.hashAlgorithm} | input=${baseReport.stamp.inputHash.slice(0, 24)}... | cms=${baseReport.stamp.cmsDataHash.slice(0, 24)}...`);
  lines.push(`Stamp: report_id=${baseReport.stamp.reportId}`);

  return lines.join('\n');
}
