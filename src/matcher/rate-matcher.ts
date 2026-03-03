import { getDb } from '../db/connection.js';
import type { MatchMode, Severity } from '../schema/finding.js';

export interface MatchResult {
  facilityRate: number | null;
  nonFacilityRate: number | null;
  cmsRateUsed: number | null;
  matchMode: MatchMode;
  severity: Severity | null;
  disputeStrength: 'strong' | 'moderate' | 'weak' | 'none';
  locality: string | null;
  description: string | null;
}

export function matchRate(
  cptCode: string,
  modifier?: string,
  rateContext: 'facility' | 'non_facility' = 'facility',
  locality?: string,
  snapshotId?: number,
): MatchResult {
  const db = getDb();

  if (!snapshotId) {
    const latest = db.prepare(
      'SELECT id FROM cms_snapshots ORDER BY effective_year DESC, fetched_at DESC LIMIT 1'
    ).get() as { id: number } | undefined;
    if (!latest) return unmatchedResult();
    snapshotId = latest.id;
  }

  if (modifier && locality) {
    const row = queryRate(db, snapshotId, cptCode, modifier, locality);
    if (row) return buildResult(row, 'exact_code_modifier_locality', rateContext);
  }

  if (modifier) {
    const row = queryRate(db, snapshotId, cptCode, modifier, null);
    if (row) return buildResult(row, 'exact_code_modifier', rateContext);
  }

  {
    const row = queryRate(db, snapshotId, cptCode, null, null);
    if (row) return buildResult(row, 'exact_code_only', rateContext);
  }

  return unmatchedResult();
}

interface RateRow {
  facility_rate: number | null;
  non_facility_rate: number | null;
  locality: string | null;
  description: string | null;
}

function queryRate(
  db: ReturnType<typeof getDb>,
  snapshotId: number,
  cptCode: string,
  modifier: string | null,
  locality: string | null,
): RateRow | null {
  let sql = `SELECT facility_rate, non_facility_rate, locality, description FROM cms_rates WHERE snapshot_id = ? AND cpt_code = ?`;
  const params: any[] = [snapshotId, cptCode];

  if (modifier !== null) { sql += ` AND (modifier = ? OR modifier IS NULL)`; params.push(modifier); }
  if (locality !== null) { sql += ` AND (locality = ? OR locality IS NULL)`; params.push(locality); }

  sql += ` ORDER BY
    CASE WHEN facility_rate IS NOT NULL AND facility_rate > 0 THEN 0 ELSE 1 END,
    CASE WHEN non_facility_rate IS NOT NULL AND non_facility_rate > 0 THEN 0 ELSE 1 END
    LIMIT 1`;

  return db.prepare(sql).get(...params) as RateRow | null;
}

function buildResult(
  row: RateRow,
  matchMode: MatchMode,
  rateContext: 'facility' | 'non_facility',
): MatchResult {
  const cmsRateUsed = rateContext === 'facility'
    ? (row.facility_rate ?? row.non_facility_rate)
    : (row.non_facility_rate ?? row.facility_rate);

  return {
    facilityRate: row.facility_rate,
    nonFacilityRate: row.non_facility_rate,
    cmsRateUsed,
    matchMode,
    severity: null,
    disputeStrength: 'none',
    locality: row.locality,
    description: row.description,
  };
}

function unmatchedResult(): MatchResult {
  return {
    facilityRate: null,
    nonFacilityRate: null,
    cmsRateUsed: null,
    matchMode: 'unmatched',
    severity: null,
    disputeStrength: 'none',
    locality: null,
    description: null,
  };
}

export function calculateSeverity(multiplier: number): Severity {
  if (multiplier > 10) return 'extreme';
  if (multiplier > 5) return 'high';
  if (multiplier > 2) return 'medium';
  return 'low';
}

export function calculateDisputeStrength(
  matchMode: MatchMode,
  multiplier: number | null,
): 'strong' | 'moderate' | 'weak' | 'none' {
  if (matchMode === 'unmatched' || multiplier === null) return 'none';
  const isExact = matchMode === 'exact_code_modifier_locality' || matchMode === 'exact_code_modifier';
  if (isExact && multiplier > 3) return 'strong';
  if (isExact && multiplier > 2) return 'moderate';
  return 'weak';
}
