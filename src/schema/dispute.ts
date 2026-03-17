import { z } from 'zod';

export const DisputeLetterDataSchema = z.object({
  currentDate: z.string(),
  facilityName: z.string(),
  facilityAddress: z.string().default('[Facility Address]'),
  statementDate: z.string(),
  patientAccount: z.string().default('[Account Number]'),
  cmsYear: z.number(),
  cmsSourceUrl: z.string(),
  reportId: z.string(),
  totalBilled: z.number(),
  totalCmsBaseline: z.number(),
  totalSavings: z.number(),
  topFindings: z.array(z.object({
    cptCode: z.string(),
    description: z.string(),
    billedAmount: z.number(),
    cmsRateUsed: z.number(),
    rateContext: z.string(),
    overchargeMultiplier: z.number(),
  })),
});

export const PhoneScriptDataSchema = z.object({
  facilityName: z.string(),
  statementDate: z.string(),
  totalBilled: z.number(),
  totalCmsBaseline: z.number(),
  totalSavings: z.number(),
  averageMultiplier: z.number(),
  reportId: z.string(),
  topFindings: z.array(z.object({
    cptCode: z.string(),
    description: z.string(),
    billedAmount: z.number(),
    cmsRateUsed: z.number(),
    overchargeMultiplier: z.number(),
  })),
});

export type DisputeLetterData = z.infer<typeof DisputeLetterDataSchema>;
export type PhoneScriptData = z.infer<typeof PhoneScriptDataSchema>;
