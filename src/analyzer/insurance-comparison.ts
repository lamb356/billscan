/**
 * Insurance Rate Comparison Module
 *
 * Compares three rate tiers for each CPT code:
 *   1. Billed amount (what the hospital charged)
 *   2. CMS Medicare rate (from multi-matcher)
 *   3. Insurance allowed amount (from EOB, or estimated via KFF/RAND heuristics)
 *
 * Estimation multipliers are based on published research:
 *   - KFF: "How do privately insured rates compare to Medicare rates?"
 *     https://www.kff.org/medicare/issue-brief/how-do-privately-insured-rates-compare-to-medicare-rates/
 *   - RAND: "Nationwide Evaluation of Health Care Prices Paid by Private Health Plans"
 *     https://www.rand.org/pubs/research_reports/RRA788-1.html
 *   National average private-payer allowed amount ≈ 143% of Medicare (RAND, 2020)
 *   PPO plans typically negotiate 120–200% of Medicare
 *   HMO plans typically negotiate 100–150% of Medicare
 *   Out-of-network rates are typically 200–400% of Medicare
 *
 * IMPORTANT: Estimated ranges are labeled ESTIMATES and are NOT real insurer data.
 */

import type { EOBLineItem } from '../parser/eob-parser.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export type PlanType = 'hmo' | 'ppo' | 'oon';

export interface EstimatedAllowed {
  hmo_low: number | null;    // 100% of Medicare
  hmo_high: number | null;   // 150% of Medicare
  ppo_low: number | null;    // 120% of Medicare
  ppo_high: number | null;   // 200% of Medicare
  oon_low: number | null;    // 200% of Medicare
  oon_high: number | null;   // 400% of Medicare
  national_avg: number | null; // 143% of Medicare (RAND national average)
}

export interface InsuranceComparison {
  cptCode: string;
  description: string;
  billedAmount: number;
  cmsRate: number | null;
  estimatedAllowed: EstimatedAllowed;
  actualAllowed: number | null; // from EOB if available
  overchargeVsCms: number | null;        // billedAmount - cmsRate
  overchargeVsEstimated: number | null;  // billedAmount - planMidpoint estimate
  overchargeVsActual: number | null;     // billedAmount - actualAllowed (EOB)
  // What the patient likely overpaid vs. actual negotiated rate
  patientSavingsOpportunity: number | null;
}

// Multiplier constants (source: KFF + RAND research)
const MULTIPLIERS = {
  hmo_low: 1.00,
  hmo_high: 1.50,
  ppo_low: 1.20,
  ppo_high: 2.00,
  oon_low: 2.00,
  oon_high: 4.00,
  national_avg: 1.43,
} as const;

// ─── Core builder ─────────────────────────────────────────────────────────────

/**
 * Builds an InsuranceComparison for a single line item.
 *
 * @param cptCode          The CPT/HCPCS code
 * @param description      Human-readable description
 * @param billedAmount     What the provider billed
 * @param cmsRate          CMS Medicare rate (null if unmatched)
 * @param eobLineItem      EOB line item for this code, if available
 */
export function buildInsuranceComparison(
  cptCode: string,
  description: string,
  billedAmount: number,
  cmsRate: number | null,
  eobLineItem?: EOBLineItem | null,
): InsuranceComparison {
  const actualAllowed = eobLineItem?.allowedAmount ?? null;

  // Compute estimated ranges from Medicare base
  const estimatedAllowed: EstimatedAllowed = {
    hmo_low: cmsRate !== null ? +(cmsRate * MULTIPLIERS.hmo_low).toFixed(2) : null,
    hmo_high: cmsRate !== null ? +(cmsRate * MULTIPLIERS.hmo_high).toFixed(2) : null,
    ppo_low: cmsRate !== null ? +(cmsRate * MULTIPLIERS.ppo_low).toFixed(2) : null,
    ppo_high: cmsRate !== null ? +(cmsRate * MULTIPLIERS.ppo_high).toFixed(2) : null,
    oon_low: cmsRate !== null ? +(cmsRate * MULTIPLIERS.oon_low).toFixed(2) : null,
    oon_high: cmsRate !== null ? +(cmsRate * MULTIPLIERS.oon_high).toFixed(2) : null,
    national_avg: cmsRate !== null ? +(cmsRate * MULTIPLIERS.national_avg).toFixed(2) : null,
  };

  const overchargeVsCms = cmsRate !== null
    ? +(billedAmount - cmsRate).toFixed(2)
    : null;

  // For estimated: use plan-appropriate midpoint
  const planMid = estimatedAllowed.national_avg;
  const overchargeVsEstimated = planMid !== null
    ? +(billedAmount - planMid).toFixed(2)
    : null;

  const overchargeVsActual = actualAllowed !== null
    ? +(billedAmount - actualAllowed).toFixed(2)
    : null;

  // Patient savings opportunity: how much more the patient paid vs actual allowed
  // (only relevant if we have EOB data showing what was actually negotiated)
  const patientSavingsOpportunity = actualAllowed !== null && cmsRate !== null
    ? +(actualAllowed - cmsRate).toFixed(2) // how much over Medicare the insurer still allowed
    : null;

  return {
    cptCode,
    description,
    billedAmount,
    cmsRate,
    estimatedAllowed,
    actualAllowed,
    overchargeVsCms,
    overchargeVsEstimated,
    overchargeVsActual,
    patientSavingsOpportunity,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Returns the estimated allowed range for a given plan type, as [low, high].
 * Returns [null, null] if CMS rate is unavailable.
 */
export function getPlanRange(
  comp: InsuranceComparison,
  plan: PlanType,
): [number | null, number | null] {
  switch (plan) {
    case 'hmo': return [comp.estimatedAllowed.hmo_low, comp.estimatedAllowed.hmo_high];
    case 'ppo': return [comp.estimatedAllowed.ppo_low, comp.estimatedAllowed.ppo_high];
    case 'oon': return [comp.estimatedAllowed.oon_low, comp.estimatedAllowed.oon_high];
  }
}

/**
 * Returns the midpoint of the plan range (for display purposes).
 */
export function getPlanMidpoint(comp: InsuranceComparison, plan: PlanType): number | null {
  const [lo, hi] = getPlanRange(comp, plan);
  if (lo === null || hi === null) return null;
  return +((lo + hi) / 2).toFixed(2);
}

/**
 * Returns a human-readable label for the plan type.
 */
export function planLabel(plan: PlanType): string {
  switch (plan) {
    case 'hmo': return 'HMO (est. 100–150% Medicare)';
    case 'ppo': return 'PPO (est. 120–200% Medicare)';
    case 'oon': return 'Out-of-Network (est. 200–400% Medicare)';
  }
}

/**
 * Returns the multiplier range description for footnotes.
 */
export function planMultiplierNote(plan: PlanType): string {
  const src = 'Source: KFF + RAND Hospital Price Transparency Research (ESTIMATES ONLY)';
  switch (plan) {
    case 'hmo': return `HMO plans typically allowed 100–150% of Medicare rates. ${src}`;
    case 'ppo': return `PPO plans typically allowed 120–200% of Medicare rates. ${src}`;
    case 'oon': return `Out-of-network typically billed 200–400% of Medicare rates. ${src}`;
  }
}
