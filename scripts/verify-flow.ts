/**
 * Headless end-to-end verification of the Remedy flow (the GO/NO-GO bar):
 * for every seeded sample — audit → findings exist → prioritize → apply
 * every drafted fix through the same span-splice apply-fix uses,
 * re-auditing after each → findings resolve and score improves.
 * Then export-report is generated for one sample and sanity-checked.
 *
 * Run: pnpm exec tsx scripts/verify-flow.ts
 */
import { auditHtml, prioritizeFindings, buildReport, type AppliedFix, type Finding } from "../server/a11y/engine.js";
import { SAMPLES } from "../server/a11y/samples.js";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/**
 * `review` stands in for the human: it receives the finding and its
 * drafted "after" text and returns the wording to approve.
 */
function applyAllFixes(
  html: string,
  review: (f: Finding, drafted: string) => string = (_f, drafted) => drafted,
): { html: string; applied: number; stuck: string[]; records: AppliedFix[] } {
  let current = html;
  let applied = 0;
  const stuck: string[] = [];
  const records: AppliedFix[] = [];
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
    const approved = review(target, target.fix.after);
    const next = current.slice(0, target.fix.start) + approved + current.slice(target.fix.end);
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
    records.push({
      ruleId: target.ruleId,
      selector: target.selector,
      snippet: target.snippet,
      before: target.fix.before,
      after: approved,
      draftedAfter: target.fix.after,
    });
  }
  return { html: current, applied, stuck, records };
}

/** Every "After" line in a report must quote text that is in the remediated HTML. */
function reportAfterLinesNotInHtml(markdown: string, fixedHtml: string): string[] {
  const haystack = fixedHtml.replace(/`/g, "'");
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("- **After") && !line.includes("later changed again"))
    .map((line) => line.slice(line.indexOf("`") + 1, line.lastIndexOf("`")))
    .filter((quoted) => !haystack.includes(quoted));
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

  const { html: fixed, applied, stuck, records } = applyAllFixes(sample.html);
  const after = auditHtml(fixed);
  console.log(`  applied ${applied} fixes → score=${after.score} remaining=${after.total}`);
  check("no stuck fixes", stuck.length === 0, stuck.join("; "));
  check("all fixable findings resolved", after.total === 0, `${after.total} remaining`);
  check("score reaches 100 after full remediation", after.score === 100, `${after.score}`);

  // The report must describe the remediated markup, with and without the applied-fix records.
  for (const [label, appliedFixes] of [["with applied-fix records", records], ["without records", undefined]] as const) {
    const r = buildReport({ projectName: "verify", generatedFor: sample.name, originalHtml: sample.html, fixedHtml: fixed, appliedFixes });
    const stray = reportAfterLinesNotInHtml(r.markdown, fixed);
    check(`report "After" lines match the remediated HTML (${label})`, stray.length === 0, stray.join(" | "));
  }

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

    // A reviewer rewrites the placeholder button label before approving it.
    const PLACEHOLDER = "Describe this button's action";
    const edited = applyAllFixes(sample.html, (f, drafted) =>
      f.ruleId === "button-name" ? drafted.replace(PLACEHOLDER, "Order online") : drafted,
    );
    check("edited fix is in the corrected HTML", edited.html.includes('aria-label="Order online"') && !edited.html.includes(PLACEHOLDER));
    check("edited run still reaches 100", auditHtml(edited.html).score === 100);
    for (const [label, appliedFixes] of [["with applied-fix records", edited.records], ["without records", undefined]] as const) {
      const r = buildReport({ projectName: "verify", generatedFor: sample.name, originalHtml: sample.html, fixedHtml: edited.html, appliedFixes });
      check(`report never prints the unapplied placeholder as "After" (${label})`, !r.markdown.includes(`aria-label="${PLACEHOLDER}"`));
      const stray = reportAfterLinesNotInHtml(r.markdown, edited.html);
      check(`edited report "After" lines match the remediated HTML (${label})`, stray.length === 0, stray.join(" | "));
      check(`edited report counts match (${label})`, r.fixedCount === audit.total && r.remainingCount === 0);
    }
    const withRecords = buildReport({ projectName: "verify", generatedFor: sample.name, originalHtml: sample.html, fixedHtml: edited.html, appliedFixes: edited.records });
    check("report prints the reviewer's wording", withRecords.markdown.includes('aria-label="Order online"'));
    check("report marks the fix as edited by the reviewer", withRecords.markdown.includes("wording edited by the reviewer before approval"));
  }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
