import { z } from 'zod';
import { AuditFindingSchema } from './finding.js';

export const TransparencyStampSchema = z.object({
  reportId: z.string().uuid(),
  inputHash: z.string(),
  cmsSnapshotId: z.number().int(),
  cmsDataHash: z.string(),
  cmsEffectiveYear: z.number().int(),
  generatedAt: z.string(),
  toolVersion: z.string(),
  hashAlgorithm: z.string(),
  dataSources: z.array(z.string()),
});

export const AuditReportSchema = z.object({
  stamp: TransparencyStampSchema,
  facilityName: z.string().optional(),
  facilityType: z.string().optional(),
  totalBilled: z.number(),
  totalCmsBaseline: z.number(),
  totalPotentialSavings: z.number(),
  matchedLineCount: z.number().int(),
  unmatchedLineCount: z.number().int(),
  findings: z.array(AuditFindingSchema),
  summary: z.object({
    topOvercharges: z.array(z.object({
      cptCode: z.string(),
      description: z.string().nullable(),
      billedAmount: z.number(),
      cmsRate: z.number(),
      savings: z.number(),
    })),
    overchargeByCategory: z.record(z.number()),
    averageMultiplier: z.number().nullable(),
  }),
});

export type TransparencyStamp = z.infer<typeof TransparencyStampSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
