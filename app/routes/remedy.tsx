import { useMemo, useState } from "react";
import { useActionQuery, callAction } from "@agent-native/core/client/hooks";

export function meta() {
  return [
    { title: "Remedy — Accessibility Remediation Studio" },
    {
      name: "description",
      content:
        "Paste a page, run a deterministic WCAG audit, approve drafted fixes, and export corrected HTML with an ACR-style remediation report.",
    },
  ];
}

type Severity = "critical" | "serious" | "moderate" | "minor";

interface FindingFix {
  start: number;
  end: number;
  before: string;
  after: string;
  description: string;
  needsHumanWording: boolean;
}

interface Finding {
  id: string;
  ruleId: string;
  title: string;
  wcag: string;
  level: "A" | "AA";
  severity: Severity;
  selector: string;
  snippet: string;
  message: string;
  fix: FindingFix | null;
}

interface AuditResult {
  score: number;
  total: number;
  counts: Record<Severity, number>;
  documentScope: boolean;
  criteriaEvaluated: string[];
  findings: Finding[];
}

interface AppliedFix {
  ruleId: string;
  selector: string;
  snippet: string;
  before: string;
  after: string;
  draftedAfter: string;
}

interface Report {
  markdown: string;
  fixedHtml: string;
  beforeScore: number;
  afterScore: number;
  fixedCount: number;
  remainingCount: number;
}

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "bg-red-100 text-red-900 border-red-300",
  serious: "bg-orange-100 text-orange-900 border-orange-300",
  moderate: "bg-amber-100 text-amber-900 border-amber-300",
  minor: "bg-neutral-100 text-neutral-800 border-neutral-300",
};

