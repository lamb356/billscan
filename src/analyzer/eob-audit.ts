/**
 * EOB Audit Module
 *
 * Combines standard bill audit (CMS rate comparison) with EOB analysis
 * to show three-way rate comparison: Billed vs. CMS Medicare vs. Insurance Allowed.
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

export interface EOBAuditOptions extends AuditOptions {
  eobPath?: string;
  plan?: PlanType;
}

export interface EOBAuditReport {
  baseReport: AuditReport;
  eob: EOBDocument | null;
  plan: PlanType | null;
  comparisons: InsuranceComparison[];
  totalBilled: number;
  totalCmsBaseline: number;
  totalActualAllowed: number | null;
  totalEstimatedAllowed: number | null;
  totalInsurancePaid: number | null;
  totalPatientResponsibility: number | null;
  insights: EOBInsight[];
  footnote: string;
}

export interface EOBInsight {
  type: 'info' | 'warning' | 'alert';
  cptCode: string;
  message: string;
}

export async function runEobAudit(
  billPath: string,
  options: EOBAuditOptions = {},
): Promise<EOBAuditReport> {
  const baseReport = await runAudit(billPath, options);

  let eob: EOBDocument | null = null;
  if (options.eobPath) {
    eob = parseEob(options.eobPath);
    console.log(`[eob-audit] Loaded EOB: ${eob.claimNumber} | ${eob.insurerName} | Plan: ${eob.planType}`);
  }

  const plan: PlanType | null = options.plan ?? (eob ? normalizePlanType(eob.planType) : null);
  const eobLookup = eob ? buildEobLookup(eob) : new Map();

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

  const insights: EOBInsight[] = generateInsights(comparisons, eob, plan);
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

function generateInsights(
  comparisons: InsuranceComparison[],
  eob: EOBDocument | null,
  plan: PlanType | null,
): EOBInsight[] {
  const insights: EOBInsight[] = [];

  for (const c of comparisons) {
    if (c.cmsRate === null) continue;

    if (c.actualAllowed !== null && c.actualAllowed > c.cmsRate * 1.5) {
      const ratio = (c.actualAllowed / c.cmsRate).toFixed(1);
      insights.push({
        type: 'info',
        cptCode: c.cptCode,
        message: `Insurance allowed $${c.actualAllowed} (${ratio}x Medicare) - PPO negotiation exceeded CMS baseline`,
      });
    }

    if (c.actualAllowed !== null && c.billedAmount > c.actualAllowed * 5) {
      const ratio = (c.billedAmount / c.actualAllowed).toFixed(0);
      insights.push({
        type: 'warning',
        cptCode: c.cptCode,
        message: `Billed $${c.billedAmount.toLocaleString()} but insurer only allowed $${c.actualAllowed} (${ratio}x difference)`,
      });
    }

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

    if (c.cptCode.startsWith('J') && c.actualAllowed !== null) {
      const markup = (c.billedAmount / c.actualAllowed).toFixed(0);
      if (c.billedAmount > c.actualAllowed * 3) {
        insights.push({
          type: 'alert',
          cptCode: c.cptCode,
          message: `Drug charge (${c.cptCode}) billed at ${markup}x the insurer's allowed amount - verify units/dosage`,
        });
      }
    }
  }

  return insights;
}

function normalizePlanType(planTypeStr: string): PlanType {
  const lower = planTypeStr.toLowerCase();
  if (lower.includes('hmo')) return 'hmo';
  if (lower.includes('oon') || lower.includes('out-of-network') || lower.includes('out of network')) return 'oon';
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

export type { InsuranceComparison, PlanType, EOBDocument };
export { getPlanRange, getPlanMidpoint, planLabel };
