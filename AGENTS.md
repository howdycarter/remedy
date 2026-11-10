# Chat — Agent Guide

Chat is the minimal chat-first agent-native app. `/` redirects to shared sign-in, then `/home`, the editable Get started page. Chat lives at `/chat`; new chats start there. Actions carry capabilities; screens exist only for durable workflows.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/build-an-app/SKILL.md` — start here for vague requests to create a domain app. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data/integrations: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Agent context/workflows: `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"`, `pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`, `pnpm action source-search --query "<pattern>"`, `pnpm action source-search --path <path>`, or `pnpm action source-search --list`. For external-agent integrations, read `pnpm action docs-search --slug "external-agents"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Normal app data must flow through actions. Keep actions deterministic and focused; use agent chat/AgentSidebar for AI work and follow-ups in the same thread. Keep structured state in SQL and large files in configured storage; persist references only.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, or private/customer data.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.

For custom branding, keep `server/plugins/agent-native-email-branding.ts` aligned: `app.name` appears in transactional email and optional `app.logoUrl` must be an absolute HTTPS URL.

## Application state

- `navigation` describes the view and selected ids. Chat is `chat` at `/chat` and `/chat/<threadId>`; the Get started page is `home` at `/home`; `/` opens shared sign-in/signup.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. The default Get started page lives at `/home`, and Chat stays at `/chat`; edit `app/routes/home.tsx` when replacing that page with a domain-specific home. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.


---

# Remedy — Accessibility Remediation Studio

Remedy is the domain app built on this Chat template for the Builder.io
Agent-Native Hackathon (deadline Nov 9, 2026, 11:59 PM PT). The studio
lives at `/remedy` (`app/routes/remedy.tsx`); `app.homePath` points
there. Disclosure for the submission description: the app is built on
the Agent-Native **chat template** (pre-existing framework code by
Builder.io); everything under `server/a11y/`, the seven actions below,
the seeded sample pages, and the `/remedy` studio UI are new work for
this hackathon.

## The workflow

One job, end to end: **ingest → audit → prioritize → approve → export.**

| Action | What it does |
|---|---|
| `list-samples` | List the 3 seeded broken sample pages (café, checkout, article). The demo path — never depend on a live fetch. |
| `get-sample` | Return one sample's HTML by id. |
| `ingest-page` | Accept pasted HTML or fetch a public URL. Bonus path only. |
| `run-audit` | Deterministic WCAG rule engine over static HTML (`server/a11y/engine.ts`). Findings carry WCAG criterion, severity, the offending element, and a drafted fix. No model calls. |
| `prioritize-findings` | The same findings as a deterministic work order with plain-language rationale (severity → level → blocks interaction). |
| `apply-fix` | Splice ONE approved fix into the document at its recorded span; verifies `expectedBefore` and fails rather than splicing a stale location. |
| `get-studio-document` | Return the page the user has open in the studio (label, original HTML, current HTML). Use it so you work on their page, not a fresh copy. |
| `export-report` | ACR/VPAT-style Markdown report: before/after scores, criteria table, resolved findings with before/after, remaining findings. Not a certification. |

## Agent conduct rules (the product's core promise)

- **Never call `apply-fix` without the user's approval of that specific
  diff.** Show the before/after in chat first and get an explicit yes —
  in chat, the same as the UI's Approve button. If the drafted wording
  is a placeholder (`needsHumanWording`), say so and ask the user for
  the real wording before applying.
- The engine is deterministic on purpose: never invent findings the
  audit did not return, never soften a severity, and never describe a
  clean run as "WCAG compliant" or "certified". Approved language:
  "no findings against the 12 criteria Remedy evaluates" — the scope
  footer in the UI and the report's About section carry the full
  limitation statement.
- `apply-fix` sets the framework's `needsApproval`: the agent loop pauses
  for the user's approval, and a bare HTTP call is refused. Do not look
  for a way around it.
- When `view-screen` shows `remedyStudio`, the user has a page open in
  the studio. Read it with `get-studio-document`, audit that HTML, and
  pass `updateStudio: true` to `apply-fix` so the approved fix appears
  on their screen. Never work on a fresh copy of a page they have open.
- After every `apply-fix`, re-run `run-audit` on the new HTML before
  reporting state — spans from the old audit are stale.
- When calling `export-report`, pass `appliedFixes` with each fix as it
  was approved (the `after` text sent to `apply-fix`, plus the draft as
  `draftedAfter`). The report prints the approved wording, never an
  unapplied draft.
- Prefer the seeded samples for demonstrations. If a live fetch fails,
  say so and fall back to a sample; do not retry blindly.

## Engine notes

- Rules: html-lang, document-title, img-alt (+filename variant),
  input-label, button-name, link-name, heading-order, empty-heading,
  duplicate-id, positive-tabindex, contrast-insufficient (only where
  colors are declared in the document), table-headers, frame-title,
  viewport-zoom — 12 WCAG 2.1 criteria.
- `scripts/verify-flow.ts` runs the whole flow headlessly against all
  three samples and asserts the GO/NO-GO bar; run it after any engine
  or action change.
