/**
 * EOB Audit Module
 *
 * Combines standard bill audit (CMS rate comparison) with EOB analysis
 * to show three-way rate comparison: Billed vs. CMS Medicare vs. Insurance Allowed.
 *
 * Supports two modes:
 *   1. --eob <file>   Actual allowed amounts from an EOB document
 *   2. --plan <type>  Estimated allowed amounts using KFF/RAND heuristics
 */

import { runAudit, type AuditOptions } from './audit.js';
import { parseEob, buildEobLookup, type EOBDocument } from '../parser/eob-parser.js';
import {
  buildInsuranceComparison,
  getPlanRange,
  getPlanMidpoint,
  planLabel,
  planMultiplierNote,
  type InsuranceComparison,
  type PlanType,
} from './insurance-comparison.js';
import type { AuditReport } from '../schema/report.js';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface EOBAuditOptions extends AuditOptions {
  eobPath?: string;
  plan?: PlanType;
}

export interface EOBAuditReport {
  baseReport: AuditReport;
  eob: EOBDocument | null;
  plan: PlanType | null;
  comparisons: InsuranceComparison[];
  // Aggregate insurance stats
  totalBilled: number;
  totalCmsBaseline: number;
  totalActualAllowed: number | null;    // sum from EOB
  totalEstimatedAllowed: number | null; // sum from plan estimates (midpoint)
  totalInsurancePaid: number | null;    // from EOB
  totalPatientResponsibility: number | null; // from EOB
  // Insights
  insights: EOBInsight[];
  footnote: string;
}

export interface EOBInsight {
  type: 'info' | 'warning' | 'alert';
  cptCode: string;
  message: string;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runEobAudit(
  billPath: string,
  options: EOBAuditOptions = {},
): Promise<EOBAuditReport> {
  // 1. Run the standard bill audit to get CMS rate findings
  const { report: baseReport } = await runAudit(billPath, options);

  // 2. Parse EOB if provided
  let eob: EOBDocument | null = null;
  if (options.eobPath) {
    eob = parseEob(options.eobPath);
    console.log(`[eob-audit] Loaded EOB: ${eob.claimNumber} | ${eob.insurerName} | Plan: ${eob.planType}`);
  }

  // 3. Determine plan type
  const plan: PlanType | null = options.plan ?? (eob ? normalizePlanType(eob.planType) : null);

  // 4. Build EOB lookup map (cptCode → line item)
  const eobLookup = eob ? buildEobLookup(eob) : new Map();

  // 5. Build insurance comparisons for each finding
  const comparisons: InsuranceComparison[] = baseReport.findings.map(finding => {
    const eobLine = eobLookup.get(finding.cptCode) ?? null;
    return buildInsuranceComparison(
      finding.cptCode,
      finding.description,
      finding.billedAmount,
      finding.cmsRateUsed,
      eobLine,
    );
  });

  // 6. Aggregate totals
  const totalCmsBaseline = baseReport.totalCmsBaseline;
  const totalBilled = baseReport.totalBilled;

  const totalActualAllowed = eob
    ? +comparisons.reduce((s, c) => s + (c.actualAllowed ?? 0), 0).toFixed(2)
    : null;

  const totalEstimatedAllowed = plan
    ? +comparisons.reduce((s, c) => {
        const mid = getPlanMidpoint(c, plan);
        return s + (mid ?? 0);
      }, 0).toFixed(2)
    : null;

  // 7. Generate insights
  const insights: EOBInsight[] = generateInsights(comparisons, eob, plan);

  // 8. Footnote
  const footnote = buildFootnote(eob, plan);

  return {
    baseReport,
    eob,
    plan,
    comparisons,
    totalBilled,
    totalCmsBaseline,
    totalActualAllowed,
    totalEstimatedAllowed,
    totalInsurancePaid: eob?.totalInsurancePaid ?? null,
    totalPatientResponsibility: eob?.totalPatientResponsibility ?? null,
    insights,
    footnote,
  };
}

// ─── Insight generation ───────────────────────────────────────────────────────

function generateInsights(
  comparisons: InsuranceComparison[],
  eob: EOBDocument | null,
  plan: PlanType | null,
): EOBInsight[] {
  const insights: EOBInsight[] = [];

  for (const c of comparisons) {
    if (c.cmsRate === null) continue;

    // Insight: Insurance allowed MORE than Medicare (insurer overpaid vs CMS baseline)
    if (c.actualAllowed !== null && c.actualAllowed > c.cmsRate * 1.5) {
      const ratio = (c.actualAllowed / c.cmsRate).toFixed(1);
      insights.push({
        type: 'info',
        cptCode: c.cptCode,
        message: `Insurance allowed $${c.actualAllowed} (${ratio}x Medicare) — PPO negotiation exceeded CMS baseline`,
      });
    }

    // Insight: Billed amount is extreme vs. allowed amount
    if (c.actualAllowed !== null && c.billedAmount > c.actualAllowed * 5) {
      const ratio = (c.billedAmount / c.actualAllowed).toFixed(0);
      insights.push({
        type: 'warning',
        cptCode: c.cptCode,
        message: `Billed $${c.billedAmount.toLocaleString()} but insurer only allowed $${c.actualAllowed} (${ratio}x difference) — uninsured patients would owe full billed rate`,
      });
    }

    // Insight: Estimated PPO midpoint much lower than billed
    if (plan && c.cmsRate !== null) {
      const mid = getPlanMidpoint(c, plan);
      if (mid !== null && c.billedAmount > mid * 3) {
        insights.push({
          type: 'alert',
          cptCode: c.cptCode,
          message: `Billed $${c.billedAmount.toLocaleString()} is ${(c.billedAmount / mid).toFixed(1)}x the estimated ${plan.toUpperCase()} allowed midpoint of $${mid}`,
        });
      }
    }

    // Insight: J-code or drug with large markup over allowed
    if (c.cptCode.startsWith('J') && c.actualAllowed !== null) {
      const markup = (c.billedAmount / c.actualAllowed).toFixed(0);
      if (c.billedAmount > c.actualAllowed * 3) {
        insights.push({
          type: 'alert',
          cptCode: c.cptCode,
          message: `Drug charge (${c.cptCode}) billed at ${markup}x the insurer's allowed amount — verify units/dosage`,
        });
      }
    }
  }

  return insights;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalizes a plan type string from EOB to our PlanType enum.
 * Defaults to 'ppo' (most common commercial plan type).
 */
function normalizePlanType(planTypeStr: string): PlanType {
  const lower = planTypeStr.toLowerCase();
  if (lower.includes('hmo')) return 'hmo';
  if (lower.includes('oon') || lower.includes('out-of-network') || lower.includes('out of network')) return 'oon';
  // PPO, EPO, POS, HDHP all typically negotiate at PPO-like rates
  return 'ppo';
}

function buildFootnote(eob: EOBDocument | null, plan: PlanType | null): string {
  if (eob) {
    return (
      `EOB data from ${eob.insurerName} (${eob.planType} plan), claim ${eob.claimNumber}, ` +
      `date of service ${eob.dateOfService}. Allowed amounts are actual insurer-negotiated rates.`
    );
  }
  if (plan) {
    return planMultiplierNote(plan);
  }
  return 'No insurance data provided. Run with --eob <file> or --plan <hmo|ppo|oon> to see insurance comparisons.';
}

// Re-export key types for convenience
export type { InsuranceComparison, PlanType, EOBDocument };
export { getPlanRange, getPlanMidpoint, planLabel };
