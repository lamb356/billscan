import { getDb } from '../db/connection.js';
import type { MatchMode, Severity } from '../schema/finding.js';

export type RateSource = 'pfs' | 'clfs' | 'asp' | 'opps';

export interface MultiMatchResult {
  facilityRate: number | null;
  nonFacilityRate: number | null;
  cmsRateUsed: number | null;
  matchMode: MatchMode;
  rateSource: RateSource | null;
  severity: Severity | null;
  disputeStrength: 'strong' | 'moderate' | 'weak' | 'none';
  locality: string | null;
  description: string | null;
  apc: string | null;
  statusIndicator: string | null;
  dosage: string | null;
}

export function matchRateMulti(
  cptCode: string,
  modifier?: string,
  rateContext: 'facility' | 'non_facility' = 'facility',
  locality?: string,
): MultiMatchResult {
  const db = getDb();
  const code = cptCode.trim().toUpperCase();

  const isJCode = code.startsWith('J');
  const isLabCode = isLabHcpcs(code);

  if (isJCode) {
    const asp = matchFromAsp(db, code);
    if (asp) return asp;
  }

  if (isLabCode) {
    const clfs = matchFromClfs(db, code, modifier);
    if (clfs) return clfs;
  }

  const pfs = matchFromPfs(db, code, modifier, rateContext, locality);
  if (pfs) return pfs;

  if (rateContext === 'facility') {
    const opps = matchFromOpps(db, code);
    if (opps) return opps;
  }

  if (!isLabCode) {
    const clfs = matchFromClfs(db, code, modifier);
    if (clfs) return clfs;
  }
  if (!isJCode) {
    const asp = matchFromAsp(db, code);
    if (asp) return asp;
  }
  if (rateContext !== 'facility') {
    const opps = matchFromOpps(db, code);
    if (opps) return opps;
  }

  return unmatchedResult();
}

function isLabHcpcs(code: string): boolean {
  const num = parseInt(code, 10);
  if (!isNaN(num) && ((num >= 80000 && num <= 89999) || code === '36415')) return true;
  if (/^\d{4}U$/.test(code)) return true;
  return false;
}

function matchFromPfs(
  db: ReturnType<typeof getDb>,
  code: string,
  modifier: string | undefined,
  rateContext: 'facility' | 'non_facility',
  locality: string | undefined,
): MultiMatchResult | null {
  const latest = db.prepare(
    'SELECT id FROM cms_snapshots ORDER BY effective_year DESC, fetched_at DESC LIMIT 1'
  ).get() as { id: number } | undefined;
  if (!latest) return null;

  let sql = `SELECT facility_rate, non_facility_rate, locality, description FROM cms_rates WHERE snapshot_id = ? AND cpt_code = ?`;
  const params: any[] = [latest.id, code];

  if (modifier) { sql += ` AND (modifier = ? OR modifier IS NULL)`; params.push(modifier); }
  if (locality) { sql += ` AND (locality = ? OR locality IS NULL)`; params.push(locality); }

  sql += ` ORDER BY
    CASE WHEN facility_rate IS NOT NULL AND facility_rate > 0 THEN 0 ELSE 1 END,
    CASE WHEN non_facility_rate IS NOT NULL AND non_facility_rate > 0 THEN 0 ELSE 1 END
    LIMIT 1`;

  const row = db.prepare(sql).get(...params) as {
    facility_rate: number | null;
    non_facility_rate: number | null;
    locality: string | null;
    description: string | null;
  } | undefined;

  if (!row) return null;
  if ((row.facility_rate === null || row.facility_rate === 0) && (row.non_facility_rate === null || row.non_facility_rate === 0)) return null;

  const matchMode: MatchMode = modifier && locality
    ? 'exact_code_modifier_locality'
    : modifier ? 'exact_code_modifier'
    : 'exact_code_only';

  const cmsRateUsed = rateContext === 'facility'
    ? (row.facility_rate ?? row.non_facility_rate)
    : (row.non_facility_rate ?? row.facility_rate);

  return {
    facilityRate: row.facility_rate,
    nonFacilityRate: row.non_facility_rate,
    cmsRateUsed,
    matchMode,
    rateSource: 'pfs',
    severity: null,
    disputeStrength: 'none',
    locality: row.locality,
    description: row.description,
    apc: null,
    statusIndicator: null,
    dosage: null,
  };
}

