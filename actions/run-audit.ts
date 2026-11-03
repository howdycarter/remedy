import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { auditHtml } from "../server/a11y/engine.js";
import { auditResultSchema } from "../server/a11y/schema.js";

export default defineAction({
  description:
    "Run Remedy's deterministic WCAG rule engine over an HTML document. Returns findings grouped by severity, each with the WCAG criterion, the offending element, and a drafted fix (before/after source). No model is involved — the same input always produces the same findings. Follow with prioritize-findings for a work order, apply-fix to apply an approved fix, and export-report for the remediation report.",
  mcpTool: true,
  schema: z.object({
    html: z.string().describe("The full HTML document (or fragment) to audit."),
  }),
  outputSchema: auditResultSchema,
  run: async ({ html }) => {
    return auditHtml(html);
  },
});