function findingKey(f: Finding): string {
  return `${f.ruleId}|${f.selector}|${f.fix?.before ?? f.snippet}`;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function RemedyRoute() {
  const samplesQuery = useActionQuery("list-samples", {});
  const samples = samplesQuery.data?.samples ?? [];

  const [pageLabel, setPageLabel] = useState("");
  const [pasteHtml, setPasteHtml] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [originalHtml, setOriginalHtml] = useState<string | null>(null);
  const [currentHtml, setCurrentHtml] = useState<string | null>(null);
  const [initialTotal, setInitialTotal] = useState<number | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [priorityMap, setPriorityMap] = useState<Record<string, { rank: number; rationale: string }>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<AppliedFix[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const sortedFindings = useMemo(() => {
    if (!audit) return [];
    const list = audit.findings.filter((f) => !dismissed.has(findingKey(f)));
    return list.sort((a, b) => {
      const ra = priorityMap[a.id]?.rank ?? 999;
      const rb = priorityMap[b.id]?.rank ?? 999;
      return ra - rb;
    });
  }, [audit, priorityMap, dismissed]);

  async function runAuditOn(html: string) {
    const result = (await callAction("run-audit", { html })) as AuditResult;
    setAudit(result);
    const prio = (await callAction("prioritize-findings", { html })) as {
      priorities: { findingId: string; rank: number; rationale: string }[];
    };
    const map: Record<string, { rank: number; rationale: string }> = {};
    for (const p of prio.priorities) map[p.findingId] = { rank: p.rank, rationale: p.rationale };
    setPriorityMap(map);
    return result;
  }

  async function loadHtml(html: string, label: string) {
    setOriginalHtml(html);
    setCurrentHtml(html);
    setPageLabel(label);
    setDismissed(new Set());
    setEdits({});
    setApplied([]);
    setReport(null);
    setError(null);
    setBusy("audit");
    setStatus(`Auditing ${label}…`);
    try {
      const result = await runAuditOn(html);
      setInitialTotal(result.total);
      setStatus(
        result.total === 0
          ? "Audit complete — no findings against the evaluated criteria."
          : `Audit complete — ${result.total} finding(s), score ${result.score}/100.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function loadSample(id: string) {
    setBusy("sample");
    setError(null);
    try {
      const sample = (await callAction("get-sample", { id }, { method: "GET" })) as {
        name: string;
        html: string;
      };
      await loadHtml(sample.html, sample.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function ingest(kind: "paste" | "url") {
    setBusy("ingest");
    setError(null);
    try {
      const res = (await callAction("ingest-page", kind === "paste" ? { html: pasteHtml } : { url: urlInput })) as {
        html: string;
      };
      await loadHtml(res.html, kind === "paste" ? "Pasted HTML" : urlInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function applyFinding(f: Finding) {
    if (!currentHtml || !f.fix) return;
    const key = findingKey(f);
    const after = edits[key] ?? f.fix.after;
    setBusy(`apply-${f.id}`);
    setError(null);
    try {
      const res = (await callAction("apply-fix", {
        html: currentHtml,
        start: f.fix.start,
        end: f.fix.end,
        after,
        expectedBefore: f.fix.before,
      })) as { html: string };
      setCurrentHtml(res.html);
      // Record what was approved, edits included, so the report prints it rather than the draft.
      const fix = f.fix;
      setApplied((prev) => [
        ...prev,
        { ruleId: f.ruleId, selector: f.selector, snippet: f.snippet, before: fix.before, after, draftedAfter: fix.after },
      ]);
      setReport(null);
      const result = await runAuditOn(res.html);
      setStatus(`Fix applied: ${f.title}. ${result.total} finding(s) remain, score ${result.score}/100.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function exportReport() {
    if (!originalHtml || !currentHtml) return;
    setBusy("export");
    setError(null);
    try {
      const res = (await callAction("export-report", {
        projectName: `Remedy remediation — ${pageLabel || "page"}`,
        pageLabel: pageLabel || "Page",
        originalHtml,
        fixedHtml: currentHtml,
        appliedFixes: applied,
      })) as Report;
      setReport(res);
      setStatus(`Report generated — ${res.fixedCount} resolved, ${res.remainingCount} remaining.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const resolvedEstimate =
    initialTotal !== null && audit ? Math.max(0, initialTotal - audit.total) : 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Remedy</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Accessibility Remediation Studio. A deterministic WCAG rule engine finds the
          failures, the agent orders the work and explains why, you approve every fix,
          and Remedy exports the corrected HTML with an ACR-style remediation report.
          The checks are code, not model guesses — the same page always gets the same audit.
        </p>
      </header>

      <div aria-live="polite" className="sr-only">
        {status}
      </div>
      {error ? (
        <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      <section aria-labelledby="input-heading" className="mb-6 rounded-xl border border-border bg-card p-4">
        <h2 id="input-heading" className="mb-3 text-base font-semibold">
          1 · Choose a page
        </h2>
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium">Seeded sample pages (no live fetch needed)</p>
          <div className="flex flex-wrap gap-2">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={busy !== null}
                onClick={() => loadSample(s.id)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                title={s.description}
              >
                {s.name}
              </button>
            ))}
            {samplesQuery.isLoading ? <span className="text-sm text-muted-foreground">Loading samples…</span> : null}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="paste-html" className="mb-1 block text-sm font-medium">
              Or paste HTML source
            </label>
            <textarea
              id="paste-html"
              value={pasteHtml}
              onChange={(e) => setPasteHtml(e.target.value)}
              rows={6}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
              placeholder="<!DOCTYPE html>…"
            />
            <button
              type="button"
              disabled={busy !== null || !pasteHtml.trim()}
              onClick={() => ingest("paste")}
              className="mt-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Audit pasted HTML
            </button>
          </div>
          <div>
            <label htmlFor="url-input" className="mb-1 block text-sm font-medium">
              Or fetch a public URL (bonus path — samples are the reliable demo)
            </label>
            <input
              id="url-input"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="https://example.com/page"
            />
            <button
              type="button"
              disabled={busy !== null || !urlInput.trim()}
              onClick={() => ingest("url")}
              className="mt-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Fetch &amp; audit
            </button>
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Prefer chat? Open <strong>Chat</strong> and say “Audit the café sample and fix
              the top findings.” The agent calls the exact same actions and shows you each
              diff for approval before applying anything.
            </p>
          </div>
        </div>
      </section>

      {audit ? (
        <section aria-labelledby="results-heading" className="mb-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 id="results-heading" className="text-base font-semibold">
              2 · Findings for {pageLabel}
            </h2>
            <span className="rounded-full border border-border bg-card px-3 py-1 text-sm font-semibold">
              Score {audit.score}/100
            </span>
            {(Object.keys(audit.counts) as Severity[]).map((sev) =>
              audit.counts[sev] > 0 ? (
                <span key={sev} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${SEVERITY_BADGE[sev]}`}>
                  {audit.counts[sev]} {sev}
                </span>
              ) : null,
            )}
            {initialTotal !== null ? (
              <span className="text-sm text-muted-foreground">
                {resolvedEstimate} resolved · {audit.total} open
                {dismissed.size > 0 ? ` · ${dismissed.size} dismissed` : ""}
              </span>
            ) : null}
          </div>

          {sortedFindings.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm">
              No open findings. Every drafted fix you approved is in the corrected HTML —
              export the report below to document the remediation.
            </p>
          ) : (
            <ol className="space-y-4">
              {sortedFindings.map((f) => {
                const key = findingKey(f);
                const prio = priorityMap[f.id];
                return (
                  <li key={key} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[f.severity]}`}>
                        {f.severity}
                      </span>
                      <h3 className="text-sm font-semibold">{f.title}</h3>
                      <span className="text-xs text-muted-foreground">
                        WCAG {f.wcag} · Level {f.level}
                        {prio ? ` · Fix order #${prio.rank}` : ""}
                      </span>
                    </div>
                    <p className="mb-1 font-mono text-xs text-muted-foreground">{f.selector}</p>
                    <p className="mb-2 text-sm">{f.message}</p>
                    {prio ? (
                      <p className="mb-3 text-xs italic text-muted-foreground">
                        Why this order: {prio.rationale}
                      </p>
                    ) : null}
                    <p className="mb-1 text-xs font-medium">Offending markup</p>
                    <pre className="mb-3 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">{f.snippet}</pre>
                    {f.fix ? (
                      <div>
                        <p className="mb-1 text-xs font-medium">
                          Drafted fix — {f.fix.description}
                          {f.fix.needsHumanWording ? (
                            <span className="ml-2 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
                              Wording is a draft — confirm it says the right thing
                            </span>
                          ) : null}
                        </p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`before-${f.id}`}>
                              Before
                            </label>
                            <pre
                              id={`before-${f.id}`}
                              className="max-h-40 overflow-auto rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-950"
                            >
                              {f.fix.before || "(insertion — nothing here yet)"}
                            </pre>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`after-${f.id}`}>
                              After — yours to edit before approving
                            </label>
                            <textarea
                              id={`after-${f.id}`}
                              value={edits[key] ?? f.fix.after}
                              onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                              rows={4}
                              className="w-full rounded-lg border border-green-300 bg-green-50 px-3 py-2 font-mono text-xs text-green-950"
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => applyFinding(f)}
                            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {busy === `apply-${f.id}` ? "Applying…" : "Approve & apply fix"}
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setDismissed((prev) => new Set(prev).add(key))}
                            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                          >
                            Dismiss finding
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No automatic fix drafted for this finding.</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}

      {originalHtml ? (
        <section aria-labelledby="export-heading" className="rounded-xl border border-border bg-card p-4">
          <h2 id="export-heading" className="mb-2 text-base font-semibold">
            3 · Export
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            The corrected HTML contains every fix you approved. The remediation report is
            ACR/VPAT-style: before/after scores, a criteria table, resolved findings with
            their before/after source, and anything still open.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || !currentHtml}
              onClick={() => download("remedy-corrected.html", currentHtml ?? "", "text/html")}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Download corrected HTML
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={exportReport}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {busy === "export" ? "Generating…" : "Generate remediation report"}
            </button>
            {report ? (
              <button
                type="button"
                onClick={() => download("remedy-report.md", report.markdown, "text/markdown")}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                Download report (.md)
              </button>
            ) : null}
          </div>
          {report ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">
                Preview report — score {report.beforeScore} → {report.afterScore},{" "}
                {report.fixedCount} resolved, {report.remainingCount} remaining
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                {report.markdown}
              </pre>
            </details>
          ) : null}
        </section>
      ) : null}

      <footer className="mt-6 text-xs text-muted-foreground">
        Scope, stated plainly: Remedy evaluates static HTML against 12 WCAG 2.1 criteria
        (listed in the report). It does not render the page, run JavaScript, or test
        keyboard interaction, and a clean run is not a conformance certification.
        Contrast is checked only where colors are declared in the document.
      </footer>
    </main>
  );
}
