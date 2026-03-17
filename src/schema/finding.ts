import { z } from 'zod';

export const MatchModeSchema = z.enum([
  'exact_code_modifier_locality',
  'exact_code_modifier',
  'exact_code_only',
  'unmatched',
]);

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'extreme']);

export const RateSourceSchema = z.enum(['pfs', 'clfs', 'asp', 'opps']).nullable();

export const AuditFindingSchema = z.object({
  lineNumber: z.number(),
  cptCode: z.string(),
  description: z.string(),
  billedAmount: z.number(),
  cmsFacilityRate: z.number().nullable(),
  cmsNonFacilityRate: z.number().nullable(),
  cmsRateUsed: z.number().nullable(),
  rateContext: z.enum(['facility', 'non_facility']),
  matchMode: MatchModeSchema,
  rateSource: RateSourceSchema.optional(),
  overchargeAmount: z.number().nullable(),
  overchargeMultiplier: z.number().nullable(),
  severity: SeveritySchema.nullable(),
  disputeStrength: z.enum(['strong', 'moderate', 'weak', 'none']).nullable(),
  sourceUrl: z.string(),
  sourceEffectiveYear: z.number(),
  apc: z.string().nullable().optional(),
  dosage: z.string().nullable().optional(),
  notes: z.string().optional(),
});

export type MatchMode = z.infer<typeof MatchModeSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type RateSource = z.infer<typeof RateSourceSchema>;
export type AuditFinding = z.infer<typeof AuditFindingSchema>;
