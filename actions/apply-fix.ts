import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description:
    "Apply ONE human-approved fix to an HTML document: replace the source span [start, end) recorded by run-audit with the (possibly human-edited) replacement text. This is the approval gate of the flow — call it only after the user has seen the before/after diff and approved it, in the UI or in chat. When expectedBefore is provided, the span is verified against it and the call fails rather than splicing the wrong location. Returns the corrected HTML; re-run run-audit on it to refresh findings and score.",
  mcpTool: true,
  schema: z.object({
    html: z.string().describe("The current HTML document the fix was drafted against."),
    start: z.number().describe("Start offset of the span to replace (from the finding's fix)."),
    end: z.number().describe("End offset of the span to replace (from the finding's fix)."),
    after: z
      .string()
      .describe("Replacement source for the span — the drafted fix, possibly edited by the human approver."),
    expectedBefore: z
      .string()
      .optional()
      .describe("The original source expected at the span (the finding's fix.before). Verified when provided and non-empty."),
  }),
  outputSchema: z.object({
    html: z.string(),
    message: z.string(),
  }),
  run: async ({ html, start, end, after, expectedBefore }) => {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > html.length
    ) {
      return fail(`Invalid span [${start}, ${end}) for a document of ${html.length} characters. Re-run run-audit to get fresh spans.`, {
        errorCode: "invalid_span",
      });
    }
    if (expectedBefore) {
      const actual = html.slice(start, end);
      if (actual !== expectedBefore) {
        return fail(
          "The document has changed since this fix was drafted (span content does not match). Re-run run-audit and draft the fix again — nothing was applied.",
          { errorCode: "stale_fix" },
        );
      }
    }
    const next = html.slice(0, start) + after + html.slice(end);
    return {
      html: next,
      message: `Fix applied at [${start}, ${end}). Document is now ${next.length} characters. Re-run run-audit to refresh findings.`,
    };
  },
});
