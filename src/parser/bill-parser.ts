/**
 * Main bill parser — routes to the correct backend based on file extension.
 *
 * Supported file types:
 *  .json          → JSON schema parser (existing behaviour)
 *  .pdf           → pdf-parse text extraction; falls back with clear error for scanned PDFs
 *  .jpg/.jpeg/.png/.tiff/.tif/.bmp → Tesseract.js OCR via ocr-pipeline
 *
 * When an image or PDF is an EOB (Explanation of Benefits), the parser detects
 * this automatically and returns both bill data and EOB data for 3-way comparison.
 */

import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { ParsedBillSchema, type ParsedBill, type LineItem } from '../schema/bill.js';
import { runOcrPipeline } from './ocr-pipeline.js';
import { billFromText } from './bill-from-text.js';
import {
  extractEobData,
  resolveEobLineCptCodes,
  type ExtractedEobData,
} from './eob-ocr-extractor.js';
import type { EOBDocument, EOBLineItem } from './eob-parser.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParseResult {
  bill: ParsedBill;
  eob?: EOBDocument;
  eobRaw?: ExtractedEobData; // raw OCR-extracted EOB data (for API consumers)
  isEob: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseBill(filePath: string): Promise<ParseResult> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.json':
      return { bill: parseJsonBill(filePath), isEob: false };

    case '.pdf':
      return parsePdfBill(filePath);

    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.tiff':
    case '.tif':
    case '.bmp':
      return parseImageBill(filePath);

    default:
      throw new Error(
        `Unsupported file type: "${ext}". ` +
        `Supported formats: .json, .pdf, .jpg, .jpeg, .png, .tiff, .tif, .bmp`
      );
  }
}

// ---------------------------------------------------------------------------
// JSON parser (unchanged)
// ---------------------------------------------------------------------------

