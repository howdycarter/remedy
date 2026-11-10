import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useActionQuery,
  callAction,
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { TAB_ID } from "@/lib/tab-id";

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

const SEVERITY: Record<Severity, { label: string; chip: string; rail: string }> = {
  critical: {
    label: "Critical",
    chip: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200",
    rail: "bg-red-600",
  },
  serious: {
    label: "Serious",
    chip: "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-200",
    rail: "bg-orange-500",
  },
  moderate: {
    label: "Moderate",
    chip: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
    rail: "bg-amber-400",
  },
  minor: {
    label: "Minor",
    chip: "border-border bg-muted text-foreground",
    rail: "bg-neutral-400",
  },
};

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
const FIELD =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepHeading({ n, id, title, hint }: { n: number; id: string; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
      >
        {n}
      </span>
      <div>
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  const tone = score >= 90 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600";
  return (
    <div className="relative h-[68px] w-[68px] shrink-0" role="img" aria-label={`Score ${score} out of 100`} data-score={score}>
      <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
        <circle cx="34" cy="34" r={r} fill="none" strokeWidth="7" stroke="currentColor" className="text-muted" />
        <circle
          cx="34"
          cy="34"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          className={`${tone} transition-[stroke-dashoffset] duration-700 ease-out`}
        />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums">
        {score}
      </span>
    </div>
  );
}

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

/** Renders the report's Markdown (headings, tables, lists, bold, code) as a readable document. */
function ReportDocument({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
    } else if (line.startsWith("### ")) {
      blocks.push(
        <h5 key={i} className="mt-5 border-t border-border pt-4 text-sm font-semibold text-foreground">
          {inlineMarkdown(line.slice(4))}
        </h5>,
      );
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h4 key={i} className="mt-7 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {inlineMarkdown(line.slice(3))}
        </h4>,
      );
      i++;
    } else if (line.startsWith("# ")) {
      blocks.push(
        <h3 key={i} className="text-lg font-semibold tracking-tight text-foreground">
          {inlineMarkdown(line.slice(2))}
        </h3>,
      );
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      const start = i;
      while (i < lines.length && (lines[i] ?? "").startsWith("|")) {
        const row = lines[i] ?? "";
        if (!/^\|[\s|:-]+\|?$/.test(row)) rows.push(row.split("|").slice(1, -1).map((cell) => cell.trim()));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={start} className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/60">
              <tr>
                {(head ?? []).map((cell, c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-semibold text-foreground">
                    {inlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="border-t border-border align-top">
                  {row.map((cell, c) => (
                    <td key={c} className={`px-3 py-2 ${c === 0 ? "font-medium text-foreground" : ""}`}>
                      {inlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      const start = i;
      while (i < lines.length && (lines[i] ?? "").startsWith("- ")) {
        items.push((lines[i] ?? "").slice(2));
        i++;
      }
      blocks.push(
        <ul key={start} className="mt-2 space-y-1.5 text-sm">
          {items.map((item, n) => (
            <li key={n}>{inlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
    } else if (line.trim() === "---") {
      blocks.push(<hr key={i} className="mt-6 border-border" />);
      i++;
    } else if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) {
      blocks.push(
        <p key={i} className="mt-3 text-xs text-muted-foreground">
          {line.slice(1, -1)}
        </p>,
      );
      i++;
    } else {
      blocks.push(
        <p key={i} className="mt-2 text-sm leading-relaxed">
          {inlineMarkdown(line)}
        </p>,
      );
      i++;
    }
  }
  return <div className="text-muted-foreground">{blocks}</div>;
}

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

  // ---- Shared state: the agent sees the page that is open here, and its approved fixes land here.
  const docRev = useRef(0);
  useEffect(() => {
    if (!originalHtml || !currentHtml) return;
    const rev = Date.now();
    docRev.current = rev;
    void writeClientAppState(
      "remedy-document",
      { pageLabel, originalHtml, currentHtml, rev, source: TAB_ID },
      { requestSource: TAB_ID },
    ).catch(() => {});
  }, [pageLabel, originalHtml, currentHtml]);

  useEffect(() => {
    if (!audit || !currentHtml) return;
    void writeClientAppState(
      "remedy-studio",
      {
        page: pageLabel,
        score: audit.score,
        openFindings: audit.total,
        resolved: resolvedEstimate,
        reportGenerated: report !== null,
        findings: sortedFindings.slice(0, 12).map((f) => ({
          fixOrder: priorityMap[f.id]?.rank ?? null,
          rule: f.ruleId,
          title: f.title,
          severity: f.severity,
          wcag: f.wcag,
          selector: f.selector,
          needsHumanWording: f.fix?.needsHumanWording ?? false,
          draftedFix: f.fix
            ? { start: f.fix.start, end: f.fix.end, before: f.fix.before, after: edits[findingKey(f)] ?? f.fix.after }
            : null,
        })),
        updatedAt: new Date().toISOString(),
      },
      { requestSource: TAB_ID },
    ).catch(() => {});
  }, [pageLabel, audit, currentHtml, report, sortedFindings, priorityMap, edits, resolvedEstimate]);

  // Pick up a fix the agent applied to this page (apply-fix with updateStudio) and re-audit.
  useEffect(() => {
    if (!currentHtml) return;
    const timer = setInterval(async () => {
      if (busy !== null) return;
      const doc = await readClientAppState<{
        currentHtml?: string;
        rev?: number;
        source?: string;
        lastFix?: { before: string; after: string };
      }>("remedy-document").catch(() => null);
      if (!doc?.currentHtml || doc.source !== "agent" || !doc.rev || doc.rev <= docRev.current) return;
      if (doc.currentHtml === currentHtml) return;
      docRev.current = doc.rev;
      const fix = doc.lastFix;
      const finding = fix ? audit?.findings.find((f) => f.fix?.before === fix.before) : undefined;
      if (fix && finding?.fix) {
        const drafted = finding.fix.after;
        setApplied((prev) => [
          ...prev,
          { ruleId: finding.ruleId, selector: finding.selector, snippet: finding.snippet, before: fix.before, after: fix.after, draftedAfter: drafted },
        ]);
      }
      setCurrentHtml(doc.currentHtml);
      setReport(null);
      try {
        const result = await runAuditOn(doc.currentHtml);
        setStatus(`The agent applied an approved fix. ${result.total} finding(s) remain, score ${result.score}/100.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [currentHtml, audit, busy]);

  const totalAtStart = initialTotal ?? audit?.total ?? 0;
  const progress = totalAtStart > 0 ? Math.round((resolvedEstimate / totalAtStart) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Remedy · Accessibility remediation studio
        </p>
        <h1 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight">
          Fix a page&rsquo;s accessibility failures, one approved change at a time.
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          A deterministic rule engine audits static HTML against 12 WCAG 2.1 criteria and drafts a
          fix for every finding. Nothing is applied until you approve it, and the same page always
          gets the same audit.
        </p>
      </header>

      <div aria-live="polite" className="sr-only">
        {status}
      </div>
      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100"
        >
          {error}
        </div>
      ) : null}

      <section aria-labelledby="input-heading" className="mb-10">
        <StepHeading n={1} id="input-heading" title="Choose a page" hint="Start from a sample, or bring your own HTML." />
        <ul className="grid gap-3 sm:grid-cols-3">
          {samples.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => loadSample(s.id)}
                className="group flex h-full w-full flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="text-sm font-semibold">{s.name}</span>
                <span className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{s.description}</span>
                <span className="mt-3 text-xs font-medium text-foreground/80 group-hover:text-foreground">
                  Audit this page <span aria-hidden="true">→</span>
                </span>
              </button>
            </li>
          ))}
          {samplesQuery.isLoading ? <li className="text-sm text-muted-foreground">Loading samples…</li> : null}
        </ul>

        <div className="mt-4 grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-2">
          <div>
            <label htmlFor="paste-html" className="mb-1.5 block text-sm font-medium">
              Paste HTML source
            </label>
            <textarea
              id="paste-html"
              value={pasteHtml}
              onChange={(e) => setPasteHtml(e.target.value)}
              rows={4}
              className={`${FIELD} font-mono text-xs`}
              placeholder="<!DOCTYPE html>…"
            />
            <button
              type="button"
              disabled={busy !== null || !pasteHtml.trim()}
              onClick={() => ingest("paste")}
              className={`${BTN_SECONDARY} mt-2`}
            >
              Audit pasted HTML
            </button>
          </div>
          <div>
            <label htmlFor="url-input" className="mb-1.5 block text-sm font-medium">
              Fetch a public URL
            </label>
            <input
              id="url-input"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className={FIELD}
              placeholder="https://example.com/page"
            />
            <button
              type="button"
              disabled={busy !== null || !urlInput.trim()}
              onClick={() => ingest("url")}
              className={`${BTN_SECONDARY} mt-2`}
            >
              Fetch &amp; audit
            </button>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Remedy reads the HTML the server returns. Pages that need JavaScript to render are out of scope.
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Prefer to work in chat? Open <strong className="font-semibold text-foreground">New chat</strong> and ask the agent to
          &ldquo;audit the café sample and fix the top findings&rdquo;. It calls the same actions and asks before applying a fix.
        </p>
      </section>

      {audit ? (
        <section aria-labelledby="results-heading" className="mb-10">
          <StepHeading
            n={2}
            id="results-heading"
            title="Review and approve each fix"
            hint="Findings are in priority order. Edit any drafted fix before you approve it."
          />

          <div className="sticky top-0 z-10 -mx-2 mb-4 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center gap-4">
              <ScoreDial score={audit.score} />
              <div className="min-w-[14rem] flex-1">
                <p className="truncate text-sm font-semibold">{pageLabel}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Score <span className="font-semibold tabular-nums text-foreground">{audit.score}/100</span>
                  {" · "}
                  <span className="tabular-nums">
                    {resolvedEstimate} of {totalAtStart} resolved
                  </span>
                  {dismissed.size > 0 ? ` · ${dismissed.size} dismissed` : ""}
                </p>
                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Findings resolved"
                  aria-valuemin={0}
                  aria-valuemax={totalAtStart}
                  aria-valuenow={resolvedEstimate}
                >
                  <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-700 ease-out" style={{ width: `${progress}%` }} />
                </div>
                {status ? (
                  <p data-status className="mt-1.5 truncate text-xs text-muted-foreground">
                    {status}
                  </p>
                ) : null}
              </div>
              <ul className="flex flex-wrap items-center gap-2" aria-label="Open findings by severity">
                {(Object.keys(audit.counts) as Severity[]).map((sev) =>
                  audit.counts[sev] > 0 ? (
                    <li key={sev} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${SEVERITY[sev].chip}`}>
                      {audit.counts[sev]} {SEVERITY[sev].label.toLowerCase()}
                    </li>
                  ) : null,
                )}
                {audit.total === 0 ? (
                  <li className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
                    <CheckIcon className="h-3.5 w-3.5" /> No open findings
                  </li>
                ) : null}
              </ul>
            </div>
          </div>

          {sortedFindings.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <CheckIcon />
              </span>
              <div>
                <p className="text-sm font-semibold">No open findings against the criteria Remedy evaluates.</p>
                <p className="mt-0.5 text-sm">
                  Every fix you approved is in the corrected HTML. Export it below, with a report of what changed.
                </p>
              </div>
            </div>
          ) : (
            <ol className="space-y-4">
              {sortedFindings.map((f) => {
                const key = findingKey(f);
                const prio = priorityMap[f.id];
                return (
                  <li key={key} className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${SEVERITY[f.severity].rail}`} />
                    <div className="p-5 pl-6">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            WCAG {f.wcag} · Level {f.level}
                            <span className="mx-1.5" aria-hidden="true">
                              ·
                            </span>
                            <code className="font-mono">{f.selector}</code>
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {prio ? (
                            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                              Fix order #{prio.rank}
                            </span>
                          ) : null}
                          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY[f.severity].chip}`}>
                            {SEVERITY[f.severity].label}
                          </span>
                        </div>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed">{f.message}</p>
                      {prio ? (
                        <p className="mt-2 border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
                          <span className="font-medium text-foreground">Why this order.</span> {prio.rationale}
                        </p>
                      ) : null}

                      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Offending markup</p>
                      <pre className="mt-1.5 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">{f.snippet}</pre>

                      {f.fix ? (
                        <div className="mt-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Drafted fix</p>
                          <p className="mt-1.5 text-sm leading-relaxed">{f.fix.description}</p>
                          {f.fix.needsHumanWording ? (
                            <p
                              data-needs-wording
                              className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
                            >
                              <span className="font-semibold">Needs your wording.</span> The engine cannot know what this
                              should say. Check the text below before you approve it.
                            </p>
                          ) : null}
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor={`before-${f.id}`}>
                                Before
                              </label>
                              <pre
                                id={`before-${f.id}`}
                                className="h-[5.5rem] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
                              >
                                {f.fix.before || "(insertion — nothing here yet)"}
                              </pre>
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor={`after-${f.id}`}>
                                After — yours to edit before approving
                              </label>
                              <textarea
                                id={`after-${f.id}`}
                                value={edits[key] ?? f.fix.after}
                                onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                                spellCheck={false}
                                className="block h-[5.5rem] w-full resize-y rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 font-mono text-xs text-emerald-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
                              />
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button type="button" disabled={busy !== null} onClick={() => applyFinding(f)} className={BTN_PRIMARY}>
                              <CheckIcon />
                              {busy === `apply-${f.id}` ? "Applying…" : "Approve & apply fix"}
                            </button>
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => setDismissed((prev) => new Set(prev).add(key))}
                              className={BTN_SECONDARY}
                            >
                              Dismiss finding
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-muted-foreground">No automatic fix drafted for this finding.</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}

      {originalHtml ? (
        <section aria-labelledby="export-heading" className="mb-8">
          <StepHeading
            n={3}
            id="export-heading"
            title="Export"
            hint="The corrected HTML contains every fix you approved. The report records what changed, in an ACR/VPAT-style layout."
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || !currentHtml}
              onClick={() => download("remedy-corrected.html", currentHtml ?? "", "text/html")}
              className={BTN_PRIMARY}
            >
              Download corrected HTML
            </button>
            <button type="button" disabled={busy !== null} onClick={exportReport} className={BTN_SECONDARY}>
              {busy === "export" ? "Generating…" : "Generate remediation report"}
            </button>
            {report ? (
              <button
                type="button"
                onClick={() => download("remedy-report.md", report.markdown, "text/markdown")}
                className={BTN_SECONDARY}
              >
                Download report (.md)
              </button>
            ) : null}
          </div>
          {report ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <p className="border-b border-border bg-muted/50 px-5 py-2.5 text-xs font-medium text-muted-foreground">
                Report preview · score {report.beforeScore} → {report.afterScore} · {report.fixedCount} resolved ·{" "}
                {report.remainingCount} remaining
              </p>
              <div id="report-preview" tabIndex={0} className="max-h-[30rem] overflow-auto px-6 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <ReportDocument markdown={report.markdown} />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Scope, stated plainly.</span> Remedy evaluates static HTML against 12
        WCAG 2.1 criteria, listed in the report. It does not render the page, run JavaScript, or test keyboard
        interaction, and a clean run is not a conformance certification. Contrast is checked only where colors are
        declared in the document.
      </footer>
    </div>
  );
}
