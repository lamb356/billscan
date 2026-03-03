import { readFileSync, existsSync } from 'node:fs';

export interface EOBLineItem {
  lineNumber: number;
  cptCode: string;
  modifier: string | null;
  description: string;
  billedAmount: number;
  allowedAmount: number;
  insurancePaid: number;
  patientResponsibility: number;
  adjustmentReason: string | null;
  copay: number;
  coinsurance: number;
  deductible: number;
}

export interface EOBDocument {
  insurerName: string;
  planType: string;
  claimNumber: string;
  dateOfService: string;
  providerName: string;
  patientName: string;
  lineItems: EOBLineItem[];
  totalBilled: number;
  totalAllowed: number;
  totalInsurancePaid: number;
  totalPatientResponsibility: number;
}

function requireString(val: unknown, field: string): string {
  if (typeof val !== 'string' || val.trim() === '')
    throw new Error(`EOB parse error: "${field}" must be a non-empty string`);
  return val.trim();
}

function requireNumber(val: unknown, field: string): number {
  const n = Number(val);
  if (val === null || val === undefined || isNaN(n))
    throw new Error(`EOB parse error: "${field}" must be a number, got ${JSON.stringify(val)}`);
  return +n.toFixed(2);
}

function optionalString(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;
  return String(val).trim();
}

function optionalNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  if (val === null || val === undefined || isNaN(n)) return fallback;
  return +n.toFixed(2);
}

function parseLineItem(raw: Record<string, unknown>, idx: number): EOBLineItem {
  const lineNumber = typeof raw.lineNumber === 'number' ? raw.lineNumber : idx + 1;
  const cptCode = requireString(raw.cptCode, `lineItems[${idx}].cptCode`).toUpperCase();
  const description = requireString(raw.description, `lineItems[${idx}].description`);
  const billedAmount = requireNumber(raw.billedAmount, `lineItems[${idx}].billedAmount`);
  const allowedAmount = requireNumber(raw.allowedAmount, `lineItems[${idx}].allowedAmount`);
  const insurancePaid = requireNumber(raw.insurancePaid, `lineItems[${idx}].insurancePaid`);
  const patientResponsibility = requireNumber(raw.patientResponsibility, `lineItems[${idx}].patientResponsibility`);

  const diff = Math.abs(allowedAmount - (insurancePaid + patientResponsibility));
  if (diff > 0.10) {
    console.warn(
      `[eob-parser] Warning: line ${lineNumber} (${cptCode}): ` +
      `allowedAmount $${allowedAmount} != insurancePaid $${insurancePaid} + patientResp $${patientResponsibility} ` +
      `(diff $${diff.toFixed(2)})`
    );
  }

  return {
    lineNumber, cptCode,
    modifier: optionalString(raw.modifier),
    description, billedAmount, allowedAmount, insurancePaid, patientResponsibility,
    adjustmentReason: optionalString(raw.adjustmentReason),
    copay: optionalNumber(raw.copay),
    coinsurance: optionalNumber(raw.coinsurance),
    deductible: optionalNumber(raw.deductible),
  };
}

export function parseEob(filePath: string): EOBDocument {
  if (!existsSync(filePath)) throw new Error(`EOB file not found: ${filePath}`);

  const ext = filePath.toLowerCase();
  if (!ext.endsWith('.json'))
    throw new Error(`Unsupported EOB format: only .json is currently supported. Got: ${filePath}`);

  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

  const insurerName = requireString(raw.insurerName, 'insurerName');
  const planType = requireString(raw.planType, 'planType').toUpperCase();
  const claimNumber = requireString(raw.claimNumber, 'claimNumber');
  const dateOfService = requireString(raw.dateOfService, 'dateOfService');
  const providerName = requireString(raw.providerName, 'providerName');
  const patientName = requireString(raw.patientName, 'patientName');

  if (!Array.isArray(raw.lineItems) || raw.lineItems.length === 0)
    throw new Error('EOB parse error: "lineItems" must be a non-empty array');

  const lineItems: EOBLineItem[] = (raw.lineItems as Record<string, unknown>[]).map(
    (item, idx) => parseLineItem(item, idx)
  );

  const computedBilled = +lineItems.reduce((s, l) => s + l.billedAmount, 0).toFixed(2);
  const computedAllowed = +lineItems.reduce((s, l) => s + l.allowedAmount, 0).toFixed(2);
  const computedPaid = +lineItems.reduce((s, l) => s + l.insurancePaid, 0).toFixed(2);
  const computedPatient = +lineItems.reduce((s, l) => s + l.patientResponsibility, 0).toFixed(2);

  const totalBilled = raw.totalBilled !== undefined ? requireNumber(raw.totalBilled, 'totalBilled') : computedBilled;
  const totalAllowed = raw.totalAllowed !== undefined ? requireNumber(raw.totalAllowed, 'totalAllowed') : computedAllowed;
  const totalInsurancePaid = raw.totalInsurancePaid !== undefined ? requireNumber(raw.totalInsurancePaid, 'totalInsurancePaid') : computedPaid;
  const totalPatientResponsibility = raw.totalPatientResponsibility !== undefined
    ? requireNumber(raw.totalPatientResponsibility, 'totalPatientResponsibility')
    : computedPatient;

  if (Math.abs(totalBilled - computedBilled) > 1.00)
    console.warn(`[eob-parser] totalBilled ${totalBilled} differs from sum of line items ${computedBilled}`);
  if (Math.abs(totalAllowed - computedAllowed) > 1.00)
    console.warn(`[eob-parser] totalAllowed ${totalAllowed} differs from sum of line items ${computedAllowed}`);

  return {
    insurerName, planType, claimNumber, dateOfService,
    providerName, patientName, lineItems,
    totalBilled, totalAllowed, totalInsurancePaid, totalPatientResponsibility,
  };
}

export function buildEobLookup(eob: EOBDocument): Map<string, EOBLineItem> {
  const map = new Map<string, EOBLineItem>();
  for (const item of eob.lineItems) {
    const key = item.modifier ? `${item.cptCode}:${item.modifier}` : item.cptCode;
    const existing = map.get(key) ?? map.get(item.cptCode);
    if (!existing || item.allowedAmount > existing.allowedAmount) {
      map.set(item.cptCode, item);
      if (item.modifier) map.set(key, item);
    }
  }
  return map;
}
