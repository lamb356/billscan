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

const CPT_NUMERIC = /\b(\d{5})\b/g;
const HCPCS_J = /\b(J\d{4})\b/gi;
const HCPCS_ALPHA = /\b([A-CEGHJ-NPQ-V]\d{4})\b/gi;
const DOLLAR_AMOUNT = /\$\s*([\d,]+\.?\d{0,2})/g;
const BARE_AMOUNT   = /\b([\d,]{1,9}\.\d{2})\b/g;

function extractCodesFromLine(line: string): Array<{ code: string; index: number }> {
  const results: Array<{ code: string; index: number }> = [];
  const seen = new Set<string>();

  const addCode = (code: string, index: number) => {
    const upper = code.toUpperCase();
    if (/^\d{5}$/.test(upper)) {
      const num = parseInt(upper, 10);
      if (num < 100 || num > 99999) return;
      if (num === 0) return;
    }
    if (!seen.has(upper)) { seen.add(upper); results.push({ code: upper, index }); }
  };

  let m: RegExpExecArray | null;

  const jRe = new RegExp(HCPCS_J.source, 'gi');
  while ((m = jRe.exec(line)) !== null) addCode(m[1], m.index);

  const alphaRe = new RegExp(HCPCS_ALPHA.source, 'gi');
  while ((m = alphaRe.exec(line)) !== null) addCode(m[1], m.index);

  const numRe = new RegExp(CPT_NUMERIC.source, 'g');
  while ((m = numRe.exec(line)) !== null) addCode(m[1], m.index);

  return results;
}

function extractAmountsFromLine(line: string): Array<{ amount: number; index: number }> {
  const results: Array<{ amount: number; index: number }> = [];
  let m: RegExpExecArray | null;

  const dollarRe = new RegExp(DOLLAR_AMOUNT.source, 'g');
  while ((m = dollarRe.exec(line)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (val > 0) results.push({ amount: val, index: m.index });
  }

  if (results.length === 0) {
    const bareRe = new RegExp(BARE_AMOUNT.source, 'g');
    while ((m = bareRe.exec(line)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0 && val < 1_000_000) results.push({ amount: val, index: m.index });
    }
  }

  return results.sort((a, b) => a.index - b.index);
}

function pickBilledAmount(amounts: Array<{ amount: number; index: number }>): number {
  if (amounts.length === 0) return 0;
  return amounts[amounts.length - 1].amount;
}

function extractModifier(text: string, codeEndIndex: number): string | null {
  const after = text.slice(codeEndIndex).trimStart();
  const m = after.match(/^[\s-]?([A-Z0-9]{2})(\s|$)/i);
  if (m) {
    const candidate = m[1].toUpperCase();
    const KNOWN_MODIFIERS = new Set([
      '26','TC','LT','RT','50','51','59','76','77','79',
      'UN','UP','UQ','UR','US','GX','GY','GZ','GA','GT',
      'QW','QX','QY','QZ','E1','E2','E3','E4',
      'F1','F2','F3','F4','F5','F6','F7','F8','F9',
      'FA','FB','FC','FD','FE','FF','FG','FH','FI','FJ',
      'T1','T2','T3','T4','T5','T6','T7','T8','T9','TA','TB','TC','TD',
      'LM','LD','LC','LA','AS','AT','AU','AV','AW','AX','AY','AZ',
      'KX','KF','KE','KD','KC','KB','KA','JW','JP',
    ]);
    if (KNOWN_MODIFIERS.has(candidate)) return candidate;
  }
  return null;
}

function cleanDescription(raw: string): string {
  return raw
    .replace(/\$[\d,.]+/g, '')
    .replace(/\b\d{5}\b/g, '')
    .replace(/[A-Z]\d{4}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[|*_]+/g, ' ')
    .trim()
    .slice(0, 120);
}

const FACILITY_KEYWORDS = /hospital|medical center|health system|clinic|health care|healthcare|emergency|outpatient|urgent care|surgery center/i;
const DATE_PATTERN = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const PATIENT_KEYWORDS = /Patient\s+Name\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*(?:[a-z]+)?)?(?:\s+[A-Z][a-z]+)?)(?:\s*\n|\s{2,}|\s*Date|\s*Account|\s*$)/;

function detectFacilityType(text: string): ExtractedBillData['facilityType'] {
  if (/emergency\s*(department|dept|room|er\b)|urgent care/i.test(text)) return 'er';
  if (/\bhospital\b/i.test(text)) return 'hospital';
  if (/\boutpatient\b/i.test(text)) return 'outpatient';
  if (/\bclinic\b/i.test(text)) return 'clinic';
  if (/\boffice\b/i.test(text)) return 'office';
  return 'unknown';
}

function extractFacilityName(lines: string[]): string | null {
  for (const line of lines.slice(0, 8)) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && trimmed.length < 120 && FACILITY_KEYWORDS.test(trimmed)) return trimmed;
  }
  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && /[a-zA-Z]{3,}/.test(trimmed) && !/^\d/.test(trimmed)) return trimmed;
  }
  return null;
}

function extractDate(text: string): string | null {
  const labelMatch = text.match(/(?:date\s+of\s+service|service\s+date|dos|date)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (labelMatch) return normalizeDate(labelMatch[1]);
  const m = text.match(DATE_PATTERN);
  return m ? normalizeDate(m[1]) : null;
}

function normalizeDate(raw: string): string {
  const parts = raw.split(/[\/\-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) return raw;
    const [m, d, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return raw;
}

function extractPatientName(text: string): string | null {
  const m = text.match(PATIENT_KEYWORDS);
  if (!m) return null;
  return m[1].replace(/\s+/g, ' ').trim().split(/\n/)[0].trim() || null;
}

export function extractCptData(text: string, ocrConfidence = 0.85): ExtractedBillData {
  const lines = text.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  const lineItems: ExtractedLineItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const codes = extractCodesFromLine(line);
    if (codes.length === 0) continue;

    let amounts = extractAmountsFromLine(line);
    if (amounts.length === 0 && i + 1 < lines.length) amounts = extractAmountsFromLine(lines[i + 1]);

    for (const { code, index } of codes) {
      const billedAmount = pickBilledAmount(amounts);
      if (billedAmount <= 0) continue;

      const codeEnd = index + code.length;
      const modifier = extractModifier(line, codeEnd);
      const rawDesc = cleanDescription(line);
      const description = rawDesc || code;

      lineItems.push({ cptCode: code, modifier, description, billedAmount, quantity: 1, rawLine: line.trim() });
    }
  }

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
