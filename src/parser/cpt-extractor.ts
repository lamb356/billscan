/**
 * CPT/HCPCS code and billing amount extractor.
 * Parses raw text (from OCR or PDF extraction) into structured bill data.
 */

import { matchDescriptionToCpt } from '../matcher/description-matcher.js';

export interface ExtractedLineItem {
  cptCode: string;
  modifier: string | null;
  description: string;
  billedAmount: number;
  quantity: number;
  rawLine: string;
}

export interface ExtractedBillData {
  facilityName: string | null;
  facilityType: 'hospital' | 'er' | 'outpatient' | 'office' | 'clinic' | 'unknown';
  dateOfService: string | null;
  patientName: string | null;
  lineItems: ExtractedLineItem[];
  totalBilled: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// CPT / HCPCS code patterns
// ---------------------------------------------------------------------------

/** 5-digit numeric CPT codes: 00100–99607 */
const CPT_NUMERIC = /\b(\d{5})\b/g;

/** HCPCS Level II J-codes (drug codes): J0001–J9999 */
const HCPCS_J = /\b(J\d{4})\b/gi;

/** HCPCS Level II other alpha prefix codes: A–E, G–H, K–N, P–V + 4 digits */
const HCPCS_ALPHA = /\b([A-CEGHJ-NPQ-V]\d{4})\b/gi;

/** Modifier pattern: 2-char alphanumeric following a CPT code (optional) */
const MODIFIER_AFTER_CPT = /\b([A-Z0-9]{2})\b/;

/** Dollar amounts — with or without $ sign */
const DOLLAR_AMOUNT = /\$\s*([\d,]+\.?\d{0,2})/g;
const BARE_AMOUNT   = /\b([\d,]{1,9}\.\d{2})\b/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract all CPT/HCPCS codes from a single line of text.
 * Returns an array of { code, index } so we can correlate with amounts.
 */
function extractCodesFromLine(line: string): Array<{ code: string; index: number }> {
  const results: Array<{ code: string; index: number }> = [];
  const seen = new Set<string>();

  const addCode = (code: string, index: number) => {
    const upper = code.toUpperCase();
    // Filter out obviously non-CPT 5-digit numbers (e.g. zip codes, years, phone fragments)
    if (/^\d{5}$/.test(upper)) {
      const num = parseInt(upper, 10);
      // Valid CPT ranges: 00100–99607 (with some gaps — broad filter)
      if (num < 100 || num > 99999) return;
      // Exclude obvious non-medical numbers: zip codes, dates portions, 00000
      if (num === 0) return;
    }
    if (!seen.has(upper)) {
      seen.add(upper);
      results.push({ code: upper, index });
    }
  };

  let m: RegExpExecArray | null;

  // J-codes first (most specific)
  const jRe = new RegExp(HCPCS_J.source, 'gi');
  while ((m = jRe.exec(line)) !== null) addCode(m[1], m.index);

  // Other alpha HCPCS
  const alphaRe = new RegExp(HCPCS_ALPHA.source, 'gi');
  while ((m = alphaRe.exec(line)) !== null) addCode(m[1], m.index);

  // 5-digit numeric CPT (run last so alpha prefixed codes aren't double-matched)
  const numRe = new RegExp(CPT_NUMERIC.source, 'g');
  while ((m = numRe.exec(line)) !== null) addCode(m[1], m.index);

  return results;
}

/**
 * Extract dollar amounts from a line. Returns values sorted by position.
 */
function extractAmountsFromLine(line: string): Array<{ amount: number; index: number }> {
  const results: Array<{ amount: number; index: number }> = [];

  let m: RegExpExecArray | null;

  const dollarRe = new RegExp(DOLLAR_AMOUNT.source, 'g');
  while ((m = dollarRe.exec(line)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (val > 0) results.push({ amount: val, index: m.index });
  }

  // Only use bare decimal amounts if no $ amounts were found on this line
  if (results.length === 0) {
    const bareRe = new RegExp(BARE_AMOUNT.source, 'g');
    while ((m = bareRe.exec(line)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0 && val < 1_000_000) results.push({ amount: val, index: m.index });
    }
  }

  return results.sort((a, b) => a.index - b.index);
}

/**
 * Given a line with a CPT code and amounts, pick the most likely billed amount.
 * Strategy: prefer the LAST amount on the line (typical "billed charge" column),
 * but fall back to any positive amount.
 */
function pickBilledAmount(amounts: Array<{ amount: number; index: number }>): number {
  if (amounts.length === 0) return 0;
  // In tabular bills the rightmost column is usually the charge
  return amounts[amounts.length - 1].amount;
}

/**
 * Try to extract a modifier from text immediately after a CPT code.
 * Modifiers are 2-character alphanumeric codes (e.g. "26", "TC", "UN", "LT").
 */
function extractModifier(text: string, codeEndIndex: number): string | null {
  const after = text.slice(codeEndIndex).trimStart();
  const m = after.match(/^[\s-]?([A-Z0-9]{2})(\s|$)/i);
  if (m) {
    const candidate = m[1].toUpperCase();
    // Common modifiers — a loose allow-list to avoid grabbing noise
    const KNOWN_MODIFIERS = new Set([
      '26','TC','LT','RT','50','51','59','76','77','79',
      'UN','UP','UQ','UR','US','GX','GY','GZ','GA','GT',
      'QW','QX','QY','QZ','E1','E2','E3','E4',
      'F1','F2','F3','F4','F5','F6','F7','F8','F9',
      'FA','FB','FC','FD','FE','FF','FG','FH','FI','FJ',
      'T1','T2','T3','T4','T5','T6','T7','T8','T9','TA','TB','TC','TD',
      'LM','LD','LC','LA',
      'AS','AT','AU','AV','AW','AX','AY','AZ',
      'KX','KF','KE','KD','KC','KB','KA',
      'JW','JP',
    ]);
    if (KNOWN_MODIFIERS.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Clean up a description string extracted from bill text.
 */
function cleanDescription(raw: string): string {
  return raw
    .replace(/\$[\d,.]+/g, '')     // remove dollar amounts
    .replace(/\b\d{5}\b/g, '')     // remove 5-digit codes
    .replace(/[A-Z]\d{4}/gi, '')   // remove alpha HCPCS codes
    .replace(/\s{2,}/g, ' ')
    .replace(/[|*_]+/g, ' ')
    .trim()
    .slice(0, 120);
}

// ---------------------------------------------------------------------------
// Facility / metadata extraction
// ---------------------------------------------------------------------------

const FACILITY_KEYWORDS = /hospital|medical center|health system|clinic|health care|healthcare|emergency|outpatient|urgent care|surgery center/i;
const DATE_PATTERN = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const PATIENT_KEYWORDS = /Patient\s+Name\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*(?:[a-z]+)?)?(?:\s+[A-Z][a-z]+)?)(?:\s*\n|\s{2,}|\s*Date|\s*Account|\s*$)/;

function detectFacilityType(text: string): ExtractedBillData['facilityType'] {
  const lower = text.toLowerCase();
  if (/emergency\s*(department|dept|room|er\b)|urgent care/i.test(text)) return 'er';
  if (/\bhospital\b/i.test(text)) return 'hospital';
  if (/\boutpatient\b/i.test(text)) return 'outpatient';
  if (/\bclinic\b/i.test(text)) return 'clinic';
  if (/\boffice\b/i.test(text)) return 'office';
  return 'unknown';
}

function extractFacilityName(lines: string[]): string | null {
  // Check the first 8 lines for a likely facility name
  for (const line of lines.slice(0, 8)) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && trimmed.length < 120 && FACILITY_KEYWORDS.test(trimmed)) {
      return trimmed;
    }
  }
  // Fall back: first non-empty line that's not all numbers/symbols
  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && /[a-zA-Z]{3,}/.test(trimmed) && !/^\d/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

function extractDate(text: string): string | null {
  // Look for "date of service" label first
  const labelMatch = text.match(/(?:date\s+of\s+service|service\s+date|dos|date)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (labelMatch) return normalizeDate(labelMatch[1]);

  // Otherwise grab first date-like token from the text
  const m = text.match(DATE_PATTERN);
  return m ? normalizeDate(m[1]) : null;
}

function normalizeDate(raw: string): string {
  // Try to convert various date formats to YYYY-MM-DD
  const parts = raw.split(/[\/\-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) return raw; // already YYYY-MM-DD
    const [m, d, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return raw;
}

function extractPatientName(text: string): string | null {
  const m = text.match(PATIENT_KEYWORDS);
  if (!m) return null;
  // Trim whitespace and strip any trailing newline-attached tokens
  return m[1].replace(/\s+/g, ' ').trim().split(/\n/)[0].trim() || null;
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/** Regex to detect lines with 5+ chars of alpha text (potential procedure description). */
const HAS_ALPHA_TEXT = /[a-zA-Z]{5,}/;

/**
 * Parse raw text (from OCR or PDF) and extract structured bill data.
 *
 * Strategy:
 *  1. Split into lines.
 *  2. For each line, detect CPT/HCPCS codes.
 *  3. If a line contains both a CPT code and a dollar amount, pair them.
 *  4. For multi-line entries (description wraps), include context from adjacent lines.
 *  5. Extract metadata (facility, date, patient) from surrounding text.
 *  6. Fallback: if a line has a dollar amount and descriptive text but no CPT code,
 *     attempt to resolve the description to a CPT code via description matching.
 */
export async function extractCptData(text: string, ocrConfidence = 0.85): Promise<ExtractedBillData> {
  const lines = text.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);

  const lineItems: ExtractedLineItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const codes = extractCodesFromLine(line);

    if (codes.length > 0) {
      // Standard path: line has CPT/HCPCS codes
      let amounts = extractAmountsFromLine(line);
      if (amounts.length === 0 && i + 1 < lines.length) {
        amounts = extractAmountsFromLine(lines[i + 1]);
      }

      for (const { code, index } of codes) {
        const billedAmount = pickBilledAmount(amounts);
        if (billedAmount <= 0) continue;

        const codeEnd = index + code.length;
        const modifier = extractModifier(line, codeEnd);
        const rawDesc = cleanDescription(line);
        const description = rawDesc || code;

        lineItems.push({
          cptCode: code,
          modifier,
          description,
          billedAmount,
          quantity: 1,
          rawLine: line.trim(),
        });
      }
      continue;
    }

    // Fallback: no CPT codes found on this line.
    // If the line has a dollar amount and descriptive alpha text, try description matching.
    const amounts = extractAmountsFromLine(line);
    if (amounts.length === 0) continue;

    const rawDesc = cleanDescription(line);
    if (!rawDesc || !HAS_ALPHA_TEXT.test(rawDesc)) continue;

    const billedAmount = pickBilledAmount(amounts);
    if (billedAmount <= 0) continue;

    const match = await matchDescriptionToCpt(rawDesc);
    if (match) {
      lineItems.push({
        cptCode: match.cptCode,
        modifier: null,
        description: rawDesc,
        billedAmount,
        quantity: 1,
        rawLine: line.trim(),
      });
    }
  }

  // Deduplicate: if the same CPT code appears multiple times with the same amount,
  // keep first occurrence (OCR sometimes double-reads a line).
  const seen = new Map<string, boolean>();
  const deduped = lineItems.filter(item => {
    const key = `${item.cptCode}:${item.billedAmount}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });

  const totalBilled = deduped.reduce((sum, item) => sum + item.billedAmount, 0);

  return {
    facilityName: extractFacilityName(nonEmpty),
    facilityType: detectFacilityType(text),
    dateOfService: extractDate(text),
    patientName: extractPatientName(text),
    lineItems: deduped,
    totalBilled,
    confidence: ocrConfidence,
  };
}
