import { defineAction, fail } from "@agent-native/core/action";
import { readAppState, writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Apply ONE human-approved fix to an HTML document: replace the source span [start, end) recorded by run-audit with the (possibly human-edited) replacement text. This is the approval gate of the flow — call it only after the user has seen the before/after diff and approved it, in the UI or in chat. When expectedBefore is provided, the span is verified against it and the call fails rather than splicing the wrong location. Returns the corrected HTML; re-run run-audit on it to refresh findings and score.",
  mcpTool: true,
  // Human-in-the-loop, enforced by the framework: the agent loop pauses for the user's
  // approval before this runs, and a bare HTTP call cannot approve itself. The studio's
  // Approve button is the same approval, given in the app's own UI.
  needsApproval: true,
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
    updateStudio: z
      .boolean()
      .optional()
      .describe(
        "Set true when html came from get-studio-document, so the approved fix also lands in the page the user has open in the Remedy studio and their screen updates. Fails without applying if the studio's page has changed since you read it.",
      ),
  }),
  outputSchema: z.object({
    html: z.string(),
    message: z.string(),
  }),
  run: async ({ html, start, end, after, expectedBefore, updateStudio }) => {
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
    if (updateStudio) {
      const doc = (await readAppState("remedy-document")) as
        | { pageLabel?: string; originalHtml?: string; currentHtml?: string }
        | null;
      if (!doc?.currentHtml) {
        return fail("No page is open in the Remedy studio, so there is nothing to update — nothing was applied.", {
          errorCode: "studio_not_open",
        });
      }
      // Shell callers lose a trailing newline, so compare without trailing whitespace
      // and splice the studio's own copy (offsets are unaffected).
      if (doc.currentHtml.trimEnd() !== html.trimEnd()) {
        return fail(
          "The page in the Remedy studio has changed since you read it. Call get-studio-document and run-audit again — nothing was applied.",
          { errorCode: "stale_studio_document" },
        );
      }
      await writeAppState("remedy-document", {
        ...doc,
        currentHtml: doc.currentHtml.slice(0, start) + after + doc.currentHtml.slice(end),
        rev: Date.now(),
        source: "agent",
        lastFix: { before: html.slice(start, end), after },
      });
    }
    return {
      html: next,
      message:
        `Fix applied at [${start}, ${end}). Document is now ${next.length} characters. Re-run run-audit to refresh findings.` +
        (updateStudio ? " The studio page on the user's screen was updated." : ""),
    };
  },
});
