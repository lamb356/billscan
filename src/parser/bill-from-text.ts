import type { ExtractedBillData } from './cpt-extractor.js';
import { ParsedBillSchema, type ParsedBill, type LineItem } from '../schema/bill.js';

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

  const facilityTypeMap: Record<string, ParsedBill['facilityType']> = {
    hospital: 'hospital',
    er: 'er',
    outpatient: 'outpatient',
    office: 'office',
    clinic: 'clinic',
    unknown: 'unknown',
  };

  const facilityType = facilityTypeMap[data.facilityType] ?? 'unknown';

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
