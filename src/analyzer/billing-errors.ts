/**
 * Billing Error Detector
 *
 * Detects common billing errors that apply to BOTH insured and uninsured patients.
 * Analyzes parsed bill line items (after CPT matching) and flags:
 *   - Upcoding suspicion (highest-level E&M codes)
 *   - Unbundling suspicion (commonly-bundled codes billed separately)
 *   - Duplicate charges (same CPT code appearing multiple times)
 *   - Modifier issues (missing -59 or -25 modifiers)
 *
 * For upcoding checks, the ACTUAL lower-level CMS rate is looked up from the
 * database — rates are NEVER hardcoded or fabricated.
 */

import { getDb } from '../db/connection.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface BillingError {
  type: 'upcoding' | 'unbundling' | 'duplicate' | 'modifier';
  severity: 'info' | 'warning' | 'alert';
  cptCodes: string[];
  description: string;
  potentialSavings: number | null;
  actionStep: string;
}

export interface BillingErrorLineItem {
  cptCode: string;
  description: string;
  billedAmount: number;
  lineNumber: number;
  modifier?: string;
}

// ─── Coding rules (NOT fabricated rates — these are bundling/coding rules) ────

/** E&M codes at the highest level within their category that trigger upcoding review */
const HIGHEST_LEVEL_EM: Record<string, { lowerCode: string; category: string }> = {
  '99215': { lowerCode: '99214', category: 'Office visit, established patient' },
  '99223': { lowerCode: '99222', category: 'Initial hospital care' },
  '99233': { lowerCode: '99232', category: 'Subsequent hospital care' },
  '99285': { lowerCode: '99284', category: 'Emergency department visit' },
};

/** Commonly bundled CPT code pairs (coding rules, not rates) */
const BUNDLE_RULES: Array<{
  primary: string[];
  bundled: string[];
  reason: string;
}> = [
  {
    primary: ['80053', '85025'],
    bundled: ['36415'],
    reason: 'Blood draw (36415) is typically bundled with lab panels (80053 metabolic panel, 85025 CBC) and should not be billed separately',
  },
  {
    primary: ['80048', '80050', '80051', '80076'],
    bundled: ['36415'],
    reason: 'Blood draw (36415) is typically bundled with lab panels and should not be billed separately',
  },
];

/** E&M codes that should be bundled with same-day procedures */
const EM_CODES = [
  '99211', '99212', '99213', '99214', '99215',
  '99201', '99202', '99203', '99204', '99205',
];

/** Surgical CPT code range (10000-69999) */
function isSurgicalCode(code: string): boolean {
  const num = parseInt(code, 10);
  return !isNaN(num) && num >= 10000 && num <= 69999;
}

/** Wound repair / closure codes */
function isWoundRepairCode(code: string): boolean {
  const num = parseInt(code, 10);
  return !isNaN(num) && num >= 12001 && num <= 13160;
}

/** Imaging CPT code ranges */
function isImagingCode(code: string): boolean {
  const num = parseInt(code, 10);
  return !isNaN(num) && num >= 70000 && num <= 79999;
}

/** Extract body area keyword from description for imaging duplicate detection */
function extractBodyArea(description: string): string | null {
  const desc = description.toLowerCase();
  const areas = [
    'chest', 'abdomen', 'pelvis', 'spine', 'head', 'brain', 'knee',
    'shoulder', 'hip', 'ankle', 'wrist', 'elbow', 'neck', 'cervical',
    'thoracic', 'lumbar', 'sacral', 'hand', 'foot', 'forearm', 'thigh',
    'leg', 'arm', 'skull', 'facial', 'orbit', 'sinus',
  ];
  for (const area of areas) {
    if (desc.includes(area)) return area;
  }
  return null;
}

// ─── Database lookup helpers ──────────────────────────────────────────────────

/**
 * Look up CMS rate for a specific CPT code from the database.
 * NEVER fabricates rates — returns null if not found.
 */
