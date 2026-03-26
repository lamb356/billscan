/**
 * Insurance Appeal Evidence Generator
 *
 * Generates structured evidence packets that patients can use to appeal
 * insurance denials or dispute bills with insurers.  This is different from
 * the provider-facing dispute letter in letter-generator.ts — this targets
 * insurance companies and leverages federal/state consumer protections.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface AppealEvidence {
  type: 'denial_appeal' | 'billing_dispute' | 'balance_billing_complaint';
  title: string;
  summary: string;
  keyFacts: Array<{
    label: string;
    value: string;
    source: string; // e.g. "CMS PFS 2026", "No Surprises Act §2799A-1"
  }>;
  cmsComparison: {
    cptCode: string;
    description: string;
    providerCharged: number;
    medicareRate: number;
    markup: number; // multiplier
  }[];
  legalReferences: Array<{
    law: string;
    section: string;
    relevance: string;
    url: string;
  }>;
  recommendedActions: string[];
  /** Pre-formatted text the patient can copy/paste or email */
  appealLetterDraft: string;
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface AuditFindingInput {
  cptCode: string;
  description: string;
  billedAmount: number;
  cmsRateUsed: number | null;
  cmsFacilityRate: number | null;
  cmsNonFacilityRate: number | null;
  overchargeMultiplier: number | null;
  matchMode: string;
  rateSource: string;
  sourceUrl: string;
  sourceEffectiveYear: number;
}

export interface EOBData {
  insurerName?: string | null;
  claimNumber?: string | null;
  summary?: {
    amountBilled: number | null;
    patientResponsibility: number | null;
    planPaid: number | null;
  };
}

