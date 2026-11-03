import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { SAMPLES } from "../server/a11y/samples.js";

export default defineAction({
  description:
    "List Remedy's seeded sample pages. Each sample is a realistic page with deliberate accessibility failures, so the full audit → fix → export flow can run without fetching a live URL.",
  mcpTool: true,
  schema: z.object({}),
  http: { method: "GET" },
  outputSchema: z.object({
    samples: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
      }),
    ),
  }),
  run: async () => {
    return {
      samples: SAMPLES.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    };
  },
});
