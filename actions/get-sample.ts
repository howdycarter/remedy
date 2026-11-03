import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";
import { getSample } from "../server/a11y/samples.js";

export default defineAction({
  description:
    "Get one seeded sample page's HTML by id (from list-samples). Feed the returned html into run-audit to start the remediation flow without any live fetch.",
  mcpTool: true,
  schema: z.object({
    id: z.string().describe('Sample id, e.g. "cafe", "checkout", or "article"'),
  }),
  http: { method: "GET" },
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    html: z.string(),
  }),
  run: async ({ id }) => {
    const sample = getSample(id);
    if (!sample) {
      return fail(`No sample page with id "${id}". Call list-samples for the available ids.`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    return sample;
  },
});
