import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Return the page the user currently has open in the Remedy studio: its label, the HTML as first ingested, and the current HTML with every fix approved so far. Call this before run-audit or apply-fix when the user asks about, or wants help with, the page on their screen, so you work on their document rather than a fresh copy.",
  mcpTool: true,
  readOnly: true,
  schema: z.object({}),
  outputSchema: z.object({
    open: z.boolean(),
    pageLabel: z.string(),
    originalHtml: z.string(),
    html: z.string(),
  }),
  run: async () => {
    const doc = (await readAppState("remedy-document")) as
      | { pageLabel?: string; originalHtml?: string; currentHtml?: string }
      | null;
    if (!doc?.currentHtml) return { open: false, pageLabel: "", originalHtml: "", html: "" };
    return {
      open: true,
      pageLabel: doc.pageLabel ?? "",
      originalHtml: doc.originalHtml ?? doc.currentHtml,
      html: doc.currentHtml,
    };
  },
});
