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

/**
 * Multi-source rate matcher. Checks all available CMS data sources:
 * 1. PFS (Physician Fee Schedule) — facility & non-facility rates
 * 2. CLFS (Clinical Lab Fee Schedule) — single national rate for lab codes
 * 3. ASP (Average Sales Price) — drug payment limits for J-codes
 * 4. OPPS (Outpatient PPS) — APC payment rates for facility outpatient
 *
 * Matching strategy:
 *   - J-codes → try ASP first, then PFS
 *   - Lab codes (80000-89999, 36415, 0001U-0999U) → try CLFS first, then PFS
 *   - Outpatient/ER codes → try OPPS first for facility context, then PFS
 *   - Everything else → PFS first, then OPPS
 */
export async function matchRateMulti(
  cptCode: string,
  modifier?: string,
  rateContext: 'facility' | 'non_facility' = 'facility',
  locality?: string,
): Promise<MultiMatchResult> {
  const db = getDb();
  const code = cptCode.trim().toUpperCase();

  // Determine code category
  const isJCode = code.startsWith('J');
  const isLabCode = isLabHcpcs(code);

  // Strategy: try most specific source first based on code type
  if (isJCode) {
    // Drug code → ASP first
    const asp = await matchFromAsp(db, code);
    if (asp) return asp;
  }

  if (isLabCode) {
    // Lab code → CLFS first
    const clfs = await matchFromClfs(db, code, modifier);
    if (clfs) return clfs;
  }

  // PFS (the main physician fee schedule — always tried)
  const pfs = await matchFromPfs(db, code, modifier, rateContext, locality);
  if (pfs) return pfs;

  // OPPS as fallback (especially useful for facility/ER context)
  if (rateContext === 'facility') {
    const opps = await matchFromOpps(db, code);
    if (opps) return opps;
  }

  // Try remaining sources as fallback
  if (!isLabCode) {
    const clfs = await matchFromClfs(db, code, modifier);
    if (clfs) return clfs;
  }
  if (!isJCode) {
    const asp = await matchFromAsp(db, code);
    if (asp) return asp;
  }
  if (rateContext !== 'facility') {
    const opps = await matchFromOpps(db, code);
    if (opps) return opps;
  }

  return unmatchedResult();
}

function isLabHcpcs(code: string): boolean {
  const num = parseInt(code, 10);
  // Lab codes: 80000-89999, 36415 (venipuncture), U-codes (PLA)
  if (!isNaN(num) && ((num >= 80000 && num <= 89999) || code === '36415')) return true;
  if (/^\d{4}U$/.test(code)) return true;
  return false;
}

// ─── PFS Lookup ───────────────────────────────────────────────────────────────

async function matchFromPfs(
  db: ReturnType<typeof getDb>,
  code: string,
  modifier: string | undefined,
  rateContext: 'facility' | 'non_facility',
  locality: string | undefined,
): Promise<MultiMatchResult | null> {
  const latest = (await db.execute({
    sql: 'SELECT id FROM cms_snapshots ORDER BY effective_year DESC, fetched_at DESC LIMIT 1',
    args: [],
  })).rows[0] as { id: number } | undefined;
  if (!latest) return null;

  let sql = `SELECT facility_rate, non_facility_rate, locality, description FROM cms_rates WHERE snapshot_id = ? AND cpt_code = ?`;
  const args: any[] = [latest.id, code];

  if (modifier) {
    sql += ` AND (modifier = ? OR modifier IS NULL)`;
    args.push(modifier);
  }
  if (locality) {
    sql += ` AND (locality = ? OR locality IS NULL)`;
    args.push(locality);
  }

  sql += ` ORDER BY
    CASE WHEN facility_rate IS NOT NULL AND facility_rate > 0 THEN 0 ELSE 1 END,
    CASE WHEN non_facility_rate IS NOT NULL AND non_facility_rate > 0 THEN 0 ELSE 1 END
    LIMIT 1`;

  const row = (await db.execute({ sql, args })).rows[0] as {
    facility_rate: number | null;
    non_facility_rate: number | null;
    locality: string | null;
    description: string | null;
  } | undefined;

  if (!row) return null;
  if ((row.facility_rate === null || row.facility_rate === 0) &&
      (row.non_facility_rate === null || row.non_facility_rate === 0)) return null;

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

// ─── CLFS Lookup ──────────────────────────────────────────────────────────────

async function matchFromClfs(
  db: ReturnType<typeof getDb>,
  code: string,
  modifier: string | undefined,
): Promise<MultiMatchResult | null> {
  let sql = `SELECT rate, short_desc, long_desc, modifier FROM clfs_rates WHERE hcpcs_code = ?`;
  const args: any[] = [code];

  if (modifier) {
    sql += ` AND (modifier = ? OR modifier IS NULL OR modifier = '')`;
    args.push(modifier);
  }

  sql += ` ORDER BY rate DESC LIMIT 1`;

  const row = (await db.execute({ sql, args })).rows[0] as {
    rate: number | null;
    short_desc: string | null;
    long_desc: string | null;
    modifier: string | null;
  } | undefined;

  if (!row || row.rate === null || row.rate === 0) return null;

  // CLFS has a single national rate (used as both facility and non-facility)
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

// ─── ASP Lookup ───────────────────────────────────────────────────────────────

async function matchFromAsp(
  db: ReturnType<typeof getDb>,
  code: string,
): Promise<MultiMatchResult | null> {
  const row = (await db.execute({
    sql: `SELECT payment_limit, short_desc, dosage FROM asp_rates WHERE hcpcs_code = ? ORDER BY payment_limit DESC LIMIT 1`,
    args: [code],
  })).rows[0] as {
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

// ─── OPPS Lookup ──────────────────────────────────────────────────────────────

async function matchFromOpps(
  db: ReturnType<typeof getDb>,
  code: string,
): Promise<MultiMatchResult | null> {
  const row = (await db.execute({
    sql: `SELECT payment_rate, short_desc, status_indicator, apc FROM opps_rates WHERE hcpcs_code = ? AND payment_rate IS NOT NULL AND payment_rate > 0 ORDER BY payment_rate DESC LIMIT 1`,
    args: [code],
  })).rows[0] as {
    payment_rate: number | null;
    short_desc: string | null;
    status_indicator: string | null;
    apc: string | null;
  } | undefined;

  if (!row || row.payment_rate === null) return null;

  // OPPS rates are facility-only (outpatient hospital setting)
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  // Multi-source match is stronger evidence
  const sourceBonus = rateSource === 'pfs' || rateSource === 'clfs' ? 0.5 : 0;
  if (isExact && multiplier > (3 - sourceBonus)) return 'strong';
  if (isExact && multiplier > (2 - sourceBonus)) return 'moderate';
  return 'weak';
}