export interface PatientContext {
  isUninsured?: boolean;
  facilityName?: string;
  zip?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LEGAL_REFS = {
  noSurprises: {
    law: 'No Surprises Act (Public Law 116-260, Division BB)',
    section: '§2799A-1 / §2799B-1',
    relevance:
      'Prohibits surprise balance billing by out-of-network providers at in-network facilities and for emergency services. Patients may only be held responsible for in-network cost-sharing amounts.',
    url: 'https://www.congress.gov/bill/116th-congress/house-bill/133',
  },
  priceTransparency: {
    law: 'Hospital Price Transparency Rule (45 CFR §180)',
    section: 'CMS-1717-F2 (updated 2026)',
    relevance:
      'Requires hospitals to publish machine-readable files with standard charges (gross, discounted cash, payer-specific negotiated, and de-identified minimum/maximum). Patients can compare published rates against billed amounts.',
    url: 'https://www.cms.gov/hospital-price-transparency',
  },
  acaMlr: {
    law: 'Affordable Care Act — Medical Loss Ratio (42 U.S.C. §300gg-18)',
    section: 'ACA §2718',
    relevance:
      'Requires insurers to spend at least 80-85% of premiums on medical claims. Excessive provider markups inflate premiums and undermine the MLR mandate, giving insurers reason to negotiate rates downward.',
    url: 'https://www.law.cornell.edu/uscode/text/42/300gg-18',
  },
  goodFaithEstimate: {
    law: 'Good Faith Estimate Requirements (42 U.S.C. §300gg-111)',
    section: 'No Surprises Act §112',
    relevance:
      'Uninsured or self-pay patients can request a Good Faith Estimate before scheduled services. If the final bill exceeds the estimate by $400 or more, the patient may initiate the patient-provider dispute resolution process.',
    url: 'https://www.cms.gov/nosurprises/consumers/understanding-costs-in-advance',
  },
  stateProtections: {
    law: 'State Balance Billing / Consumer Protection Laws',
    section: 'Varies by state',
    relevance:
      'Many states have enacted additional balance billing protections, rate caps, and independent dispute resolution processes that may provide stronger rights than federal law. Consult your state insurance commissioner.',
    url: 'https://www.commonwealthfund.org/publications/maps-and-interactives/2021/feb/state-balance-billing-protections',
  },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMult(n: number): string {
  return n.toFixed(1) + '×';
}

function currentDateStr(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Pick the best CMS rate from the finding inputs. */
function effectiveRate(f: AuditFindingInput): number | null {
  return f.cmsRateUsed ?? f.cmsNonFacilityRate ?? f.cmsFacilityRate;
}

/** Determine the appeal type based on available data. */
function determineAppealType(
  findings: AuditFindingInput[],
  eob?: EOBData,
  ctx?: PatientContext,
): AppealEvidence['type'] {
  // If uninsured → billing dispute (against provider, but using appeal evidence format)
  if (ctx?.isUninsured) return 'billing_dispute';

  // If we have EOB data and patient responsibility is high relative to plan-paid,
  // or if there's a large gap between billed and plan-paid, suspect balance billing
  if (eob?.summary) {
    const { amountBilled, patientResponsibility, planPaid } = eob.summary;
    if (
      amountBilled != null &&
      patientResponsibility != null &&
      planPaid != null &&
      patientResponsibility > planPaid * 0.5
    ) {
      return 'balance_billing_complaint';
    }
  }

  return 'denial_appeal';
}

function buildKeyFacts(
  findings: AuditFindingInput[],
  matched: AuditFindingInput[],
  eob?: EOBData,
  ctx?: PatientContext,
): AppealEvidence['keyFacts'] {
  const facts: AppealEvidence['keyFacts'] = [];
  const totalBilled = findings.reduce((s, f) => s + f.billedAmount, 0);
  const totalCms = matched.reduce((s, f) => s + (effectiveRate(f) ?? 0), 0);
  const year = matched[0]?.sourceEffectiveYear ?? new Date().getFullYear();

  facts.push({
    label: 'Total Amount Billed',
    value: fmt$(totalBilled),
    source: 'Patient bill / EOB',
  });

  facts.push({
    label: 'CMS Medicare Baseline',
    value: fmt$(totalCms),
    source: `CMS Fee Schedules ${year}`,
  });

  if (totalCms > 0) {
    const overallMarkup = totalBilled / totalCms;
    facts.push({
      label: 'Overall Markup vs. Medicare',
      value: fmtMult(overallMarkup),
      source: `CMS Fee Schedules ${year}`,
    });
  }

  facts.push({
    label: 'Line Items Matched to CMS',
    value: `${matched.length} of ${findings.length}`,
    source: `CMS PFS / CLFS / ASP / OPPS ${year}`,
  });

  if (eob?.summary?.patientResponsibility != null) {
    facts.push({
      label: 'Patient Responsibility (per EOB)',
      value: fmt$(eob.summary.patientResponsibility),
      source: eob.insurerName ?? 'Insurer EOB',
    });
  }

  if (eob?.summary?.planPaid != null) {
    facts.push({
      label: 'Plan Paid',
      value: fmt$(eob.summary.planPaid),
      source: eob.insurerName ?? 'Insurer EOB',
    });
  }

  return facts;
}

function buildCmsComparison(matched: AuditFindingInput[]): AppealEvidence['cmsComparison'] {
  return matched
    .filter((f) => effectiveRate(f) != null && effectiveRate(f)! > 0)
    .sort((a, b) => (b.overchargeMultiplier ?? 0) - (a.overchargeMultiplier ?? 0))
    .slice(0, 10)
    .map((f) => {
      const rate = effectiveRate(f)!;
      return {
        cptCode: f.cptCode,
        description: f.description,
        providerCharged: f.billedAmount,
        medicareRate: rate,
        markup: f.overchargeMultiplier ?? (rate > 0 ? f.billedAmount / rate : 0),
      };
    });
}

function buildLegalRefs(
  type: AppealEvidence['type'],
  ctx?: PatientContext,
): AppealEvidence['legalReferences'] {
  const refs: AppealEvidence['legalReferences'] = [];

  // Always include price transparency and state protections
  refs.push(LEGAL_REFS.priceTransparency);

  if (type === 'balance_billing_complaint') {
    refs.unshift(LEGAL_REFS.noSurprises);
  }

  if (type === 'denial_appeal') {
    refs.push(LEGAL_REFS.noSurprises);
    refs.push(LEGAL_REFS.acaMlr);
  }

  if (type === 'billing_dispute' || ctx?.isUninsured) {
    refs.push(LEGAL_REFS.goodFaithEstimate);
  }

  refs.push(LEGAL_REFS.stateProtections);

  return refs;
}

function buildRecommendedActions(
  type: AppealEvidence['type'],
  ctx?: PatientContext,
): string[] {
  const actions: string[] = [];

  if (type === 'denial_appeal') {
    actions.push(
      'File an internal appeal with your insurer within 180 days of the denial notice.',
      'If the internal appeal is denied, request an External Review through your state insurance department or a federally-certified independent review organization (IRO).',
      'Include the CMS rate comparison table from this document as evidence that the billed charges exceed Medicare benchmarks.',
      'Request an itemized bill from the provider to verify every CPT code and charge.',
      'Contact your state insurance commissioner if you believe the denial violates the No Surprises Act.',
    );
  }

  if (type === 'balance_billing_complaint') {
    actions.push(
      'Verify whether the provider was in-network or out-of-network for the date of service.',
      'If out-of-network at an in-network facility (or for emergency services), file a complaint under the No Surprises Act — you should only owe in-network cost-sharing.',
      'Send the provider a written notice disputing the balance bill, citing the No Surprises Act §2799A-1.',
      'File a complaint with CMS at 1-800-985-3059 or via the No Surprises Help Desk.',
      'Contact your state attorney general or insurance commissioner for additional enforcement.',
    );
  }

  if (type === 'billing_dispute') {
    actions.push(
      'Request an itemized bill — providers are required to furnish one upon request.',
      'Compare each CPT code and charge against the CMS Medicare rate data in this document.',
      'Ask the provider for their charity care / financial assistance policy (non-profit hospitals are required to have one under IRS §501(r)).',
      'Negotiate using the Medicare rate as your benchmark — many providers accept Medicare + 20% from self-pay patients.',
      'Request a prompt-pay discount (typically 20-40% off) if you can pay within 30 days.',
      'If you received a Good Faith Estimate and the final bill exceeds it by $400+, initiate the patient-provider dispute resolution process through CMS.',
    );
  }

  // Universal actions
  actions.push(
    'Keep copies of all correspondence, bills, EOBs, and this appeal evidence document.',
    'Consider consulting a medical billing advocate or patient advocate for complex cases.',
  );

  return actions;
}

// ── Appeal letter draft ───────────────────────────────────────────────────────

function buildAppealLetterDraft(
  type: AppealEvidence['type'],
  comparison: AppealEvidence['cmsComparison'],
  findings: AuditFindingInput[],
  eob?: EOBData,
  ctx?: PatientContext,
): string {
  const date = currentDateStr();
  const facility = ctx?.facilityName ?? '[Healthcare Provider Name]';
  const insurer = eob?.insurerName ?? '[Insurance Company Name]';
  const claimNum = eob?.claimNumber ?? '[Claim Number]';
  const totalBilled = findings.reduce((s, f) => s + f.billedAmount, 0);
  const totalCms = comparison.reduce((s, c) => s + c.medicareRate, 0);
  const totalCharged = comparison.reduce((s, c) => s + c.providerCharged, 0);
  const year = findings[0]?.sourceEffectiveYear ?? new Date().getFullYear();
  const sourceUrl = findings[0]?.sourceUrl ?? 'https://www.cms.gov/medicare/physician-fee-schedule/search';

  const comparisonTable = comparison
    .map(
      (c) =>
        `  CPT ${c.cptCode} — ${c.description}\n` +
        `    Billed: ${fmt$(c.providerCharged)}  |  Medicare Rate: ${fmt$(c.medicareRate)}  |  Markup: ${fmtMult(c.markup)}`,
    )
    .join('\n\n');

  if (type === 'denial_appeal') {
    return `${date}

[Your Full Name]
[Your Address]
[City, State ZIP]

${insurer}
Appeals Department
[Insurer Address]

Re: Appeal of Claim Denial
    Claim Number: ${claimNum}
    Patient: [Your Full Name]
    Date of Service: [Date of Service]
    Provider: ${facility}

Dear Appeals Review Board,

I am writing to formally appeal the denial of the above-referenced claim. I believe the denial is not supported by the evidence and respectfully request that the claim be reprocessed for payment.

SUMMARY OF DISPUTE

The provider billed a total of ${fmt$(totalBilled)} for services rendered. Based on my analysis using official CMS Medicare fee schedule data for ${year}, the Medicare-allowable rates for the matched services total approximately ${fmt$(totalCms)}. This means the billed charges reflect a significant markup over the government's own benchmark for reasonable cost.

CMS RATE COMPARISON (${year} Medicare Fee Schedules)

${comparisonTable}

Source: CMS.gov — ${sourceUrl}

LEGAL BASIS

Under the No Surprises Act (Public Law 116-260, §2799A-1), patients are protected from surprise balance billing for emergency services and out-of-network care at in-network facilities. The Hospital Price Transparency Rule (45 CFR §180) requires hospitals to publish their standard charges, enabling meaningful cost comparisons.

The ACA §2718 Medical Loss Ratio requirements further support the principle that charges should reflect reasonable costs rather than excessive markups.

REQUEST

I respectfully request that you:
1. Reverse the denial and reprocess this claim for payment.
2. Ensure my cost-sharing responsibility is calculated based on a reasonable rate, not the inflated billed charges.
3. If the provider is out-of-network, apply the qualifying payment amount or Medicare benchmark rate as required under the No Surprises Act.

I have enclosed/attached the full CMS rate comparison analysis for your review. I reserve the right to pursue an external review through a federally-certified independent review organization if this internal appeal is not resolved favorably within 30 days.

Sincerely,

[Your Full Name]
[Your Phone Number]
[Your Email]

Enclosures:
- CMS Rate Comparison Analysis
- Copy of Explanation of Benefits
- Copy of Itemized Bill
`;
  }

  if (type === 'balance_billing_complaint') {
    return `${date}

[Your Full Name]
[Your Address]
[City, State ZIP]

${facility}
Billing Department
[Provider Address]

CC: ${insurer}
CC: [State Insurance Commissioner]

Re: Dispute of Balance Bill — Potential No Surprises Act Violation
    Claim Number: ${claimNum}
    Patient: [Your Full Name]
    Date of Service: [Date of Service]

Dear Billing Department,

I am writing to dispute a balance bill I received for the above-referenced services. I believe this balance bill may violate the No Surprises Act (Public Law 116-260) and request that it be withdrawn or corrected.

SUMMARY

My Explanation of Benefits from ${insurer} indicates the following:
  Amount Billed:           ${eob?.summary?.amountBilled != null ? fmt$(eob.summary.amountBilled) : '[See EOB]'}
  Plan Paid:               ${eob?.summary?.planPaid != null ? fmt$(eob.summary.planPaid) : '[See EOB]'}
  Patient Responsibility:  ${eob?.summary?.patientResponsibility != null ? fmt$(eob.summary.patientResponsibility) : '[See EOB]'}

Under the No Surprises Act §2799A-1, if I received emergency services or was treated by an out-of-network provider at an in-network facility, I can only be held responsible for my in-network cost-sharing amount. Any balance beyond that is a matter between the provider and my insurer.

CMS RATE COMPARISON (${year} Medicare Fee Schedules)

The following comparison demonstrates that the billed charges significantly exceed Medicare benchmark rates:

${comparisonTable}

Source: CMS.gov — ${sourceUrl}

REQUEST

1. Withdraw the balance bill that exceeds my EOB-stated patient responsibility.
2. If you believe the balance is valid, provide written justification including your network status for the date of service and the legal basis for the balance bill.
3. Do not send this amount to collections while this dispute is pending.

If this matter is not resolved within 30 days, I will file a formal complaint with CMS (No Surprises Help Desk: 1-800-985-3059) and my state insurance commissioner.

Sincerely,

[Your Full Name]
[Your Phone Number]
[Your Email]

Enclosures:
- Explanation of Benefits
- CMS Rate Comparison Analysis
- Copy of Balance Bill
`;
  }

  // billing_dispute — self-pay / uninsured
  return `${date}

[Your Full Name]
[Your Address]
[City, State ZIP]

${facility}
Billing Department
[Provider Address]

Re: Request for Bill Reduction — Self-Pay / Uninsured Patient
    Account Number: [Account Number]
    Patient: [Your Full Name]
    Date of Service: [Date of Service]

Dear Billing Department,

I am writing to request a reduction of my bill for services rendered on the above date. As a self-pay patient, I have compared the billed charges against the official CMS Medicare fee schedule rates for ${year} and found that the charges significantly exceed the government benchmark for these services.

CMS RATE COMPARISON (${year} Medicare Fee Schedules)

${comparisonTable}

Total Billed for Matched Services:  ${fmt$(totalCharged)}
Total Medicare Baseline:            ${fmt$(totalCms)}
Overall Markup:                     ${totalCms > 0 ? fmtMult(totalCharged / totalCms) : 'N/A'}

Source: CMS.gov — ${sourceUrl}

LEGAL CONTEXT

Under the Hospital Price Transparency Rule (45 CFR §180), hospitals are required to publish their standard charges including discounted cash prices. Under the No Surprises Act §112, uninsured and self-pay patients are entitled to a Good Faith Estimate of expected charges before scheduled services. If the actual bill exceeds the Good Faith Estimate by $400 or more, patients may initiate the patient-provider dispute resolution process.

REQUEST

I respectfully request that you:
1. Reduce the charges to a rate consistent with Medicare reimbursement levels (Medicare + 20% is a common benchmark for self-pay patients).
2. Apply any available prompt-pay or self-pay discount.
3. Provide information about your financial assistance / charity care program as required under IRS §501(r) for non-profit hospitals.
4. If a Good Faith Estimate was provided, confirm that this bill does not exceed it by more than $400.

Based on the Medicare rates, a fair price for these services would be approximately ${fmt$(totalCms * 1.2)} (Medicare + 20%). I am prepared to pay this amount promptly upon agreement.

Please respond within 30 days. I ask that you do not refer this account to collections while this request is under review.

Sincerely,

[Your Full Name]
[Your Phone Number]
[Your Email]

Enclosures:
- CMS Rate Comparison Analysis
- Copy of Itemized Bill
`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateAppealEvidence(
  auditFindings: AuditFindingInput[],
  eobData?: EOBData,
  patientContext?: PatientContext,
): AppealEvidence {
  // Filter to only matched findings with a CMS rate
  const matched = auditFindings.filter(
    (f) => f.matchMode !== 'unmatched' && effectiveRate(f) != null && effectiveRate(f)! > 0,
  );

  const type = determineAppealType(auditFindings, eobData, patientContext);

  const titleMap: Record<AppealEvidence['type'], string> = {
    denial_appeal: 'Insurance Claim Denial — Appeal Evidence Packet',
    billing_dispute: 'Medical Bill Dispute — CMS Rate Comparison Evidence',
    balance_billing_complaint: 'Balance Billing Complaint — Evidence & Legal Basis',
  };

  const totalBilled = auditFindings.reduce((s, f) => s + f.billedAmount, 0);
  const totalCms = matched.reduce((s, f) => s + (effectiveRate(f) ?? 0), 0);
  const overallMarkup = totalCms > 0 ? totalBilled / totalCms : null;
  const year = matched[0]?.sourceEffectiveYear ?? new Date().getFullYear();

  const summaryMap: Record<AppealEvidence['type'], string> = {
    denial_appeal: `This evidence packet supports an appeal of an insurance claim denial. Analysis of ${matched.length} matched line items shows the provider billed ${fmt$(totalBilled)} for services whose CMS Medicare baseline is ${fmt$(totalCms)}${overallMarkup ? ` (${fmtMult(overallMarkup)} markup)` : ''}. The billed charges exceed Medicare benchmarks based on the ${year} CMS fee schedules, supporting the case for claim reprocessing.`,
    billing_dispute: `This evidence packet supports a dispute of medical charges. Analysis of ${matched.length} matched line items shows the provider billed ${fmt$(totalBilled)} for services whose CMS Medicare baseline is ${fmt$(totalCms)}${overallMarkup ? ` (${fmtMult(overallMarkup)} markup)` : ''}. Self-pay patients can use this data to negotiate charges closer to Medicare rates.`,
    balance_billing_complaint: `This evidence packet documents a potential balance billing violation. The provider billed ${fmt$(totalBilled)} for services whose CMS Medicare baseline is ${fmt$(totalCms)}${overallMarkup ? ` (${fmtMult(overallMarkup)} markup)` : ''}. ${eobData?.summary?.patientResponsibility != null ? `The EOB indicates patient responsibility of ${fmt$(eobData.summary.patientResponsibility)}.` : ''} Under the No Surprises Act, balance billing beyond in-network cost-sharing may be prohibited.`,
  };

  const cmsComparison = buildCmsComparison(matched);
  const legalReferences = buildLegalRefs(type, patientContext);
  const recommendedActions = buildRecommendedActions(type, patientContext);

  return {
    type,
    title: titleMap[type],
    summary: summaryMap[type],
    keyFacts: buildKeyFacts(auditFindings, matched, eobData, patientContext),
    cmsComparison,
    legalReferences,
    recommendedActions,
    appealLetterDraft: buildAppealLetterDraft(type, cmsComparison, auditFindings, eobData, patientContext),
  };
}