function matchFromClfs(
  db: ReturnType<typeof getDb>,
  code: string,
  modifier: string | undefined,
): MultiMatchResult | null {
  let sql = `SELECT rate, short_desc, long_desc, modifier FROM clfs_rates WHERE hcpcs_code = ?`;
  const params: any[] = [code];

  if (modifier) { sql += ` AND (modifier = ? OR modifier IS NULL OR modifier = '')`; params.push(modifier); }
  sql += ` ORDER BY rate DESC LIMIT 1`;

  const row = db.prepare(sql).get(...params) as {
    rate: number | null;
    short_desc: string | null;
    long_desc: string | null;
    modifier: string | null;
  } | undefined;

  if (!row || row.rate === null || row.rate === 0) return null;

  return {
    facilityRate: row.rate,
    nonFacilityRate: row.rate,
    cmsRateUsed: row.rate,
    matchMode: modifier && row.modifier ? 'exact_code_modifier' : 'exact_code_only',
    rateSource: 'clfs',
    severity: null,
    disputeStrength: 'none',
    locality: null,
    description: row.short_desc || row.long_desc,
    apc: null,
    statusIndicator: null,
    dosage: null,
  };
}

function matchFromAsp(
  db: ReturnType<typeof getDb>,
  code: string,
): MultiMatchResult | null {
  const row = db.prepare(
    `SELECT payment_limit, short_desc, dosage FROM asp_rates WHERE hcpcs_code = ? ORDER BY payment_limit DESC LIMIT 1`
  ).get(code) as {
    payment_limit: number | null;
    short_desc: string | null;
    dosage: string | null;
  } | undefined;

  if (!row || row.payment_limit === null) return null;

  return {
    facilityRate: row.payment_limit,
    nonFacilityRate: row.payment_limit,
    cmsRateUsed: row.payment_limit,
    matchMode: 'exact_code_only',
    rateSource: 'asp',
    severity: null,
    disputeStrength: 'none',
    locality: null,
    description: row.short_desc,
    apc: null,
    statusIndicator: null,
    dosage: row.dosage,
  };
}

function matchFromOpps(
  db: ReturnType<typeof getDb>,
  code: string,
): MultiMatchResult | null {
  const row = db.prepare(
    `SELECT payment_rate, short_desc, status_indicator, apc FROM opps_rates WHERE hcpcs_code = ? AND payment_rate IS NOT NULL AND payment_rate > 0 ORDER BY payment_rate DESC LIMIT 1`
  ).get(code) as {
    payment_rate: number | null;
    short_desc: string | null;
    status_indicator: string | null;
    apc: string | null;
  } | undefined;

  if (!row || row.payment_rate === null) return null;

  return {
    facilityRate: row.payment_rate,
    nonFacilityRate: null,
    cmsRateUsed: row.payment_rate,
    matchMode: 'exact_code_only',
    rateSource: 'opps',
    severity: null,
    disputeStrength: 'none',
    locality: null,
    description: row.short_desc,
    apc: row.apc,
    statusIndicator: row.status_indicator,
    dosage: null,
  };
}

function unmatchedResult(): MultiMatchResult {
  return {
    facilityRate: null,
    nonFacilityRate: null,
    cmsRateUsed: null,
    matchMode: 'unmatched',
    rateSource: null,
    severity: null,
    disputeStrength: 'none',
    locality: null,
    description: null,
    apc: null,
    statusIndicator: null,
    dosage: null,
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
  rateSource: RateSource | null,
  multiplier: number | null,
): 'strong' | 'moderate' | 'weak' | 'none' {
  if (matchMode === 'unmatched' || multiplier === null) return 'none';
  const isExact = matchMode.startsWith('exact_code');
  const sourceBonus = rateSource === 'pfs' || rateSource === 'clfs' ? 0.5 : 0;
  if (isExact && multiplier > (3 - sourceBonus)) return 'strong';
  if (isExact && multiplier > (2 - sourceBonus)) return 'moderate';
  return 'weak';
}
