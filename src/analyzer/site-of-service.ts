/**
 * Site-of-Service Comparator
 *
 * Compares what was charged (hospital/facility setting) vs what the same service
 * would cost in a physician office setting. This is directly actionable — patients
 * can often choose where to get non-emergency services.
 *
 * Uses REAL CMS rates from the database:
 *   - cms_rates table: facility_rate and non_facility_rate columns
 *   - opps_rates table: hospital outpatient payment rates
 *
 * NEVER fabricates or hardcodes rates.
 */

import { getDb } from '../db/connection.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface SiteOfServiceComparison {
  cptCode: string;
  description: string;
  billedAmount: number;
  facilityRate: number | null;
  nonFacilityRate: number | null;
  oppsRate: number | null;
  potentialSavings: number | null;
  savingsPercent: number | null;
  recommendation: string;
  isShoppable: boolean;
}

export interface SiteOfServiceLineItem {
  cptCode: string;
  description: string;
  billedAmount: number;
}

// ─── Shoppable service classification ─────────────────────────────────────────

/**
 * Determines whether a service is "shoppable" — meaning the patient could
 * reasonably choose an alternative site of service for a non-emergency setting.
 */
function classifyShoppable(cptCode: string): { isShoppable: boolean; reason: string } {
  const code = cptCode.trim().toUpperCase();
  const num = parseInt(code, 10);

  // ER visits — NOT shoppable
  if (!isNaN(num) && num >= 99281 && num <= 99285) {
    return { isShoppable: false, reason: 'Emergency department visit — not a shoppable service' };
  }

  // Critical care — NOT shoppable
  if (!isNaN(num) && num >= 99291 && num <= 99292) {
    return { isShoppable: false, reason: 'Critical care — not a shoppable service' };
  }

  // Inpatient E&M — NOT shoppable
  if (!isNaN(num) && ((num >= 99221 && num <= 99223) || (num >= 99231 && num <= 99233))) {
    return { isShoppable: false, reason: 'Inpatient hospital care — not a shoppable service' };
  }

  // E&M office visits (99201-99215) — shoppable
  if (!isNaN(num) && num >= 99201 && num <= 99215) {
    return { isShoppable: true, reason: 'Office visit — can be performed in a physician office or clinic' };
  }

  // Imaging (70000-79999) — mostly shoppable
  if (!isNaN(num) && num >= 70000 && num <= 79999) {
    return { isShoppable: true, reason: 'Imaging service — often available at independent imaging centers at lower cost' };
  }

  // Lab (80000-89999) — shoppable
  if (!isNaN(num) && num >= 80000 && num <= 89999) {
    return { isShoppable: true, reason: 'Laboratory test — available at independent labs (Quest, LabCorp) at lower cost' };
  }

  // Blood draw
  if (code === '36415') {
    return { isShoppable: true, reason: 'Blood draw — available at independent labs at lower cost' };
  }

  // Minor procedures (10000-69999) — case by case, generally shoppable for minor
  if (!isNaN(num) && num >= 10000 && num <= 29999) {
    return { isShoppable: true, reason: 'Minor procedure — may be available in outpatient or office setting' };
  }

  // More complex procedures (30000-69999)
  if (!isNaN(num) && num >= 30000 && num <= 69999) {
    return { isShoppable: false, reason: 'Surgical procedure — site of service depends on clinical requirements' };
  }

  // Physical therapy, chiropractic (97000-97999)
  if (!isNaN(num) && num >= 97000 && num <= 97999) {
    return { isShoppable: true, reason: 'Therapy service — available at independent therapy practices' };
  }

  // Drug codes (J-codes)
  if (code.startsWith('J')) {
    return { isShoppable: false, reason: 'Drug administration — site may be medically determined' };
  }

  // Default: mark as potentially shoppable with a note
  return { isShoppable: false, reason: 'Service shoppability depends on clinical context' };
}

// ─── Database lookup ──────────────────────────────────────────────────────────

interface RateLookupResult {
  facilityRate: number | null;
  nonFacilityRate: number | null;
  oppsRate: number | null;
  description: string | null;
}

async function lookupRates(
  db: ReturnType<typeof getDb>,
  cptCode: string,
  snapshotId: number,
  locality?: string,
): Promise<RateLookupResult> {
  const code = cptCode.trim().toUpperCase();
  const result: RateLookupResult = {
    facilityRate: null,
    nonFacilityRate: null,
    oppsRate: null,
    description: null,
  };

  // 1. Look up PFS (cms_rates) for facility and non-facility rates
  {
    let sql = `SELECT facility_rate, non_facility_rate, description FROM cms_rates WHERE snapshot_id = ? AND cpt_code = ?`;
    const args: any[] = [snapshotId, code];

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
      description: string | null;
    } | undefined;

    if (row) {
      result.facilityRate = row.facility_rate;
      result.nonFacilityRate = row.non_facility_rate;
      result.description = row.description;
    }
  }

  // 2. Look up OPPS rate
  try {
    const oppsRow = (await db.execute({
      sql: `SELECT payment_rate, short_desc FROM opps_rates WHERE hcpcs_code = ? AND payment_rate IS NOT NULL AND payment_rate > 0 ORDER BY payment_rate DESC LIMIT 1`,
      args: [code],
    })).rows[0] as { payment_rate: number | null; short_desc: string | null } | undefined;

    if (oppsRow?.payment_rate) {
      result.oppsRate = oppsRow.payment_rate;
      if (!result.description && oppsRow.short_desc) {
        result.description = oppsRow.short_desc;
      }
    }
  } catch {
    // opps_rates table may not exist — safe to ignore
  }

  return result;
}

