import { getDb } from '../db/connection.js';

export type MatchMode = 'exact' | 'code+modifier' | 'code_only' | 'clfs' | 'asp' | 'opps' | 'unmatched';
export type RateSource = 'PFS' | 'CLFS' | 'ASP' | 'OPPS';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'fair';
export type DisputeStrength = 'strong' | 'moderate' | 'weak';

export interface MultiMatchResult {
  matchMode: MatchMode;
  rateSource: RateSource | null;
  facilityRate: number | null;
  nonFacilityRate: number | null;
  cmsRateUsed: number | null;
  description: string | null;
  localityUsed: string | null;
  apc: string | null;
  dosage: string | null;
}

/**
 * Match a CPT/HCPCS code against all available CMS data sources.
 * Priority order:
 * 1. PFS (Physician Fee Schedule) - most specific for physician services
 * 2. CLFS (Clinical Lab Fee Schedule) - lab codes
 * 3. ASP (Average Sales Price) - drug codes (J-codes)
 * 4. OPPS (Outpatient PPS) - hospital outpatient codes
 */
export function matchRateMulti(
  code: string,
  modifier: string | undefined,
  rateContext: 'facility' | 'non_facility',
  locality?: string,
): MultiMatchResult {
  const db = getDb();

  // ── 1. PFS: Try exact match (code + modifier + locality) ──────────────────
  if (locality && modifier) {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code
      FROM cms_rates
      WHERE hcpcs_code = ? AND modifier = ? AND locality_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code, modifier, locality) as any;

    if (row) {
      return buildPfsResult('exact', row, rateContext, locality);
    }
  }

  // ── 2. PFS: code + modifier (any locality) ───────────────────────────────
  if (modifier) {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code
      FROM cms_rates
      WHERE hcpcs_code = ? AND modifier = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code, modifier) as any;

    if (row) {
      return buildPfsResult('code+modifier', row, rateContext, null);
    }
  }

  // ── 3. PFS: code only (locality match) ───────────────────────────────────
  if (locality) {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code
      FROM cms_rates
      WHERE hcpcs_code = ? AND locality_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code, locality) as any;

    if (row) {
      return buildPfsResult('code_only', row, rateContext, locality);
    }
  }

  // ── 4. PFS: code only (no locality) ──────────────────────────────────────
  {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code
      FROM cms_rates
      WHERE hcpcs_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code) as any;

    if (row) {
      return buildPfsResult('code_only', row, rateContext, null);
    }
  }

  // ── 5. CLFS: Clinical Lab Fee Schedule ───────────────────────────────────
  {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, rate, short_desc
      FROM clfs_rates
      WHERE hcpcs_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code) as any;

    if (row) {
      return {
        matchMode: 'clfs',
        rateSource: 'CLFS',
        facilityRate: row.rate,
        nonFacilityRate: row.rate,
        cmsRateUsed: row.rate,
        description: row.short_desc || null,
        localityUsed: null,
        apc: null,
        dosage: null,
      };
    }
  }

  // ── 6. ASP: Average Sales Price (drug codes) ─────────────────────────────
  {
    const row = db.prepare(`
      SELECT hcpcs_code, payment_limit, short_desc, dosage
      FROM asp_rates
      WHERE hcpcs_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code) as any;

    if (row) {
      return {
        matchMode: 'asp',
        rateSource: 'ASP',
        facilityRate: row.payment_limit,
        nonFacilityRate: row.payment_limit,
        cmsRateUsed: row.payment_limit,
        description: row.short_desc || null,
        localityUsed: null,
        apc: null,
        dosage: row.dosage || null,
      };
    }
  }

  // ── 7. OPPS: Outpatient PPS / APC ────────────────────────────────────────
  {
    const row = db.prepare(`
      SELECT hcpcs_code, payment_rate, short_desc, apc
      FROM opps_rates
      WHERE hcpcs_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code) as any;

    if (row) {
      return {
        matchMode: 'opps',
        rateSource: 'OPPS',
        facilityRate: row.payment_rate,
        nonFacilityRate: row.payment_rate,
        cmsRateUsed: row.payment_rate,
        description: row.short_desc || null,
        localityUsed: null,
        apc: row.apc || null,
        dosage: null,
      };
    }
  }

  // ── 8. Unmatched ─────────────────────────────────────────────────────────
  return {
    matchMode: 'unmatched',
    rateSource: null,
    facilityRate: null,
    nonFacilityRate: null,
    cmsRateUsed: null,
    description: null,
    localityUsed: null,
    apc: null,
    dosage: null,
  };
}

function buildPfsResult(
  mode: MatchMode,
  row: any,
  rateContext: 'facility' | 'non_facility',
  localityUsed: string | null,
): MultiMatchResult {
  const facilityRate = row.facility_rate ?? null;
  const nonFacilityRate = row.non_facility_rate ?? null;
  const cmsRateUsed = rateContext === 'facility' ? facilityRate : nonFacilityRate;

  return {
    matchMode: mode,
    rateSource: 'PFS',
    facilityRate,
    nonFacilityRate,
    cmsRateUsed: cmsRateUsed ?? facilityRate ?? nonFacilityRate,
    description: row.description || null,
    localityUsed,
    apc: null,
    dosage: null,
  };
}

export function calculateSeverity(multiplier: number): Severity {
  if (multiplier >= 5) return 'critical';
  if (multiplier >= 3) return 'high';
  if (multiplier >= 2) return 'medium';
  if (multiplier >= 1.2) return 'low';
  return 'fair';
}

export function calculateDisputeStrength(
  matchMode: MatchMode,
  rateSource: RateSource | null,
  multiplier: number | null,
): DisputeStrength {
  if (!multiplier || multiplier < 1.1) return 'weak';

  // Exact matches with high multipliers are strongest
  if (matchMode === 'exact' && multiplier >= 2) return 'strong';
  if (matchMode === 'clfs' && multiplier >= 2) return 'strong';
  if (matchMode === 'asp' && multiplier >= 1.5) return 'strong';
  if (matchMode === 'opps' && multiplier >= 1.5) return 'strong';

  if (multiplier >= 1.5) return 'moderate';
  return 'weak';
}
