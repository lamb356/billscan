/**
 * Unified Savings Summary
 *
 * Combines ALL savings opportunities from the various analyzers into a single
 * actionable summary for both insured and uninsured patients.
 *
 * Data sources:
 *   - Audit findings (CMS rate comparison)
 *   - Billing error detection (upcoding, unbundling, duplicates)
 *   - Site-of-service comparison (facility vs office)
 *   - Balance billing detection (EOB discrepancies)
 *
 * NEVER fabricates data — all amounts come from actual analyzer outputs.
 */

import type { BillingError } from './billing-errors.js';
import type { SiteOfServiceComparison } from './site-of-service.js';
import type { BalanceBillingAlert } from './balance-billing.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface SavingsSummary {
  totalBilled: number;
  cmsBaseline: number;
  uninsuredSavings: {
    negotiationTarget: number;
    potentialSavings: number;
    strategy: string;
  };
  insuredSavings: {
    billingErrorSavings: number;
    siteOfServiceSavings: number;
    balanceBillingSavings: number;
    totalActionableSavings: number;
    strategies: string[];
  };
  universalTips: string[];
}

// ─── Builder function ─────────────────────────────────────────────────────────

export function buildSavingsSummary(
  totalBilled: number,
  cmsBaseline: number,
  billingErrors: BillingError[],
  siteOfService: SiteOfServiceComparison[],
  balanceBilling: BalanceBillingAlert[],
): SavingsSummary {
  // ── Uninsured savings ───────────────────────────────────────────────────────
  // Negotiation target: Medicare + 20% is a common benchmark for cash-pay patients
  const negotiationTarget = cmsBaseline > 0 ? +(cmsBaseline * 1.2).toFixed(2) : 0;
  const uninsuredPotentialSavings = cmsBaseline > 0
    ? +(totalBilled - negotiationTarget).toFixed(2)
    : 0;

  const uninsuredStrategy = cmsBaseline > 0
    ? `Your bill totals $${totalBilled.toFixed(2)}. The Medicare baseline for these services is ` +
      `$${cmsBaseline.toFixed(2)}. A reasonable negotiation target for cash-pay patients is ` +
      `$${negotiationTarget.toFixed(2)} (120% of Medicare). Call the billing department and reference ` +
      `Medicare rates as your benchmark. Ask about cash-pay discounts, payment plans, and financial ` +
      `hardship programs.`
    : 'Unable to calculate savings — CMS rate data was not available for the services on this bill.';

  // ── Billing error savings ───────────────────────────────────────────────────
  const billingErrorSavings = billingErrors.reduce(
    (sum, err) => sum + (err.potentialSavings ?? 0),
    0,
  );

  // ── Site-of-service savings ─────────────────────────────────────────────────
  const siteOfServiceSavings = siteOfService
    .filter(s => s.isShoppable && s.potentialSavings !== null && s.potentialSavings > 0)
    .reduce((sum, s) => sum + (s.potentialSavings ?? 0), 0);

  // ── Balance billing savings ─────────────────────────────────────────────────
  const balanceBillingSavings = balanceBilling
    .filter(a => a.type === 'balance_billing' || a.type === 'surprise_bill')
    .reduce((sum, a) => sum + a.excessAmount, 0);

  // ── Insured strategies ──────────────────────────────────────────────────────
  const strategies: string[] = [];

  if (billingErrorSavings > 0) {
    const errorTypes = [...new Set(billingErrors.filter(e => e.potentialSavings && e.potentialSavings > 0).map(e => e.type))];
    strategies.push(
      `Address billing errors (${errorTypes.join(', ')}): potential savings of $${billingErrorSavings.toFixed(2)}. ` +
      `Contact the billing department with specific CPT codes and request corrections.`,
    );
  }

  if (siteOfServiceSavings > 0) {
    const shoppableCount = siteOfService.filter(s => s.isShoppable && s.potentialSavings && s.potentialSavings > 0).length;
    strategies.push(
      `For future visits, consider office/outpatient settings for ${shoppableCount} shoppable service(s): ` +
      `potential savings of $${siteOfServiceSavings.toFixed(2)} per visit by choosing physician office over hospital.`,
    );
  }

  if (balanceBillingSavings > 0) {
    strategies.push(
      `Challenge potential balance billing: $${balanceBillingSavings.toFixed(2)} in excess charges ` +
      `detected. Compare your bill to your EOB and dispute any amount over your stated patient responsibility.`,
    );
  }

  const excessiveMarkups = balanceBilling.filter(a => a.type === 'excessive_markup');
  if (excessiveMarkups.length > 0) {
    const totalExcess = excessiveMarkups.reduce((sum, a) => sum + a.excessAmount, 0);
    strategies.push(
      `Negotiate ${excessiveMarkups.length} service(s) with excessive markup (>${4}x Medicare): ` +
      `$${totalExcess.toFixed(2)} over Medicare rates. Use Medicare rates as your negotiation baseline.`,
    );
  }

  if (strategies.length === 0) {
    strategies.push('No specific billing issues detected. Your bill appears consistent with standard billing practices.');
  }

  const totalActionableSavings = +(billingErrorSavings + siteOfServiceSavings + balanceBillingSavings).toFixed(2);

  // ── Universal tips ──────────────────────────────────────────────────────────
  const universalTips: string[] = [
    'Always request an itemized bill — hospitals are required to provide one under federal law.',
    'Compare your bill line-by-line against your EOB (Explanation of Benefits) from your insurer.',
    'Ask about prompt-pay discounts — many providers offer 10-30% off for paying within 30 days.',
    'Request a financial hardship application — nonprofit hospitals are required to have financial assistance policies under IRS Section 501(r).',
    'Never pay a medical bill from collections without first verifying it with the original provider.',
    'You have the right to dispute any charge within 30 days of receiving the bill.',
  ];

  // Add contextual tips based on findings
  if (billingErrors.some(e => e.type === 'upcoding')) {
    universalTips.push(
      'For upcoding concerns: request your medical records to verify the level of service documented matches what was billed.',
    );
  }

  if (siteOfService.some(s => s.isShoppable)) {
    universalTips.push(
      'For future shoppable services (labs, imaging, minor procedures), ask your doctor for a referral to a lower-cost setting.',
    );
  }

  if (totalBilled > 0 && cmsBaseline > 0 && totalBilled / cmsBaseline > 3) {
    universalTips.push(
      `Your total bill is ${(totalBilled / cmsBaseline).toFixed(1)}x the Medicare baseline. ` +
      `Consider consulting a medical billing advocate (typically costs 25-35% of savings recovered).`,
    );
  }

  return {
    totalBilled,
    cmsBaseline,
    uninsuredSavings: {
      negotiationTarget,
      potentialSavings: Math.max(0, uninsuredPotentialSavings),
      strategy: uninsuredStrategy,
    },
    insuredSavings: {
      billingErrorSavings: +billingErrorSavings.toFixed(2),
      siteOfServiceSavings: +siteOfServiceSavings.toFixed(2),
      balanceBillingSavings: +balanceBillingSavings.toFixed(2),
      totalActionableSavings,
      strategies,
    },
    universalTips,
  };
}
