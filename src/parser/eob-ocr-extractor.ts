/**
 * EOB OCR Text Extractor
 *
 * Parses OCR'd text from Explanation of Benefits documents (photos/PDFs)
 * from insurers like Premera, Anthem, UHC, Aetna, BCBS, Cigna, Humana, Kaiser.
 *
 * Detects whether a document is an EOB (vs a regular bill) and extracts:
 *   - Insurer name and plan type
 *   - Claim number and date of service
 *   - Summary amounts (billed, discount, plan paid, patient responsibility)
 *   - Line-item breakdowns (description, billed, allowed, paid, owed)
 */

import { matchDescriptionToCpt } from '../matcher/description-matcher.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedEobData {
  insurerName: string | null;
  planType: string | null;   // HMO, PPO, etc.
  claimNumber: string | null;
  dateOfService: string | null;
  providerName: string | null;
  patientName: string | null;

  /** Summary-level EOB (single claim, no line items) */
  summary: {
    amountBilled: number | null;
    networkDiscount: number | null;
    planPaid: number | null;
    patientResponsibility: number | null;
    amountSaved: number | null;
  } | null;

  /** Line-item EOB (multiple services with individual breakdowns) */
  lineItems: Array<{
    description: string;
    cptCode: string | null;
    billedAmount: number;
    allowedAmount: number | null;
    insurancePaid: number | null;
    patientOwes: number | null;
  }>;

  isEob: boolean;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Detection keywords and patterns
// ---------------------------------------------------------------------------

const EOB_KEYWORDS = [
  'explanation of benefits',
  'this is not a bill',
  'claim summary',
  'amount billed',
  'plan paid',
  'your responsibility',
  'network discount',
  'allowed amount',
  'deductible',
  'copay',
  'coinsurance',
  'contractual adjustment',
  'amount paid by',
  'paid by your health plan',
  'you owe',
  'amount due',
  'member responsibility',
  'patient responsibility',
  'insurance paid',
  'total savings',
  'you saved',
  'benefit details',
  'claims detail',
  'service detail',
  'eob',
];

const INSURER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /premera\s*blue\s*cross/i, name: 'Premera Blue Cross' },
  { pattern: /anthem\s*blue\s*cross/i, name: 'Anthem Blue Cross' },
  { pattern: /anthem/i, name: 'Anthem' },
  { pattern: /united\s*health\s*care/i, name: 'UnitedHealthcare' },
  { pattern: /uhc/i, name: 'UnitedHealthcare' },
  { pattern: /aetna/i, name: 'Aetna' },
  { pattern: /cigna/i, name: 'Cigna' },
  { pattern: /blue\s*cross\s*blue\s*shield/i, name: 'Blue Cross Blue Shield' },
  { pattern: /bcbs/i, name: 'BCBS' },
  { pattern: /blue\s*cross/i, name: 'Blue Cross' },
  { pattern: /blue\s*shield/i, name: 'Blue Shield' },
  { pattern: /humana/i, name: 'Humana' },
  { pattern: /kaiser\s*permanente/i, name: 'Kaiser Permanente' },
  { pattern: /kaiser/i, name: 'Kaiser' },
  { pattern: /molina/i, name: 'Molina Healthcare' },
  { pattern: /centene/i, name: 'Centene' },
  { pattern: /tricare/i, name: 'TRICARE' },
  { pattern: /medicare\s*advantage/i, name: 'Medicare Advantage' },
  { pattern: /regence/i, name: 'Regence' },
  { pattern: /horizon\s*bcbs/i, name: 'Horizon BCBS' },
  { pattern: /carefirst/i, name: 'CareFirst' },
  { pattern: /highmark/i, name: 'Highmark' },
];

const PLAN_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\bHMO\b/i, type: 'HMO' },
  { pattern: /\bPPO\b/i, type: 'PPO' },
  { pattern: /\bEPO\b/i, type: 'EPO' },
  { pattern: /\bPOS\b/i, type: 'POS' },
  { pattern: /\bHDHP\b/i, type: 'HDHP' },
  { pattern: /\bHSA\b/i, type: 'HDHP' },
  { pattern: /out[- ]of[- ]network/i, type: 'OON' },
];

