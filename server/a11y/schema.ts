import { z } from "zod";

export const findingFixSchema = z.object({
  start: z.number(),
  end: z.number(),
  before: z.string(),
  after: z.string(),
  description: z.string(),
  needsHumanWording: z.boolean(),
});

export const findingSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  title: z.string(),
  wcag: z.string(),
  level: z.enum(["A", "AA"]),
  severity: z.enum(["critical", "serious", "moderate", "minor"]),
  selector: z.string(),
  snippet: z.string(),
  message: z.string(),
  fix: findingFixSchema.nullable(),
});

export const auditResultSchema = z.object({
  score: z.number(),
  total: z.number(),
  counts: z.object({
    critical: z.number(),
    serious: z.number(),
    moderate: z.number(),
    minor: z.number(),
  }),
  documentScope: z.boolean(),
  criteriaEvaluated: z.array(z.string()),
  findings: z.array(findingSchema),
});
