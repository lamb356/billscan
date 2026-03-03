import { z } from 'zod';
import type { MatchMode, RateSource, Severity, DisputeStrength } from '../matcher/multi-matcher.js';

export const MatchModeSchema = z.enum(['exact', 'code+modifier', 'code_only', 'clfs', 'asp', 'opps', 'unmatched']);
export const RateSourceSchema = z.enum(['PFS', 'CLFS', 'ASP', 'OPPS']).nullable();
export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'fair']).nullable();
export const DisputeStrengthSchema = z.enum(['strong', 'moderate', 'weak']).nullable();

export const AuditFindingSchema = z.object({
  lineNumber: z.number().int().positive(),
  cptCode: z.string(),
  description: z.string().nullable(),
  billedAmount: z.number(),
  cmsFacilityRate: z.number().nullable(),
  cmsNonFacilityRate: z.number().nullable(),
  cmsRateUsed: z.number().nullable(),
  rateContext: z.enum(['facility', 'non_facility']),
  matchMode: MatchModeSchema,
  rateSource: RateSourceSchema,
  overchargeAmount: z.number().nullable(),
  overchargeMultiplier: z.number().nullable(),
  severity: SeveritySchema,
  disputeStrength: DisputeStrengthSchema,
  sourceUrl: z.string(),
  sourceEffectiveYear: z.number(),
  apc: z.string().nullable().optional(),
  dosage: z.string().nullable().optional(),
});

export type AuditFinding = z.infer<typeof AuditFindingSchema>;
