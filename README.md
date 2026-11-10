# Remedy — Accessibility Remediation Studio

Paste a page (or load a seeded sample) → run a deterministic WCAG rule engine → approve drafted fixes → export corrected HTML + an ACR-style remediation report.

Built on Builder.io's open-source **Agent-Native** framework (`defineAction()` from `@agent-native/core`) for the [Agent-Native Hackathon](https://www.builder.io/hackathon).

## Demo path (no live fetch required)

1. Open `/remedy` (sidebar: **Remedy studio**).
2. Load a seeded sample: **Juniper Café**, **Northwind checkout**, or **Community news**.
3. Review prioritized findings (severity carries a drafted fix).
4. Approve fixes one by one — each apply re-audits so spans stay fresh.
5. Export corrected HTML + markdown remediation report.

Headless GO/NO-GO check (audit → prioritize → apply → re-audit → report):

```bash
pnpm verify
```

## Same action, any caller

Each capability is one `defineAction`. The studio UI, the in-app agent, the CLI, HTTP and MCP clients all call the same code.

From a terminal — no browser, no model call, no API keys:

```bash
pnpm action list-samples
pnpm action run-audit --html "$(cat page.html)"   # score + findings
```

Over HTTP, with `pnpm dev` running (`$APP` is the URL it prints; local dev with `AUTH_DISABLED=true` in `.env`):

```bash
curl -s -X POST $APP/_agent-native/actions/run-audit \
  -H 'content-type: application/json' \
  -d '{"html":"<html><body><img src=\"a.png\"></body></html>"}'
```

The Juniper Café sample returns `score: 14, total: 10` from the studio, the CLI and HTTP alike. The same seven actions are exposed as MCP tools at `$APP/mcp` (needs an access token: `pnpm exec agent-native mcp token`).

The approval check lives in the action, not the button: `apply-fix` verifies `expectedBefore` and refuses a fix drafted against a different document, whoever calls it.

## What is new vs the chat template

This app starts from the Agent-Native **chat** template. New hackathon work:

- `server/a11y/` — parser, contrast math, 12-criterion WCAG rule engine, seeded samples, report builder
- Actions: `list-samples`, `get-sample`, `ingest-page`, `run-audit`, `prioritize-findings`, `apply-fix`, `export-report`
- UI: `/remedy` studio (`app/routes/remedy.tsx`) + sidebar entry

A clean audit is **not** a WCAG certification — findings are against the 12 criteria Remedy evaluates on static HTML only.

## Develop

```bash
corepack enable
pnpm install
pnpm verify   # engine E2E, no API keys
pnpm dev      # full app (needs Agent-Native local runtime)
```

Requires Node ≥ 22.22.

## License / IP

Entrant retains IP per hackathon rules. Framework code remains under its upstream licenses.
