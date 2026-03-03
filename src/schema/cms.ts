import { z } from 'zod';

export const CMSRateSchema = z.object({
  cptCode: z.string(),
  modifier: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  facilityRate: z.number().nullable(),
  nonFacilityRate: z.number().nullable(),
  locality: z.string().nullable().default(null),
  localityName: z.string().nullable().default(null),
  statusIndicator: z.string().nullable().default(null),
  effectiveYear: z.number(),
});

export const CMSSnapshotSchema = z.object({
  sourceUrl: z.string(),
  effectiveYear: z.number(),
  fetchedAt: z.string(),
  dataHash: z.string(),
  rowCount: z.number(),
  fileName: z.string(),
});

export type CMSRate = z.infer<typeof CMSRateSchema>;
export type CMSSnapshot = z.infer<typeof CMSSnapshotSchema>;
