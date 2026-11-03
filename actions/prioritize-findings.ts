import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { auditHtml, prioritizeFindings } from "../server/a11y/engine.js";

export default defineAction({
  description:
    "Re-audit an HTML document and return the findings as a deterministic work order: severity first, then WCAG level (A before AA), then whether the finding blocks interaction — each with a plain-language rationale the agent or UI can present. Use this to decide what to fix first and to explain the order to the user.",
  mcpTool: true,
  schema: z.object({
    html: z.string().describe("The HTML document whose findings should be prioritized."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    priorities: z.array(
      z.object({
        findingId: z.string(),
        ruleId: z.string(),
        title: z.string(),
        rank: z.number(),
        priorityScore: z.number(),
        rationale: z.string(),
      }),
    ),
  }),
  run: async ({ html }) => {
    return prioritizeFindings(auditHtml(html));
  },
});
