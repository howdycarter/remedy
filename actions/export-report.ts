import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { buildReport } from "../server/a11y/engine.js";

export default defineAction({
  description:
    "Generate the ACR/VPAT-style remediation report (Markdown) comparing the original HTML with the remediated HTML: before/after scores, a criteria table (Supports / Partially Supports with remarks), each resolved finding with its before/after source, and any remaining findings with their unapplied drafts. Also returns the remediated HTML for download. The report states findings against the evaluated criteria only — it is not a conformance certification.",
  mcpTool: true,
  schema: z.object({
    projectName: z.string().describe('Report title, e.g. "Juniper Café homepage remediation".'),
    pageLabel: z.string().describe('What was audited, e.g. "Homepage (seeded sample)" or a URL.'),
    originalHtml: z.string().describe("The HTML as first ingested, before any fixes."),
    fixedHtml: z.string().describe("The current HTML after approved fixes were applied."),
  }),
  outputSchema: z.object({
    markdown: z.string(),
    fixedHtml: z.string(),
    beforeScore: z.number(),
    afterScore: z.number(),
    fixedCount: z.number(),
    remainingCount: z.number(),
  }),
  run: async ({ projectName, pageLabel, originalHtml, fixedHtml }) => {
    const report = buildReport({
      projectName,
      generatedFor: pageLabel,
      originalHtml,
      fixedHtml,
    });
    return { ...report, fixedHtml };
  },
});
