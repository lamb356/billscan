import { z } from 'zod';

export const LineItemSchema = z.object({
  lineNumber: z.number(),
  cptCode: z.string(),
  modifier: z.string().optional(),
  description: z.string(),
  units: z.number().default(1),
  billedAmount: z.number(),
  serviceDate: z.string().optional(),
  revenueCode: z.string().optional(),
});

export const ParsedBillSchema = z.object({
  facilityName: z.string().optional(),
  facilityType: z.enum(['hospital', 'er', 'outpatient', 'office', 'clinic', 'unknown']).default('unknown'),
  patientId: z.string().optional(),
  statementDate: z.string().optional(),
  lineItems: z.array(LineItemSchema).min(1),
  totalBilled: z.number(),
  parseConfidence: z.number().min(0).max(1),
  sourceType: z.enum(['pdf', 'image', 'json', 'manual']),
});

export type LineItem = z.infer<typeof LineItemSchema>;
export type ParsedBill = z.infer<typeof ParsedBillSchema>;
