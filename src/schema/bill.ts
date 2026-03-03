import { z } from 'zod';

export const LineItemSchema = z.object({
  lineNumber: z.number().int().positive(),
  cptCode: z.string().regex(/^[A-Z0-9]{5}$/, 'CPT code must be 5 alphanumeric chars'),
  description: z.string().optional(),
  modifier: z.string().optional(),
  billedAmount: z.number().positive(),
  units: z.number().int().positive().optional().default(1),
});

export const BillSchema = z.object({
  facilityName: z.string().optional(),
  facilityType: z.enum(['hospital', 'er', 'outpatient', 'office', 'lab', 'unknown']),
  serviceDate: z.string().optional(),
  totalBilled: z.number().positive(),
  lineItems: z.array(LineItemSchema).min(1, 'Bill must have at least one line item'),
});

export type LineItem = z.infer<typeof LineItemSchema>;
export type Bill = z.infer<typeof BillSchema>;