// ---------------------------------------------------------------------------
// Dollar amount extraction
// ---------------------------------------------------------------------------

/** Extract a dollar amount from text, handling $1,234.56 and 1234.56 formats. */
function parseDollar(s: string): number | null {
  const m = s.match(/\$?\s*([\d,]+\.?\d*)/);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(val) ? null : +val.toFixed(2);
}

/**
 * Find a labeled dollar amount in the text.
 * Searches for lines containing one of the label patterns followed by a dollar amount.
 */
function findLabeledAmount(text: string, labels: string[]): number | null {
  const lines = text.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const label of labels) {
      if (lower.includes(label.toLowerCase())) {
        // Look for dollar amount on this line
        const amountMatch = line.match(/\$\s*[\d,]+\.?\d*/);
        if (amountMatch) return parseDollar(amountMatch[0]);
        // Try bare number at end of line
        const bareMatch = line.match(/([\d,]+\.\d{2})\s*$/);
        if (bareMatch) return parseDollar(bareMatch[1]);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

function extractInsurer(text: string): string | null {
  for (const { pattern, name } of INSURER_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

function extractPlanType(text: string): string | null {
  for (const { pattern, type } of PLAN_TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function extractClaimNumber(text: string): string | null {
  const patterns = [
    /claim\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9]{4,20})/i,
    /claim\s*id\s*:?\s*([A-Z0-9]{4,20})/i,
    /reference\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9]{4,20})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractDateOfService(text: string): string | null {
  const patterns = [
    /date\s*of\s*service\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /service\s*date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /dos\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /date\(s\)\s*of\s*service\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractProvider(text: string): string | null {
  const patterns = [
    /(?:services?\s*provided\s*by|provider)\s*:?\s*(.+)/im,
    /(?:rendering\s*provider|facility)\s*:?\s*(.+)/im,
    /(?:doctor|physician)\s*:?\s*(.+)/im,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const name = m[1].trim().replace(/\s{2,}/g, ' ');
      // Don't return if it looks like a dollar amount or too short
      if (name.length > 2 && !name.startsWith('$')) return name.slice(0, 100);
    }
  }
  return null;
}

function extractPatient(text: string): string | null {
  const patterns = [
    /(?:claim\s*summary\s*for|patient|member)\s*:?\s*(.+)/im,
    /(?:member\s*name|patient\s*name)\s*:?\s*(.+)/im,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const name = m[1].trim().replace(/\s{2,}/g, ' ');
      if (name.length > 2 && !name.startsWith('$')) return name.slice(0, 80);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Line item extraction
// ---------------------------------------------------------------------------

/** Regex for CPT/HCPCS code in a line. */
const CPT_IN_LINE = /\b(\d{5})\b|\b([A-Z]\d{4})\b/;

/**
 * Extract line items from tabular EOB data.
 *
 * EOBs typically have a table like:
 *   Service          Billed    Allowed   Plan Paid  You Owe
 *   Office Visit     $250.00   $150.00   $120.00    $30.00
 *
 * We detect lines with 2+ dollar amounts and alpha text as potential line items.
 */
function extractLineItems(
  text: string,
): Array<{
  description: string;
  cptCode: string | null;
  billedAmount: number;
  allowedAmount: number | null;
  insurancePaid: number | null;
  patientOwes: number | null;
}> {
  const lines = text.split('\n');
  const items: Array<{
    description: string;
    cptCode: string | null;
    billedAmount: number;
    allowedAmount: number | null;
    insurancePaid: number | null;
    patientOwes: number | null;
  }> = [];

  for (const line of lines) {
    // Find all dollar amounts on this line
    const amountMatches = [...line.matchAll(/\$\s*([\d,]+\.?\d*)/g)];
    if (amountMatches.length < 2) continue; // need at least billed + one more

    // Extract the text portion (strip dollar amounts)
    const descPart = line
      .replace(/\$\s*[\d,]+\.?\d*/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Must have meaningful alpha text (>3 chars of letters)
    if (!/[a-zA-Z]{3,}/.test(descPart)) continue;

    // Skip header rows
    const lower = descPart.toLowerCase();
    if (
      lower.includes('service') && lower.includes('billed') ||
      lower.includes('description') && lower.includes('amount') ||
      lower.includes('procedure') && lower.includes('charge')
    ) continue;

    const amounts = amountMatches.map(m => parseDollar(m[0])).filter((v): v is number => v !== null);
    if (amounts.length < 2) continue;

    // Check for CPT code in the text
    const cptMatch = descPart.match(CPT_IN_LINE);
    const cptCode = cptMatch ? (cptMatch[1] || cptMatch[2]) : null;

    // Remove the CPT code from description
    const description = cptCode
      ? descPart.replace(cptCode, '').replace(/\s{2,}/g, ' ').trim()
      : descPart;

    // Assign amounts based on column position (billed, allowed, paid, owed)
    items.push({
      description: description || 'Unknown service',
      cptCode,
      billedAmount: amounts[0],
      allowedAmount: amounts.length >= 2 ? amounts[1] : null,
      insurancePaid: amounts.length >= 3 ? amounts[2] : null,
      patientOwes: amounts.length >= 4 ? amounts[3] : null,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Summary extraction
// ---------------------------------------------------------------------------

function extractSummary(text: string): ExtractedEobData['summary'] {
  const amountBilled = findLabeledAmount(text, [
    'amount billed', 'total charges', 'billed amount', 'total billed',
    'charges', 'provider billed',
  ]);

  const networkDiscount = findLabeledAmount(text, [
    'network discount', 'contractual adjustment', 'adjustment',
    'plan discount', 'negotiated discount', 'write off', 'write-off',
  ]);

  const planPaid = findLabeledAmount(text, [
    'plan paid', 'amount paid by', 'insurance paid', 'paid by your health plan',
    'paid by plan', 'health plan paid', 'benefits paid',
  ]);

  const patientResponsibility = findLabeledAmount(text, [
    'your responsibility', 'patient responsibility', 'you owe', 'amount due',
    'member responsibility', 'total you owe', 'your cost',
    'amount you owe', 'total patient responsibility',
  ]);

  const amountSaved = findLabeledAmount(text, [
    'amount you saved', 'you saved', 'total savings', 'savings',
    'amount saved',
  ]);

  // Only return summary if at least 2 fields were found
  const found = [amountBilled, networkDiscount, planPaid, patientResponsibility, amountSaved]
    .filter(v => v !== null).length;

  if (found < 2) return null;

  return { amountBilled, networkDiscount, planPaid, patientResponsibility, amountSaved };
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract EOB data from OCR text. Determines whether the document is an EOB
 * and extracts structured data if so.
 */
export function extractEobData(text: string, ocrConfidence: number): ExtractedEobData {
  const lower = text.toLowerCase();

  // Count EOB keyword matches for detection
  const keywordHits = EOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const isEob = keywordHits >= 2;

  const insurerName = extractInsurer(text);
  const planType = extractPlanType(text);
  const claimNumber = extractClaimNumber(text);
  const dateOfService = extractDateOfService(text);
  const providerName = extractProvider(text);
  const patientName = extractPatient(text);

  // Extract summary (labeled amounts)
  const summary = extractSummary(text);

  // Extract line items (tabular data)
  const lineItems = extractLineItems(text);

  // Confidence: base OCR confidence, boosted by keyword match count
  const keywordBoost = Math.min(keywordHits * 0.05, 0.15);
  const confidence = Math.min(ocrConfidence + keywordBoost, 1.0);

  return {
    insurerName,
    planType,
    claimNumber,
    dateOfService,
    providerName,
    patientName,
    summary,
    lineItems,
    isEob,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// CPT code resolution for line items
// ---------------------------------------------------------------------------

/**
 * Resolve CPT codes for EOB line items that don't have printed codes.
 * Uses the description matcher to attempt resolution.
 */
export async function resolveEobLineCptCodes(
  eobData: ExtractedEobData,
): Promise<ExtractedEobData> {
  const resolvedItems = await Promise.all(
    eobData.lineItems.map(async item => {
      if (item.cptCode) return item; // already has a code

      const match = await matchDescriptionToCpt(item.description);
      return {
        ...item,
        cptCode: match?.cptCode ?? null,
      };
    }),
  );

  return { ...eobData, lineItems: resolvedItems };
}