async function lookupCmsRate(
  code: string,
  rateContext: 'facility' | 'non_facility',
  locality?: string,
): Promise<{ facilityRate: number | null; nonFacilityRate: number | null; rateUsed: number | null }> {
  const db = getDb();

  // Get the latest snapshot
  const snapshot = (await db.execute({
    sql: 'SELECT id FROM cms_snapshots ORDER BY effective_year DESC, fetched_at DESC LIMIT 1',
    args: [],
  })).rows[0] as { id: number } | undefined;

  if (!snapshot) {
    return { facilityRate: null, nonFacilityRate: null, rateUsed: null };
  }

  let sql = `SELECT facility_rate, non_facility_rate FROM cms_rates WHERE snapshot_id = ? AND cpt_code = ?`;
  const args: any[] = [snapshot.id, code];

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
  } | undefined;

  if (!row) {
    return { facilityRate: null, nonFacilityRate: null, rateUsed: null };
  }

  const rateUsed = rateContext === 'facility'
    ? (row.facility_rate ?? row.non_facility_rate)
    : (row.non_facility_rate ?? row.facility_rate);

  return {
    facilityRate: row.facility_rate,
    nonFacilityRate: row.non_facility_rate,
    rateUsed,
  };
}

// ─── Main detection function ──────────────────────────────────────────────────

