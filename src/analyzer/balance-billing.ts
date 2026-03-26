/**
 * Balance Billing Detector
 *
 * When EOB data is available, compares what insurance said the patient should owe
 * vs what the provider is actually billing. If the provider bills more than the
 * insurance-allowed patient responsibility, that may be illegal balance billing.
 *
 * References:
 *   - No Surprises Act (Public Law 117-169, effective January 1, 2022)
 *   - Applies to emergency services, air ambulance from out-of-network providers,
 *     and non-emergency services from out-of-network providers at in-network facilities
 *
 * NEVER fabricates rates — all comparisons use real data from the bill, EOB, and CMS database.
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface BalanceBillingAlert {
  type: 'balance_billing' | 'surprise_bill' | 'excessive_markup';
  severity: 'info' | 'warning' | 'alert';
  cptCode: string;
  description: string;
  insuranceAllowed: number;
  providerBilled: number;
  patientResponsibility: number | null;
  excessAmount: number;
  legalBasis: string;
  actionStep: string;
}

export interface BalanceBillingFinding {
  cptCode: string;
  description: string;
  billedAmount: number;
  cmsRateUsed: number | null;
}

export interface EOBData {
  summary?: {
    amountBilled: number | null;
    patientResponsibility: number | null;
    planPaid: number | null;
    networkDiscount: number | null;
  };
  lineItems?: Array<{
    cptCode: string | null;
    billedAmount: number;
    allowedAmount: number | null;
    patientOwes: number | null;
  }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Markup threshold: if billed > 4x Medicare, flag as excessive */
const EXCESSIVE_MARKUP_MULTIPLIER = 4.0;

const NO_SURPRISES_ACT_CITATION =
  'No Surprises Act (Public Law 117-169, effective January 1, 2022). ' +
  'This federal law prohibits most surprise bills for emergency services, ' +
  'air ambulance services from out-of-network providers, and certain non-emergency ' +
  'services at in-network facilities by out-of-network providers.';

const BALANCE_BILLING_LEGAL_BASIS =
  'Under the No Surprises Act (2022), in-network providers cannot bill patients more than ' +
  'the in-network cost-sharing amount determined by the health plan. ' +
  'Many states also have additional balance billing protections. ' +
  'See: cms.gov/nosurprises';

const SURPRISE_BILL_LEGAL_BASIS =
  'The No Surprises Act (2022) protects patients from surprise medical bills when they receive: ' +
  '(1) emergency services, (2) non-emergency services at in-network facilities from out-of-network providers, ' +
  'or (3) air ambulance services. Patients should only pay in-network cost-sharing amounts. ' +
  'File a complaint at cms.gov/nosurprises or call 1-800-985-3059.';

const EXCESSIVE_MARKUP_LEGAL_BASIS =
  'While no federal law caps provider charges, charges exceeding 400% of Medicare rates ' +
  'are considered outliers per RAND Hospital Pricing Study (2020). ' +
  'Many states have price gouging and unconscionable pricing protections. ' +
  'The No Surprises Act provides an independent dispute resolution (IDR) process ' +
  'for out-of-network billing disputes.';

// ─── Main detection function ──────────────────────────────────────────────────

