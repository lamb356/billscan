/**
 * Insurance Rate Comparison Module
 *
 * Compares three rate tiers for each CPT code:
 *   1. Billed amount (what the hospital charged)
 *   2. CMS Medicare rate (from multi-matcher)
 *   3. Insurance allowed amount (from EOB, or estimated via KFF/RAND heuristics)
 *
 * Estimation multipliers based on:
 *   - KFF: https://www.kff.org/medicare/issue-brief/how-do-privately-insured-rates-compare-to-medicare-rates/
 *   - RAND: https://www.rand.org/pubs/research_reports/RRA788-1.html
 *
 * IMPORTANT: Estimated ranges are labeled ESTIMATES and are NOT real insurer data.
 */

import type { EOBLineItem } from '../parser/eob-parser.js';

export type PlanType = 'hmo' | 'ppo' | 'oon';

export interface EstimatedAllowed {
  hmo_low: number | null;
  hmo_high: number | null;
  ppo_low: number | null;
  ppo_high: number | null;
  oon_low: number | null;
  oon_high: number | null;
  national_avg: number | null;
}

export interface InsuranceComparison {
  cptCode: string;
  description: string;
  billedAmount: number;
  cmsRate: number | null;
  estimatedAllowed: EstimatedAllowed;
  actualAllowed: number | null;
  overchargeVsCms: number | null;
  overchargeVsEstimated: number | null;
  overchargeVsActual: number | null;
  patientSavingsOpportunity: number | null;
}

const MULTIPLIERS = {
  hmo_low: 1.00,
  hmo_high: 1.50,
  ppo_low: 1.20,
  ppo_high: 2.00,
  oon_low: 2.00,
  oon_high: 4.00,
  national_avg: 1.43,
} as const;

export function buildInsuranceComparison(
  cptCode: string,
  description: string,
  billedAmount: number,
  cmsRate: number | null,
  eobLineItem?: EOBLineItem | null,
): InsuranceComparison {
  const actualAllowed = eobLineItem?.allowedAmount ?? null;

  const estimatedAllowed: EstimatedAllowed = {
    hmo_low: cmsRate !== null ? +(cmsRate * MULTIPLIERS.hmo_low).toFixed(2) : null,
    hmo_high: cmsRate !== null ? +(cmsRate * MULTIPLIERS.hmo_high).toFixed(2) : null,
    ppo_low: cmsRate !== null ? +(cmsRate * MULTIPLIERS.ppo_low).toFixed(2) : null,
    ppo_high: cmsRate !== null ? +(cmsRate * MULTIPLIERS.ppo_high).toFixed(2) : null,
    oon_low: cmsRate !== null ? +(cmsRate * MULTIPLIERS.oon_low).toFixed(2) : null,
    oon_high: cmsRate !== null ? +(cmsRate * MULTIPLIERS.oon_high).toFixed(2) : null,
    national_avg: cmsRate !== null ? +(cmsRate * MULTIPLIERS.national_avg).toFixed(2) : null,
  };

  const overchargeVsCms = cmsRate !== null ? +(billedAmount - cmsRate).toFixed(2) : null;
  const planMid = estimatedAllowed.national_avg;
  const overchargeVsEstimated = planMid !== null ? +(billedAmount - planMid).toFixed(2) : null;
  const overchargeVsActual = actualAllowed !== null ? +(billedAmount - actualAllowed).toFixed(2) : null;
  const patientSavingsOpportunity = actualAllowed !== null && cmsRate !== null
    ? +(actualAllowed - cmsRate).toFixed(2)
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

export function getPlanMidpoint(comp: InsuranceComparison, plan: PlanType): number | null {
  const [lo, hi] = getPlanRange(comp, plan);
  if (lo === null || hi === null) return null;
  return +((lo + hi) / 2).toFixed(2);
}

export function planLabel(plan: PlanType): string {
  switch (plan) {
    case 'hmo': return 'HMO (est. 100-150% Medicare)';
    case 'ppo': return 'PPO (est. 120-200% Medicare)';
    case 'oon': return 'Out-of-Network (est. 200-400% Medicare)';
  }
}

export function planMultiplierNote(plan: PlanType): string {
  const src = 'Source: KFF + RAND Hospital Price Transparency Research (ESTIMATES ONLY)';
  switch (plan) {
    case 'hmo': return `HMO plans typically allowed 100-150% of Medicare rates. ${src}`;
    case 'ppo': return `PPO plans typically allowed 120-200% of Medicare rates. ${src}`;
    case 'oon': return `Out-of-network typically billed 200-400% of Medicare rates. ${src}`;
  }
}
