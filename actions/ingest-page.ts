import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description:
    "Ingest a page for auditing: either pass raw HTML directly (html) or a public URL to fetch (url). Returns the HTML to feed into run-audit. Prefer the seeded samples (list-samples / get-sample) for demos — live fetches can fail or return script-rendered shells.",
  mcpTool: true,
  schema: z.object({
    url: z
      .string()
      .optional()
      .describe("Public http(s) URL to fetch. Ignored when html is provided."),
    html: z
      .string()
      .optional()
      .describe("Raw HTML source to audit directly."),
  }),
  outputSchema: z.object({
    source: z.enum(["paste", "url"]),
    url: z.string().nullable(),
    html: z.string(),
    bytes: z.number(),
  }),
  run: async ({ url, html }) => {
    if (html && html.trim()) {
      return { source: "paste" as const, url: null, html, bytes: html.length };
    }
    if (!url) {
      return fail("Provide either html (pasted source) or url (a page to fetch).", {
        errorCode: "missing_input",
      });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail(`"${url}" is not a valid URL.`, { errorCode: "invalid_url" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fail("Only http and https URLs can be fetched.", { errorCode: "invalid_url" });
    }
    let res: Response;
    try {
      res = await fetch(parsed.toString(), {
        signal: AbortSignal.timeout(12_000),
        headers: { "user-agent": "Remedy/1.0 (accessibility audit)" },
        redirect: "follow",
      });
    } catch (err) {
      return fail(
        `Fetching ${url} failed: ${err instanceof Error ? err.message : String(err)}. Paste the page source instead, or use a seeded sample.`,
        { errorCode: "fetch_failed", statusCode: 502 },
      );
    }
    if (!res.ok) {
      return fail(`Fetching ${url} returned HTTP ${res.status}. Paste the page source instead.`, {
        errorCode: "fetch_failed",
        statusCode: 502,
      });
    }
    const text = await res.text();
    if (!/<[a-z][\s\S]*>/i.test(text)) {
      return fail(`The response from ${url} does not look like HTML.`, {
        errorCode: "not_html",
      });
    }
    return { source: "url" as const, url: parsed.toString(), html: text, bytes: text.length };
  },
});
