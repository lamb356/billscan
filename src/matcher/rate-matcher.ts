import { getDb } from '../db/connection.js';

export type MatchMode = 'exact' | 'code+modifier' | 'code_only' | 'unmatched';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'fair';

export interface MatchResult {
  matchMode: MatchMode;
  facilityRate: number | null;
  nonFacilityRate: number | null;
  cmsRateUsed: number | null;
  description: string | null;
  localityUsed: string | null;
}

export function matchRate(
  code: string,
  modifier: string | undefined,
  rateContext: 'facility' | 'non_facility',
  locality?: string,
): MatchResult {
  const db = getDb();

  // 1. Exact match: code + modifier + locality
  if (locality && modifier) {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code
      FROM cms_rates
      WHERE hcpcs_code = ? AND modifier = ? AND locality_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code, modifier, locality) as any;

    if (row) {
      return buildResult('exact', row, rateContext, locality);
    }
  }

  // 2. code + modifier (any locality)
  if (modifier) {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code
      FROM cms_rates
      WHERE hcpcs_code = ? AND modifier = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code, modifier) as any;

    if (row) {
      return buildResult('code+modifier', row, rateContext, null);
    }
  }

  // 3. code only (with locality)
  if (locality) {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code
      FROM cms_rates
      WHERE hcpcs_code = ? AND locality_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code, locality) as any;

    if (row) {
      return buildResult('code_only', row, rateContext, locality);
    }
  }

  // 4. code only (no locality)
  {
    const row = db.prepare(`
      SELECT hcpcs_code, modifier, description, facility_rate, non_facility_rate, locality_code
      FROM cms_rates
      WHERE hcpcs_code = ?
      ORDER BY effective_year DESC
      LIMIT 1
    `).get(code) as any;

    if (row) {
      return buildResult('code_only', row, rateContext, null);
    }
  }

  // 5. Unmatched
  return {
    matchMode: 'unmatched',
    facilityRate: null,
    nonFacilityRate: null,
    cmsRateUsed: null,
    description: null,
    localityUsed: null,
  };
}

function buildResult(
  mode: MatchMode,
  row: any,
  rateContext: 'facility' | 'non_facility',
  localityUsed: string | null,
): MatchResult {
  const facilityRate = row.facility_rate ?? null;
  const nonFacilityRate = row.non_facility_rate ?? null;
  const cmsRateUsed = rateContext === 'facility' ? facilityRate : nonFacilityRate;

  return {
    matchMode: mode,
    facilityRate,
    nonFacilityRate,
    cmsRateUsed: cmsRateUsed ?? facilityRate ?? nonFacilityRate,
    description: row.description || null,
    localityUsed,
  };
}

export function calculateSeverity(multiplier: number): Severity {
  if (multiplier >= 5) return 'critical';
  if (multiplier >= 3) return 'high';
  if (multiplier >= 2) return 'medium';
  if (multiplier >= 1.2) return 'low';
  return 'fair';
}
