/**
 * Converts extracted OCR / PDF text data into the canonical ParsedBill format.
 *
 * This is the bridge between the raw extraction layer (cpt-extractor.ts) and
 * the bill schema used throughout BillScan.
 */

import type { ExtractedBillData } from './cpt-extractor.js';
import { ParsedBillSchema, type ParsedBill, type LineItem } from '../schema/bill.js';

/**
 * Convert OCR-extracted data into a validated ParsedBill.
 *
 * @param data          Structured data from extractCptData()
 * @param sourceType    'pdf' or 'image' (used in schema)
 * @throws              ZodError if the resulting object fails schema validation
 */
export function billFromText(
  data: ExtractedBillData,
  sourceType: 'pdf' | 'image'
): ParsedBill {
  const lineItems: LineItem[] = data.lineItems.map((item, idx) => ({
    lineNumber: idx + 1,
    cptCode: item.cptCode,
    modifier: item.modifier ?? undefined,
    description: item.description || item.cptCode,
    units: item.quantity,
    billedAmount: item.billedAmount,
    serviceDate: data.dateOfService ?? undefined,
    revenueCode: undefined,
  }));

  // Validate the facility type enum matches the schema
  const facilityTypeMap: Record<string, ParsedBill['facilityType']> = {
    hospital: 'hospital',
    er: 'er',
    outpatient: 'outpatient',
    office: 'office',
    clinic: 'clinic',
    unknown: 'unknown',
  };

  const facilityType = facilityTypeMap[data.facilityType] ?? 'unknown';

  // Calculate total from line items (more reliable than extracted total which
  // may include subtotals or taxes)
  const totalBilled =
    data.totalBilled > 0
      ? data.totalBilled
      : lineItems.reduce((sum, item) => sum + item.billedAmount, 0);

  const raw = {
    facilityName: data.facilityName ?? undefined,
    facilityType,
    patientId: undefined,
    statementDate: data.dateOfService ?? undefined,
    lineItems,
    totalBilled,
    parseConfidence: data.confidence,
    sourceType,
  };

  return ParsedBillSchema.parse(raw);
}