function parseJsonBill(filePath: string): ParsedBill {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return ParsedBillSchema.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON bill "${filePath}": ${(err as Error).message}`
    );
  }
}

// ---------------------------------------------------------------------------
// PDF parser
// ---------------------------------------------------------------------------

async function parsePdfBill(filePath: string): Promise<ParseResult> {
  const result = await runOcrPipeline(filePath);
  return buildParseResult(result.extractedData, result.text, result.confidence, 'pdf');
}

// ---------------------------------------------------------------------------
// Image (OCR) parser
// ---------------------------------------------------------------------------

async function parseImageBill(filePath: string): Promise<ParseResult> {
  const result = await runOcrPipeline(filePath);
  return buildParseResult(result.extractedData, result.text, result.confidence, 'image');
}

// ---------------------------------------------------------------------------
// EOB detection and dual-path builder
// ---------------------------------------------------------------------------

/**
 * Given extracted bill data and raw OCR text, detect if the document is an EOB.
 * If so, also produce an EOBDocument for the 3-way comparison pipeline.
 */
async function buildParseResult(
  extractedData: import('./cpt-extractor.js').ExtractedBillData,
  ocrText: string,
  ocrConfidence: number,
  sourceType: 'pdf' | 'image',
): Promise<ParseResult> {
  // Always build the bill (works even for EOBs — line items become the bill)
  const bill = billFromText(extractedData, sourceType);

  // Check if this looks like an EOB
  const eobData = extractEobData(ocrText, ocrConfidence);

  if (!eobData.isEob) {
    return { bill, isEob: false };
  }

  // It's an EOB! Resolve CPT codes for description-only line items.
  const resolved = await resolveEobLineCptCodes(eobData);

  // Build an EOBDocument for the eob-audit pipeline
  const eobDoc = buildEobDocumentFromOcr(resolved, bill);

  // If the bill had no line items but the EOB does, synthesize bill line items
  // from the EOB data so the audit has something to match against CMS rates.
  let effectiveBill = bill;
  if (bill.lineItems.length === 0 && resolved.lineItems.length > 0) {
    effectiveBill = synthesizeBillFromEob(resolved, bill, sourceType);
  }

  return {
    bill: effectiveBill,
    eob: eobDoc,
    eobRaw: resolved,
    isEob: true,
  };
}

/**
 * Convert OCR-extracted EOB data into an EOBDocument compatible with eob-audit.ts.
 */
function buildEobDocumentFromOcr(
  eobData: ExtractedEobData,
  bill: ParsedBill,
): EOBDocument {
  const lineItems: EOBLineItem[] = eobData.lineItems.map((item, idx) => ({
    lineNumber: idx + 1,
    cptCode: item.cptCode?.toUpperCase() ?? 'UNKNOWN',
    modifier: null,
    description: item.description,
    billedAmount: item.billedAmount,
    allowedAmount: item.allowedAmount ?? item.billedAmount,
    insurancePaid: item.insurancePaid ?? 0,
    patientResponsibility: item.patientOwes ?? 0,
    adjustmentReason: null,
    copay: 0,
    coinsurance: 0,
    deductible: 0,
  }));

  // If no line items but we have summary data, create a single synthetic line item
  if (lineItems.length === 0 && eobData.summary) {
    const s = eobData.summary;
    lineItems.push({
      lineNumber: 1,
      cptCode: bill.lineItems[0]?.cptCode ?? 'UNKNOWN',
      modifier: null,
      description: bill.lineItems[0]?.description ?? 'Medical services',
      billedAmount: s.amountBilled ?? bill.totalBilled,
      allowedAmount: (s.amountBilled ?? 0) - (s.networkDiscount ?? 0),
      insurancePaid: s.planPaid ?? 0,
      patientResponsibility: s.patientResponsibility ?? 0,
      adjustmentReason: null,
      copay: 0,
      coinsurance: 0,
      deductible: 0,
    });
  }

  const totalBilled = lineItems.reduce((s, l) => s + l.billedAmount, 0);
  const totalAllowed = lineItems.reduce((s, l) => s + l.allowedAmount, 0);
  const totalPaid = lineItems.reduce((s, l) => s + l.insurancePaid, 0);
  const totalPatient = lineItems.reduce((s, l) => s + l.patientResponsibility, 0);

  return {
    insurerName: eobData.insurerName ?? 'Unknown Insurer',
    planType: eobData.planType ?? 'PPO',
    claimNumber: eobData.claimNumber ?? 'OCR-' + Date.now(),
    dateOfService: eobData.dateOfService ?? bill.statementDate ?? new Date().toISOString().slice(0, 10),
    providerName: eobData.providerName ?? bill.facilityName ?? 'Unknown Provider',
    patientName: eobData.patientName ?? 'Unknown Patient',
    lineItems,
    totalBilled: +totalBilled.toFixed(2),
    totalAllowed: +totalAllowed.toFixed(2),
    totalInsurancePaid: +totalPaid.toFixed(2),
    totalPatientResponsibility: +totalPatient.toFixed(2),
  };
}

/**
 * Create a ParsedBill from EOB line items when the standard bill parser
 * couldn't extract CPT codes directly (common for EOB photos).
 */
function synthesizeBillFromEob(
  eobData: ExtractedEobData,
  originalBill: ParsedBill,
  sourceType: 'pdf' | 'image',
): ParsedBill {
  const lineItems: LineItem[] = eobData.lineItems
    .filter(item => item.cptCode) // only include items where we resolved a CPT code
    .map((item, idx) => ({
      lineNumber: idx + 1,
      cptCode: item.cptCode!,
      modifier: undefined,
      description: item.description,
      units: 1,
      billedAmount: item.billedAmount,
      serviceDate: eobData.dateOfService ?? undefined,
      revenueCode: undefined,
    }));

  const totalBilled = lineItems.reduce((s, l) => s + l.billedAmount, 0);

  return ParsedBillSchema.parse({
    facilityName: eobData.providerName ?? originalBill.facilityName,
    facilityType: originalBill.facilityType,
    patientId: undefined,
    statementDate: eobData.dateOfService ?? originalBill.statementDate,
    lineItems,
    totalBilled: totalBilled || originalBill.totalBilled,
    parseConfidence: eobData.confidence,
    sourceType,
  });
}
