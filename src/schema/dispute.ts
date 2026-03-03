import { z } from 'zod';

export const DisputeLetterSchema = z.object({
  patientName: z.string().optional(),
  patientAddress: z.string().optional(),
  facilityName: z.string(),
  facilityAddress: z.string().optional(),
  dateOfService: z.string().optional(),
  accountNumber: z.string().optional(),
  totalBilled: z.number(),
  totalCmsBaseline: z.number(),
  totalPotentialSavings: z.number(),
  topFindings: z.array(z.object({
    cptCode: z.string(),
    description: z.string().optional(),
    billedAmount: z.number(),
    cmsRate: z.number(),
    overcharge: z.number(),
  })),
  reportId: z.string(),
  generatedAt: z.string(),
  cmsYear: z.number(),
});

export type DisputeLetter = z.infer<typeof DisputeLetterSchema>;
