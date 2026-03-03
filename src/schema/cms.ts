import { z } from 'zod';

export const CMSRateSchema = z.object({
  hcpcsCode: z.string().regex(/^[A-Z0-9]{5}$/i),
  modifier: z.string().optional(),
  description: z.string().optional(),
  facilityRate: z.number().optional(),
  nonFacilityRate: z.number().optional(),
  localityCode: z.string().optional(),
  statusCode: z.string().optional(),
  effectiveYear: z.number().int(),
});

export type CMSRate = z.infer<typeof CMSRateSchema>;
