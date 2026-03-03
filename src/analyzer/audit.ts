import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseBill } from '../parser/bill-parser.js';
import { matchRate, calculateSeverity, calculateDisputeStrength } from '../matcher/rate-matcher.js';
import { hash } from '../utils/hash.js';
import { getDb } from '../db/connection.js';
import type { AuditFinding } from '../schema/finding.js';
import type { AuditReport, TransparencyStamp } from '../schema/report.js';

export interface AuditOptions {
  setting?: 'facility' | 'office';
  locality?: string;
  save?: boolean;
  snapshotId?: number;
}

export async function runAudit(billPath: string, options: AuditOptions = {}): Promise<AuditReport> {
  // 1. Parse bill
  const bill = await parseBill(billPath);

  // 2. Determine rate context
  let rateContext: 'facility' | 'non_facility';
  if (options.setting) {
    rateContext = options.setting === 'facility' ? 'facility' : 'non_facility';
  } else {
    rateContext = ['hospital', 'er', 'outpatient'].includes(bill.facilityType)
      ? 'facility'
      : 'non_facility';
  }

  // 3. Get snapshot info
  const db = getDb();
  const snapshot = db.prepare(
    'SELECT id, source_url, effective_year, data_hash FROM cms_snapshots ORDER BY effective_year DESC, fetched_at DESC LIMIT 1'
  ).get() as { id: number; source_url: string; effective_year: number; data_hash: string } | undefined;

  if (!snapshot) {
    throw new Error('No CMS data found. Run `billscan fetch-cms` first.');
  }

  // 4. Match each line item
  const findings: AuditFinding[] = [];

  for (const item of bill.lineItems) {
    const match = matchRate(
      item.cptCode,
      item.modifier,
      rateContext,
      options.locality,
      options.snapshotId ?? snapshot.id,
    );

    const overchargeAmount = match.cmsRateUsed !== null
      ? +(item.billedAmount - match.cmsRateUsed).toFixed(2)
      : null;

    const overchargeMultiplier = match.cmsRateUsed !== null && match.cmsRateUsed > 0
      ? +(item.billedAmount / match.cmsRateUsed).toFixed(1)
      : null;

    const severity = overchargeMultiplier !== null
      ? calculateSeverity(overchargeMultiplier)
      : null;

    const disputeStrength = calculateDisputeStrength(match.matchMode, overchargeMultiplier);

    findings.push({
      lineNumber: item.lineNumber,
      cptCode: item.cptCode,
      description: match.description || item.description,
      billedAmount: item.billedAmount,
      cmsFacilityRate: match.facilityRate,
      cmsNonFacilityRate: match.nonFacilityRate,
      cmsRateUsed: match.cmsRateUsed,
      rateContext,
      matchMode: match.matchMode,
      overchargeAmount,
      overchargeMultiplier,
      severity,
      disputeStrength,
      sourceUrl: snapshot.source_url,
      sourceEffectiveYear: snapshot.effective_year,
    });
  }

  // 5. Calculate totals
  const matched = findings.filter(f => f.matchMode !== 'unmatched');
  const unmatched = findings.filter(f => f.matchMode === 'unmatched');

  const totalCmsBaseline = matched.reduce((sum, f) => sum + (f.cmsRateUsed ?? 0), 0);
  const totalPotentialSavings = +(bill.totalBilled - totalCmsBaseline).toFixed(2);

  const multipliers = matched
    .map(f => f.overchargeMultiplier)
    .filter((m): m is number => m !== null);

  const averageMultiplier = multipliers.length > 0
    ? +(multipliers.reduce((a, b) => a + b, 0) / multipliers.length).toFixed(1)
    : null;

  // 6. Build summary
  const topOvercharges = matched
    .filter(f => f.overchargeAmount !== null && f.overchargeAmount > 0)
    .sort((a, b) => (b.overchargeAmount ?? 0) - (a.overchargeAmount ?? 0))
    .slice(0, 5)
    .map(f => ({
      cptCode: f.cptCode,
      description: f.description,
      billedAmount: f.billedAmount,
      cmsRate: f.cmsRateUsed!,
      savings: f.overchargeAmount!,
    }));

  const overchargeByCategory: Record<string, number> = {};
  for (const f of matched) {
    if (f.severity) {
      overchargeByCategory[f.severity] = (overchargeByCategory[f.severity] ?? 0) + (f.overchargeAmount ?? 0);
    }
  }

  // 7. Generate stamp
  const inputHash = await hash(readFileSync(billPath));
  const reportId = randomUUID();

  const stamp: TransparencyStamp = {
    reportId,
    inputHash,
    cmsSnapshotId: snapshot.id,
    cmsDataHash: snapshot.data_hash,
    cmsEffectiveYear: snapshot.effective_year,
    generatedAt: new Date().toISOString(),
    toolVersion: '0.1.0',
    hashAlgorithm: inputHash.split(':')[0],
  };

  // 8. Assemble report
  const report: AuditReport = {
    stamp,
    facilityName: bill.facilityName,
    facilityType: bill.facilityType,
    totalBilled: bill.totalBilled,
    totalCmsBaseline: +totalCmsBaseline.toFixed(2),
    totalPotentialSavings,
    matchedLineCount: matched.length,
    unmatchedLineCount: unmatched.length,
    findings,
    summary: {
      topOvercharges,
      overchargeByCategory,
      averageMultiplier,
    },
  };

  // 9. Save if requested
  if (options.save) {
    db.prepare(`
      INSERT INTO audits (report_id, input_hash, snapshot_id, total_billed, total_cms, total_savings, finding_count, report_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reportId,
      inputHash,
      snapshot.id,
      bill.totalBilled,
      totalCmsBaseline,
      totalPotentialSavings,
      findings.length,
      JSON.stringify(report),
    );
    console.log(`[audit] Saved to database: ${reportId}`);
  }

  return report;
}
