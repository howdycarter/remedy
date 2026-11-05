# Clips demo script (CHR-2000) — do not submit until Chris says file

Target length: 90–120 seconds. Record against a local `pnpm dev` or a draft deploy.
Never depend on a live URL fetch.

## Shot list

1. **Cold open (5s)** — Home shows “Remedy” + **Open Remedy studio**. Click it.
2. **Studio load (10s)** — Click seeded sample **Juniper Café**. Audit runs; score ~14 with critical/serious badges.
3. **Priorities (15s)** — Scroll findings; call out that every finding has a drafted fix and ranks are severity-first.
4. **Approve one fix (20s)** — Apply the top critical (e.g. button name / lang / title). Status updates; score rises; finding count drops.
5. **Approve two more (20s)** — Show re-audit after each apply (spans stay valid).
6. **Export (15s)** — Generate report; download `remedy-corrected.html` + `remedy-report.md`. Flash the “not a certification” line.
7. **Agent-Native beat (15s)** — Open chat; ask “list samples then audit the café page.” Show defineAction tools firing (`list-samples` → `get-sample` → `run-audit`).
8. **Close (5s)** — Back to studio score/report. “Deterministic rules + human approval — same page, same audit.”

## Voiceover beats

- Required tech: Agent-Native `defineAction()` — Fusion/Visual Editor not used.
- Engine is code, not model guesses; agent prioritizes and explains; human approves.
- Three seeded samples so the demo never needs the network.

## Pre-flight

```bash
pnpm verify   # must print ALL CHECKS PASSED
pnpm dev
```

Hard gates: no hackathon form submit until Chris says file.