export async function detectBalanceBilling(
  findings: BalanceBillingFinding[],
  eobData?: EOBData,
): Promise<BalanceBillingAlert[]> {
  const alerts: BalanceBillingAlert[] = [];

  // ── 1. Line-item balance billing detection (requires EOB line items) ────────
  if (eobData?.lineItems && eobData.lineItems.length > 0) {
    for (const eobLine of eobData.lineItems) {
      if (!eobLine.cptCode) continue;

      // Find matching finding
      const finding = findings.find(f => f.cptCode === eobLine.cptCode);
      if (!finding) continue;

      // Check: provider bills more than what patient should owe per EOB
      if (eobLine.patientOwes !== null && eobLine.patientOwes >= 0) {
        const providerBilled = finding.billedAmount;
        const patientShouldOwe = eobLine.patientOwes;
        const allowedAmount = eobLine.allowedAmount ?? providerBilled;

        if (providerBilled > patientShouldOwe && patientShouldOwe < allowedAmount) {
          // The patient is being asked to pay the full billed amount but should only owe patientOwes
          const excess = +(providerBilled - patientShouldOwe).toFixed(2);

          // Only flag if there's material excess (> $1)
          if (excess > 1) {
            alerts.push({
              type: 'balance_billing',
              severity: 'alert',
              cptCode: finding.cptCode,
              description:
                `Your EOB shows you should owe $${patientShouldOwe.toFixed(2)} for ${finding.description} (${finding.cptCode}), ` +
                `but the provider billed $${providerBilled.toFixed(2)}. ` +
                `The excess of $${excess.toFixed(2)} may be illegal balance billing.`,
              insuranceAllowed: allowedAmount,
              providerBilled,
              patientResponsibility: patientShouldOwe,
              excessAmount: excess,
              legalBasis: BALANCE_BILLING_LEGAL_BASIS,
              actionStep:
                `Step 1: Call the provider's billing department at the number on your bill and say: ` +
                `"My EOB from [insurer] shows my responsibility is $${patientShouldOwe.toFixed(2)} for CPT ${finding.cptCode}, ` +
                `but you billed me $${providerBilled.toFixed(2)}. Please adjust my bill to match the EOB." ` +
                `Step 2: If they refuse, file a complaint with your state insurance commissioner. ` +
                `Step 3: File a No Surprises Act complaint at cms.gov/nosurprises or call 1-800-985-3059.`,
            });
          }
        }
      }

      // Check: allowed amount significantly less than billed (in-network discount missing)
      if (eobLine.allowedAmount !== null && eobLine.allowedAmount > 0) {
        const excess = +(finding.billedAmount - eobLine.allowedAmount).toFixed(2);
        if (excess > 0 && eobLine.patientOwes !== null && eobLine.patientOwes > eobLine.allowedAmount) {
          // Patient being asked to pay more than allowed amount
          const overAllowed = +(eobLine.patientOwes - eobLine.allowedAmount).toFixed(2);
          if (overAllowed > 1) {
            alerts.push({
              type: 'balance_billing',
              severity: 'alert',
              cptCode: finding.cptCode,
              description:
                `Insurance allowed $${eobLine.allowedAmount.toFixed(2)} for ${finding.description} (${finding.cptCode}), ` +
                `but your patient responsibility shows $${eobLine.patientOwes.toFixed(2)} — ` +
                `$${overAllowed.toFixed(2)} over the allowed amount.`,
              insuranceAllowed: eobLine.allowedAmount,
              providerBilled: finding.billedAmount,
              patientResponsibility: eobLine.patientOwes,
              excessAmount: overAllowed,
              legalBasis: BALANCE_BILLING_LEGAL_BASIS,
              actionStep:
                `Contact your insurance company to verify the correct patient responsibility. ` +
                `If the provider is in-network, they cannot bill you above the allowed amount. ` +
                `File a complaint if the provider refuses to adjust.`,
            });
          }
        }
      }
    }
  }

  // ── 2. Summary-level balance billing detection ──────────────────────────────
  if (eobData?.summary) {
    const { amountBilled, patientResponsibility, planPaid, networkDiscount } = eobData.summary;

    // Check: no network discount → possible out-of-network surprise bill
    if (networkDiscount === null || networkDiscount === 0) {
      if (amountBilled !== null && amountBilled > 0 && patientResponsibility !== null) {
        // If there's no network discount and patient owes a lot, this might be OON
        const patientPct = patientResponsibility / amountBilled;
        if (patientPct > 0.5) {
          // Patient paying more than 50% of billed — possible OON/surprise bill
          alerts.push({
            type: 'surprise_bill',
            severity: 'warning',
            cptCode: 'ALL',
            description:
              `No network discount appears on your EOB, and your patient responsibility ` +
              `($${patientResponsibility.toFixed(2)}) is ${(patientPct * 100).toFixed(0)}% of the total billed ` +
              `amount ($${amountBilled.toFixed(2)}). This may indicate out-of-network billing. ` +
              `Under the No Surprises Act, you may be protected from surprise bills even for OON providers.`,
            insuranceAllowed: amountBilled,
            providerBilled: amountBilled,
            patientResponsibility,
            excessAmount: +(patientResponsibility - (amountBilled * 0.2)).toFixed(2), // estimate excess over typical 20% coinsurance
            legalBasis: SURPRISE_BILL_LEGAL_BASIS,
            actionStep:
              `Step 1: Call your insurance company and ask: "Was this provider in-network for my plan?" ` +
              `Step 2: If out-of-network, ask: "Does the No Surprises Act apply to this service?" ` +
              `Step 3: If applicable, request the provider bill at in-network rates. ` +
              `Step 4: File a complaint at cms.gov/nosurprises if the provider refuses.`,
          });
        }
      }
    }

    // Check: patient responsibility exceeds what it should be based on plan paid + discount
    if (amountBilled !== null && patientResponsibility !== null && planPaid !== null) {
      const expectedPatientResp = +(amountBilled - planPaid - (networkDiscount ?? 0)).toFixed(2);
      const excess = +(patientResponsibility - expectedPatientResp).toFixed(2);

      if (excess > 1 && expectedPatientResp >= 0) {
        alerts.push({
          type: 'balance_billing',
          severity: 'alert',
          cptCode: 'ALL',
          description:
            `Based on your EOB: billed $${amountBilled.toFixed(2)}, plan paid $${planPaid.toFixed(2)}` +
            `${networkDiscount ? `, network discount $${networkDiscount.toFixed(2)}` : ''}. ` +
            `Your calculated responsibility should be $${expectedPatientResp.toFixed(2)}, ` +
            `but the EOB shows $${patientResponsibility.toFixed(2)} — an excess of $${excess.toFixed(2)}.`,
          insuranceAllowed: amountBilled - (networkDiscount ?? 0),
          providerBilled: amountBilled,
          patientResponsibility,
          excessAmount: excess,
          legalBasis: BALANCE_BILLING_LEGAL_BASIS,
          actionStep:
            `Contact your insurance company to reconcile the math on your EOB. ` +
            `Ask them to explain the difference between the expected patient responsibility ` +
            `($${expectedPatientResp.toFixed(2)}) and what's shown ($${patientResponsibility.toFixed(2)}).`,
        });
      }
    }
  }

  // ── 3. Excessive markup detection (uses CMS rates, no EOB required) ─────────
  for (const finding of findings) {
    if (finding.cmsRateUsed === null || finding.cmsRateUsed <= 0) continue;

    const multiplier = finding.billedAmount / finding.cmsRateUsed;

    if (multiplier >= EXCESSIVE_MARKUP_MULTIPLIER) {
      const excess = +(finding.billedAmount - finding.cmsRateUsed).toFixed(2);
      const negotiationTarget = +(finding.cmsRateUsed * 1.2).toFixed(2); // Medicare + 20%

      alerts.push({
        type: 'excessive_markup',
        severity: multiplier >= 10 ? 'alert' : 'warning',
        cptCode: finding.cptCode,
        description:
          `${finding.description} (${finding.cptCode}) is billed at $${finding.billedAmount.toFixed(2)}, ` +
          `which is ${multiplier.toFixed(1)}x the Medicare rate of $${finding.cmsRateUsed.toFixed(2)}. ` +
          `Charges over ${EXCESSIVE_MARKUP_MULTIPLIER}x Medicare are considered outliers by the RAND Hospital Pricing Study. ` +
          `A reasonable negotiation target is $${negotiationTarget.toFixed(2)} (Medicare + 20%).`,
        insuranceAllowed: finding.cmsRateUsed,
        providerBilled: finding.billedAmount,
        patientResponsibility: null,
        excessAmount: excess,
        legalBasis: EXCESSIVE_MARKUP_LEGAL_BASIS,
        actionStep:
          `Step 1: Contact the billing department and say: "The charge for ${finding.cptCode} is ` +
          `${multiplier.toFixed(1)}x the Medicare rate. I'd like to negotiate a rate closer to ` +
          `$${negotiationTarget.toFixed(2)} (120% of Medicare)." ` +
          `Step 2: Ask about financial hardship programs or prompt-pay discounts. ` +
          `Step 3: If uninsured, mention that Medicare + 20% is a common benchmark for cash-pay patients. ` +
          `Step 4: If insured and out-of-network, consider the No Surprises Act IDR process.`,
      });
    }
  }

  return alerts;
}
