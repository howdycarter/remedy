# Remedy demo

Video: https://youtu.be/XHD_9z1XXL4 (2:35)

Hosted demo: https://remedy-sigma.vercel.app (no account needed)

Everything on screen is the real app running locally. The scores are read from the live studio, and each terminal command is run during the recording; its real output is what is shown. The narration is an AI-rendered voice and the music is synthesised.

## What the video shows

1. **Load a page.** The Juniper Café sample scores 14/100 with ten findings.
2. **Edit, then approve.** The top finding's drafted fix is a placeholder the engine flags. The reviewer changes it to `aria-label="Order online"` and approves: 14 → 26.
3. **The agent on the same page.** `view-screen` returns the studio's page, score and open findings. `apply-fix` from the agent side is stopped with "requires human approval". Approved, the fix lands in the open studio page, which re-audits: 26 → 38.
4. **Approve the rest.** Nine approvals in total: 14 → 26 → 38 → 50 → 69 → 76 → 83 → 90 → 97 → 100.
5. **Export.** The corrected HTML and an ACR-style report. The report states it is not a certification and records the reviewer's edited wording.
6. **Outside the app.** A plain HTTP call to `apply-fix` is refused; `run-audit` from the command line returns the same 14.
7. **Check it yourself.** `pnpm verify` ends with `ALL CHECKS PASSED`.

## Narration

| Time | Line |
|---|---|
| 00:00 | Remedy finds a page's accessibility failures, drafts the fixes, and keeps a person in charge of every change. |
| 00:07 | Start with a page. Here, a small café's homepage. |
| 00:12 | It scores 14 out of 100. Ten WCAG failures: four critical, five serious, one moderate. |
| 00:20 | A deterministic rule engine found them. No model call, so the same page always gets the same audit. |
| 00:28 | Every finding arrives with a drafted fix. The engine flags this one: it cannot know what the button does. |
| 00:37 | A person can. Edit the fix… |
| 00:42 | …then approve it. Nothing is applied until a person says so. |
| 00:47 | Applied, then re-audited straight away. 14 becomes 26. |
| 00:52 | The agent works on the same page. This is what it sees: the page, the score, the open findings. |
| 00:59 | It can draft the next fix, but it cannot apply it alone. The framework stops it until a person approves. |
| 01:07 | With approval, the fix lands in the page on screen, and the studio re-audits. 26 becomes 38. |
| 01:15 | Each remaining fix is a specific before-and-after. Approve them one at a time. |
| 01:34 | Nine approvals. 14 to 100, on the 12 WCAG criteria Remedy checks. |
| 01:44 | Export the corrected HTML and an ACR-style remediation report. |
| 01:51 | The report says what was checked and what was not. It is not a certification. |
| 01:58 | It records each fix as approved, including the reviewer's own wording. |
| 02:04 | Outside the app, the same gate holds. A plain HTTP call cannot approve its own fix. |
| 02:11 | From the command line: the same audit, the same 14. |
| 02:17 | Check it yourself: clone github.com/howdycarter/remedy, then pnpm install && pnpm verify. |

## Reproduce it

```bash
pnpm install
pnpm verify   # must print ALL CHECKS PASSED
pnpm dev      # then open /remedy and load the Juniper Café sample
```