export async function detectBillingErrors(
  lineItems: BillingErrorLineItem[],
  rateContext: 'facility' | 'non_facility',
  locality?: string,
): Promise<BillingError[]> {
  const errors: BillingError[] = [];

  // Collect all codes for cross-item analysis
  const codeSet = new Set(lineItems.map(li => li.cptCode));
  const codeList = lineItems.map(li => li.cptCode);

  // ── 1. Upcoding suspicion ───────────────────────────────────────────────────
  for (const item of lineItems) {
    const upcode = HIGHEST_LEVEL_EM[item.cptCode];
    if (!upcode) continue;

    // Look up the CMS rate for the lower-level code from the database
    const lowerRate = await lookupCmsRate(upcode.lowerCode, rateContext, locality);
    const currentRate = await lookupCmsRate(item.cptCode, rateContext, locality);

    let savings: number | null = null;
    let costNote = '';

    if (currentRate.rateUsed !== null && lowerRate.rateUsed !== null) {
      savings = +(currentRate.rateUsed - lowerRate.rateUsed).toFixed(2);
      costNote = ` The lower-level code ${upcode.lowerCode} has a CMS rate of $${lowerRate.rateUsed.toFixed(2)} (facility: $${lowerRate.facilityRate?.toFixed(2) ?? 'N/A'}, non-facility: $${lowerRate.nonFacilityRate?.toFixed(2) ?? 'N/A'}) vs $${currentRate.rateUsed.toFixed(2)} for ${item.cptCode} — a difference of $${savings.toFixed(2)}.`;
    } else if (lowerRate.rateUsed !== null) {
      costNote = ` The lower-level code ${upcode.lowerCode} has a CMS rate of $${lowerRate.rateUsed.toFixed(2)} (facility: $${lowerRate.facilityRate?.toFixed(2) ?? 'N/A'}, non-facility: $${lowerRate.nonFacilityRate?.toFixed(2) ?? 'N/A'}).`;
    }

    errors.push({
      type: 'upcoding',
      severity: 'warning',
      cptCodes: [item.cptCode],
      description:
        `${item.cptCode} (${upcode.category}) is the highest-level E&M code in its category. ` +
        `Higher-level codes require documentation of medical decision-making complexity, ` +
        `extended history, and comprehensive examination.${costNote}`,
      potentialSavings: savings,
      actionStep:
        `Request the medical records and review the documentation supporting the level of service billed. ` +
        `Ask the provider: "Can you provide the documentation that supports a level-${item.cptCode.slice(-1)} visit ` +
        `rather than a level-${upcode.lowerCode.slice(-1)}?" If documentation is insufficient, request a downcode to ${upcode.lowerCode}.`,
    });
  }

  // ── 2. Unbundling suspicion ─────────────────────────────────────────────────

  // 2a. Check hardcoded bundle rules (lab panels + blood draw, etc.)
  for (const rule of BUNDLE_RULES) {
    const hasPrimary = rule.primary.some(c => codeSet.has(c));
    const hasBundled = rule.bundled.some(c => codeSet.has(c));
    if (hasPrimary && hasBundled) {
      const matchedPrimary = rule.primary.filter(c => codeSet.has(c));
      const matchedBundled = rule.bundled.filter(c => codeSet.has(c));
      const allCodes = [...matchedPrimary, ...matchedBundled];

      // Calculate savings from the bundled code(s) that should not be separate
      let savings: number | null = null;
      for (const bundledCode of matchedBundled) {
        const item = lineItems.find(li => li.cptCode === bundledCode);
        if (item) {
          savings = (savings ?? 0) + item.billedAmount;
        }
      }

      errors.push({
        type: 'unbundling',
        severity: 'alert',
        cptCodes: allCodes,
        description:
          `Possible unbundling: ${rule.reason}. ` +
          `Codes ${allCodes.join(', ')} appear separately but are commonly billed together as a single service.`,
        potentialSavings: savings,
        actionStep:
          `Contact the billing department and ask: "Why was ${matchedBundled.join(', ')} billed separately from ` +
          `${matchedPrimary.join(', ')}? These are typically bundled." Request a corrected bill with bundled codes.`,
      });
    }
  }

  // 2b. Surgical codes with separate wound repair/closure
  const surgicalCodes = lineItems.filter(li => isSurgicalCode(li.cptCode) && !isWoundRepairCode(li.cptCode));
  const woundRepairCodes = lineItems.filter(li => isWoundRepairCode(li.cptCode));
  if (surgicalCodes.length > 0 && woundRepairCodes.length > 0) {
    const allCodes = [...surgicalCodes.map(s => s.cptCode), ...woundRepairCodes.map(w => w.cptCode)];
    const repairSavings = woundRepairCodes.reduce((sum, li) => sum + li.billedAmount, 0);

    errors.push({
      type: 'unbundling',
      severity: 'warning',
      cptCodes: allCodes,
      description:
        `Surgical procedure codes (${surgicalCodes.map(s => s.cptCode).join(', ')}) include wound closure as part of the ` +
        `global surgical package. Separate wound repair codes (${woundRepairCodes.map(w => w.cptCode).join(', ')}) ` +
        `may be unbundled charges unless the repair was for a different wound or site.`,
      potentialSavings: repairSavings > 0 ? +repairSavings.toFixed(2) : null,
      actionStep:
        `Ask the provider: "Was the wound repair for a separate incision/wound from the surgical procedure?" ` +
        `If not, request removal of the wound repair charge as it is included in the surgical global package.`,
    });
  }

  // 2c. E&M codes with same-day procedures
  const emItems = lineItems.filter(li => EM_CODES.includes(li.cptCode));
  const procedureItems = lineItems.filter(li => isSurgicalCode(li.cptCode));
  if (emItems.length > 0 && procedureItems.length > 0) {
    // Only flag if the E&M code does NOT have modifier -25
    const emWithoutMod25 = emItems.filter(li => li.modifier !== '25');
    if (emWithoutMod25.length > 0) {
      const allCodes = [...emWithoutMod25.map(e => e.cptCode), ...procedureItems.map(p => p.cptCode)];
      errors.push({
        type: 'unbundling',
        severity: 'warning',
        cptCodes: allCodes,
        description:
          `E&M code(s) (${emWithoutMod25.map(e => e.cptCode).join(', ')}) billed on the same day as procedure(s) ` +
          `(${procedureItems.map(p => p.cptCode).join(', ')}) without modifier -25. ` +
          `The evaluation may be included in the procedure's global package unless the E&M was for a ` +
          `separately identifiable service requiring modifier -25.`,
        potentialSavings: null,
        actionStep:
          `Ask the provider: "Was the E&M visit for a separately identifiable condition from the procedure?" ` +
          `If so, modifier -25 should be appended. If not, the E&M charge may be inappropriate.`,
      });
    }
  }

  // 2d. Multiple imaging codes for the same body area
  const imagingItems = lineItems.filter(li => isImagingCode(li.cptCode));
  if (imagingItems.length > 1) {
    const byArea = new Map<string, BillingErrorLineItem[]>();
    for (const item of imagingItems) {
      const area = extractBodyArea(item.description);
      if (area) {
        const existing = byArea.get(area) || [];
        existing.push(item);
        byArea.set(area, existing);
      }
    }
    for (const [area, items] of byArea) {
      if (items.length > 1) {
        const codes = items.map(i => i.cptCode);
        errors.push({
          type: 'unbundling',
          severity: 'info',
          cptCodes: codes,
          description:
            `Multiple imaging codes (${codes.join(', ')}) for the same body area (${area}). ` +
            `Some imaging studies include multiple views or components and should not be billed separately.`,
          potentialSavings: null,
          actionStep:
            `Ask the provider: "Were these imaging studies medically necessary as separate procedures, ` +
            `or should they be billed as components of a single study?" Review whether a comprehensive ` +
            `imaging code covers all views.`,
        });
      }
    }
  }

  // ── 3. Duplicate charges ────────────────────────────────────────────────────
  const codeCounts = new Map<string, BillingErrorLineItem[]>();
  for (const item of lineItems) {
    const existing = codeCounts.get(item.cptCode) || [];
    existing.push(item);
    codeCounts.set(item.cptCode, existing);
  }

  for (const [code, items] of codeCounts) {
    if (items.length <= 1) continue;

    const totalBilled = items.reduce((sum, i) => sum + i.billedAmount, 0);
    const singleBilled = items[0].billedAmount;
    const duplicateSavings = +(totalBilled - singleBilled).toFixed(2);

    errors.push({
      type: 'duplicate',
      severity: 'warning',
      cptCodes: [code],
      description:
        `CPT code ${code} ("${items[0].description}") appears ${items.length} times on this bill ` +
        `(lines ${items.map(i => i.lineNumber).join(', ')}), totaling $${totalBilled.toFixed(2)}. ` +
        `This may be a duplicate charge. Note: duplicate codes CAN be legitimate for bilateral procedures ` +
        `(modifier -50), multiple units, or distinct anatomical sites (modifier -59).`,
      potentialSavings: duplicateSavings > 0 ? duplicateSavings : null,
      actionStep:
        `Contact the billing department and ask: "Can you explain why ${code} was billed ${items.length} times? ` +
        `Was this for bilateral/multiple sites?" If it was a single service, request removal of the duplicate charge.`,
    });
  }

  // ── 4. Modifier issues ──────────────────────────────────────────────────────

  // 4a. Missing modifier -59 when bundled codes appear separately
  // If we detected unbundling above but the bundled code doesn't have -59, flag it
  for (const rule of BUNDLE_RULES) {
    const hasPrimary = rule.primary.some(c => codeSet.has(c));
    const hasBundled = rule.bundled.some(c => codeSet.has(c));
    if (hasPrimary && hasBundled) {
      const bundledItems = lineItems.filter(li => rule.bundled.includes(li.cptCode));
      for (const item of bundledItems) {
        if (item.modifier !== '59' && item.modifier !== 'XE' && item.modifier !== 'XS' &&
            item.modifier !== 'XP' && item.modifier !== 'XU') {
          errors.push({
            type: 'modifier',
            severity: 'info',
            cptCodes: [item.cptCode],
            description:
              `Code ${item.cptCode} is typically bundled with related codes on this bill but is billed ` +
              `without modifier -59 (Distinct Procedural Service) or an X{EPSU} modifier. ` +
              `If the service was truly distinct, modifier -59 should be present to justify separate billing.`,
            potentialSavings: null,
            actionStep:
              `Ask the provider: "If ${item.cptCode} was a distinct service, shouldn't it have modifier -59? ` +
              `If not distinct, it should be bundled." Missing modifiers can indicate billing errors.`,
          });
        }
      }
    }
  }

  // 4b. Missing modifier -25 on E&M with same-day procedure (already partially handled above)
  if (emItems.length > 0 && procedureItems.length > 0) {
    const emWithMod25 = emItems.filter(li => li.modifier === '25');
    // If they DO have -25, add an informational note about proper use
    for (const item of emWithMod25) {
      // Verify that it's with a same-day procedure — which we know it is since procedureItems.length > 0
      errors.push({
        type: 'modifier',
        severity: 'info',
        cptCodes: [item.cptCode, ...procedureItems.map(p => p.cptCode)],
        description:
          `E&M code ${item.cptCode} has modifier -25 (Significant, Separately Identifiable E&M Service) ` +
          `billed with same-day procedure(s) (${procedureItems.map(p => p.cptCode).join(', ')}). ` +
          `This is correct IF the evaluation was for a separately identifiable condition. ` +
          `Modifier -25 is frequently overused — studies show up to 35% of -25 modifier usage may be inappropriate.`,
        potentialSavings: null,
        actionStep:
          `Review whether the E&M visit addressed a distinct clinical issue from the procedure. ` +
          `If the E&M was solely the decision to perform the procedure, modifier -25 may not be warranted.`,
      });
    }
  }

  return errors;
}