// ─── Recommendation text builder ──────────────────────────────────────────────

function buildRecommendation(
  cptCode: string,
  facilityRate: number | null,
  nonFacilityRate: number | null,
  oppsRate: number | null,
  isShoppable: boolean,
  shoppableReason: string,
): string {
  if (!isShoppable) {
    return shoppableReason;
  }

  if (facilityRate !== null && nonFacilityRate !== null && facilityRate > nonFacilityRate && nonFacilityRate > 0) {
    const savings = facilityRate - nonFacilityRate;
    const pct = ((savings / facilityRate) * 100).toFixed(0);
    return `This service costs ${pct}% less in a doctor's office vs hospital outpatient setting ` +
      `(CMS office rate: $${nonFacilityRate.toFixed(2)} vs facility rate: $${facilityRate.toFixed(2)}). ` +
      `${shoppableReason}.`;
  }

  if (facilityRate !== null && nonFacilityRate !== null && facilityRate === nonFacilityRate) {
    return `CMS rates are the same for facility and non-facility settings ($${facilityRate.toFixed(2)}). ` +
      `However, hospital facility fees may still apply — ask if there are additional charges.`;
  }

  if (nonFacilityRate !== null && facilityRate === null) {
    return `This service has a CMS non-facility (office) rate of $${nonFacilityRate.toFixed(2)}. ` +
      `${shoppableReason}.`;
  }

  if (facilityRate !== null && nonFacilityRate === null) {
    return `This service only has a facility rate in the CMS database ($${facilityRate.toFixed(2)}). ` +
      `It may still be available at lower cost in non-hospital settings.`;
  }

  return `${shoppableReason}. Consider comparing prices at different facilities.`;
}

// ─── Main comparison function ─────────────────────────────────────────────────

export async function compareSiteOfService(
  lineItems: SiteOfServiceLineItem[],
  locality?: string,
): Promise<SiteOfServiceComparison[]> {
  const db = getDb();

  // Get latest snapshot
  const snapshot = (await db.execute({
    sql: 'SELECT id FROM cms_snapshots ORDER BY effective_year DESC, fetched_at DESC LIMIT 1',
    args: [],
  })).rows[0] as { id: number } | undefined;

  if (!snapshot) {
    // No CMS data — return empty comparisons with nulls
    return lineItems.map(item => {
      const { isShoppable, reason } = classifyShoppable(item.cptCode);
      return {
        cptCode: item.cptCode,
        description: item.description,
        billedAmount: item.billedAmount,
        facilityRate: null,
        nonFacilityRate: null,
        oppsRate: null,
        potentialSavings: null,
        savingsPercent: null,
        recommendation: 'CMS rate data not available. Run `billscan fetch-all` to load rates.',
        isShoppable,
      };
    });
  }

  const comparisons: SiteOfServiceComparison[] = [];

  for (const item of lineItems) {
    const rates = await lookupRates(db, item.cptCode, snapshot.id, locality);
    const { isShoppable, reason } = classifyShoppable(item.cptCode);

    // Calculate potential savings from choosing office vs facility
    let potentialSavings: number | null = null;
    let savingsPercent: number | null = null;

    if (rates.facilityRate !== null && rates.nonFacilityRate !== null &&
        rates.facilityRate > 0 && rates.nonFacilityRate > 0 &&
        rates.facilityRate > rates.nonFacilityRate) {
      potentialSavings = +(rates.facilityRate - rates.nonFacilityRate).toFixed(2);
      savingsPercent = +((potentialSavings / rates.facilityRate) * 100).toFixed(1);
    }

    const recommendation = buildRecommendation(
      item.cptCode,
      rates.facilityRate,
      rates.nonFacilityRate,
      rates.oppsRate,
      isShoppable,
      reason,
    );

    comparisons.push({
      cptCode: item.cptCode,
      description: rates.description || item.description,
      billedAmount: item.billedAmount,
      facilityRate: rates.facilityRate,
      nonFacilityRate: rates.nonFacilityRate,
      oppsRate: rates.oppsRate,
      potentialSavings,
      savingsPercent,
      recommendation,
      isShoppable,
    });
  }

  return comparisons;
}
