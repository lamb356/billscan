import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseBill } from '../parser/bill-parser.js';
import { matchRateMulti, calculateSeverity, calculateDisputeStrength } from '../matcher/multi-matcher.js';
import { hash } from '../utils/hash.js';
import { getDb } from '../db/connection.js';
import type { AuditFinding } from '../schema/finding.js';
import type { AuditReport, TransparencyStamp } from '../schema/report.js';

export interface AuditOptions {
  setting?: 'facility' | 'office';
  locality?: string;
  zip?: string;
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

  // 3. Resolve locality from ZIP if provided
  let locality = options.locality || undefined;
  if (!locality && options.zip) {
    locality = resolveZipLocality(options.zip) || undefined;
    if (locality) {
      console.log(`[audit] Resolved ZIP ${options.zip} → locality ${locality}`);
    }
  }

  // 4. Get snapshot info
  const db = getDb();
  const snapshot = db.prepare(
    'SELECT id, source_url, effective_year, data_hash FROM cms_snapshots ORDER BY effective_year DESC, fetched_at DESC LIMIT 1'
  ).get() as { id: number; source_url: string; effective_year: number; data_hash: string } | undefined;

  if (!snapshot) {
    throw new Error('No CMS data found. Run `billscan fetch-all` first.');
  }

  // 5. Check available data sources
  const dataSources = getAvailableDataSources(db);

  // 6. Match each line item using multi-source matcher
  const findings: AuditFinding[] = [];

  for (const item of bill.lineItems) {
    const match = matchRateMulti(
      item.cptCode,
      item.modifier,
      rateContext,
      locality,
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

    const disputeStrength = calculateDisputeStrength(match.matchMode, match.rateSource, overchargeMultiplier);

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
      rateSource: match.rateSource,
      overchargeAmount,
      overchargeMultiplier,
      severity,
      disputeStrength,
      sourceUrl: snapshot.source_url,
      sourceEffectiveYear: snapshot.effective_year,
      apc: match.apc,
      dosage: match.dosage,
    });
  }

  // 7. Calculate totals
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

  // 8. Build summary
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

  // 9. Generate stamp
  const inputHash = await hash(readFileSync(billPath));
  const reportId = randomUUID();

  const stamp: TransparencyStamp = {
    reportId,
    inputHash,
    cmsSnapshotId: snapshot.id,
    cmsDataHash: snapshot.data_hash,
    cmsEffectiveYear: snapshot.effective_year,
    generatedAt: new Date().toISOString(),
    toolVersion: '0.2.0',
    hashAlgorithm: inputHash.split(':')[0],
    dataSources,
  };

  // 10. Assemble report
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

  // 11. Save if requested
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

function resolveZipLocality(zip: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT locality FROM zip_locality WHERE zip_code = ?'
  ).get(zip) as { locality: string } | undefined;
  return row?.locality || null;
}

function getAvailableDataSources(db: ReturnType<typeof getDb>): string[] {
  const sources: string[] = ['PFS'];
  try {
    const clfs = db.prepare('SELECT COUNT(*) as c FROM clfs_rates').get() as { c: number };
    if (clfs.c > 0) sources.push('CLFS');
  } catch { /* table may not exist yet */ }
  try {
    const asp = db.prepare('SELECT COUNT(*) as c FROM asp_rates').get() as { c: number };
    if (asp.c > 0) sources.push('ASP');
  } catch { /* table may not exist yet */ }
  try {
    const opps = db.prepare('SELECT COUNT(*) as c FROM opps_rates').get() as { c: number };
    if (opps.c > 0) sources.push('OPPS');
  } catch { /* table may not exist yet */ }
  return sources;
}
