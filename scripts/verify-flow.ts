/**
 * Headless end-to-end verification of the Remedy flow (the GO/NO-GO bar):
 * for every seeded sample — audit → findings exist → prioritize → apply
 * every drafted fix through the same span-splice apply-fix uses,
 * re-auditing after each → findings resolve and score improves.
 * Then export-report is generated for one sample and sanity-checked.
 *
 * Run: pnpm exec tsx scripts/verify-flow.ts
 */
import { auditHtml, prioritizeFindings, buildReport } from "../server/a11y/engine.js";
import { SAMPLES } from "../server/a11y/samples.js";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function applyAllFixes(html: string): { html: string; applied: number; stuck: string[] } {
  let current = html;
  let applied = 0;
  const stuck: string[] = [];
  let noProgress = 0;
  for (let iter = 0; iter < 120; iter++) {
    const audit = auditHtml(current);
    const target = audit.findings.find((f) => f.fix);
    if (!target || !target.fix) break;
    const before = current.slice(target.fix.start, target.fix.end);
    if (before !== target.fix.before) {
      stuck.push(`${target.ruleId}: span mismatch (parser/span bug)`);
      break;
    }
    const next = current.slice(0, target.fix.start) + target.fix.after + current.slice(target.fix.end);
    const nextTotal = auditHtml(next).total;
    if (nextTotal >= audit.total) {
      noProgress++;
      if (noProgress >= 3) {
        stuck.push(`${target.ruleId}: applying drafted fixes is not reducing findings`);
        break;
      }
    } else {
      noProgress = 0;
    }
    current = next;
    applied++;
  }
  return { html: current, applied, stuck };
}

const EXPECTED_RULES: Record<string, string[]> = {
  cafe: ["html-lang", "document-title", "img-alt", "link-name", "button-name", "heading-order", "duplicate-id", "contrast-insufficient"],
  checkout: ["input-label", "positive-tabindex", "viewport-zoom", "table-headers", "frame-title", "contrast-insufficient"],
  article: ["html-lang", "document-title", "img-alt-filename", "heading-order", "empty-heading", "link-name", "contrast-insufficient"],
};

for (const sample of SAMPLES) {
  console.log(`\n=== Sample: ${sample.id} (${sample.name}) ===`);
  const audit = auditHtml(sample.html);
  console.log(
    `  audit: score=${audit.score} total=${audit.total} counts=${JSON.stringify(audit.counts)}`,
  );
  console.log(`  rules fired: ${[...new Set(audit.findings.map((f) => f.ruleId))].join(", ")}`);
  check("audit returns findings", audit.total > 0, `${audit.total} findings`);
  check("every finding has a drafted fix", audit.findings.every((f) => f.fix !== null));
  for (const rule of EXPECTED_RULES[sample.id] ?? []) {
    check(`expected rule fires: ${rule}`, audit.findings.some((f) => f.ruleId === rule));
  }

  const prio = prioritizeFindings(audit);
  check(
    "prioritization covers every finding",
    prio.priorities.length === audit.total,
    `${prio.priorities.length} ordered`,
  );
  if (audit.counts.critical > 0) {
    check(
      "top priority is a critical finding",
      audit.findings.find((f) => f.id === prio.priorities[0]?.findingId)?.severity === "critical",
      prio.priorities[0]?.title ?? "none",
    );
  }

  const { html: fixed, applied, stuck } = applyAllFixes(sample.html);
  const after = auditHtml(fixed);
  console.log(`  applied ${applied} fixes → score=${after.score} remaining=${after.total}`);
  check("no stuck fixes", stuck.length === 0, stuck.join("; "));
  check("all fixable findings resolved", after.total === 0, `${after.total} remaining`);
  check("score reaches 100 after full remediation", after.score === 100, `${after.score}`);

  if (sample.id === "cafe") {
    const report = buildReport({
      projectName: "Remedy verification — café sample",
      generatedFor: sample.name,
      originalHtml: sample.html,
      fixedHtml: fixed,
    });
    check("report generated", report.markdown.includes("Accessibility Remediation Report"));
    check("report has criteria table", report.markdown.includes("Table 1"));
    check(
      "report counts match",
      report.fixedCount === audit.total && report.remainingCount === 0,
      `${report.fixedCount} resolved / ${report.remainingCount} remaining`,
    );
    check(
      "report carries the not-a-certification statement",
      report.markdown.includes("not a certification"),
    );
  }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
