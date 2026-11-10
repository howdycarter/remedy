/**
 * Remedy deterministic WCAG rule engine.
 *
 * Every check here is a plain function over parsed HTML — no model
 * calls, no network, no randomness. The same audit runs identically
 * from the UI, the agent, the CLI, HTTP, and MCP because all of them
 * call the same Agent-Native actions, which call this engine.
 *
 * Scope honesty: findings are "against the criteria listed" — this is
 * a rule engine over static markup. It does not render the page, does
 * not evaluate JavaScript-driven state, and a clean run is NOT a
 * conformance certification.
 */

import {
  parseHtml,
  textContent,
  elementSource,
  openTagSource,
  selectorPath,
  ancestors,
  descendants,
  type HtmlElement,
  type ParsedHtml,
} from "./parse.js";
import { parseColor, contrastRatio, fixContrast, toHex, type Rgb } from "./color.js";

export type Severity = "critical" | "serious" | "moderate" | "minor";

export interface FindingFix {
  /** span of the audited document this fix replaces */
  start: number;
  end: number;
  /** original source in that span */
  before: string;
  /** proposed replacement source */
  after: string;
  description: string;
  /** true when the drafted wording is a placeholder a human must confirm */
  needsHumanWording: boolean;
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  wcag: string; // e.g. "1.1.1 Non-text Content"
  level: "A" | "AA";
  severity: Severity;
  selector: string;
  snippet: string;
  message: string;
  fix: FindingFix | null;
}

export interface AuditResult {
  score: number;
  total: number;
  counts: Record<Severity, number>;
  documentScope: boolean;
  criteriaEvaluated: string[];
  findings: Finding[];
}

const SEVERITY_DEDUCTION: Record<Severity, number> = {
  critical: 12,
  serious: 7,
  moderate: 3,
  minor: 1,
};

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function truncate(s: string, max = 220): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function humanize(raw: string): string {
  let s = raw.split(/[?#]/)[0] ?? raw;
  s = s.split("/").filter(Boolean).pop() ?? s;
  s = s.replace(/\.[a-z0-9]+$/i, "");
  s = s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Rebuild an open tag with attribute overrides (null removes the attr). */
function buildOpenTag(
  parsed: ParsedHtml,
  el: HtmlElement,
  overrides: Record<string, string | null>,
): string {
  const attrs: Record<string, string> = { ...el.attrs };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete attrs[k];
    else attrs[k] = v;
  }
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => (v === "" ? `${k}` : `${k}="${v.replace(/"/g, "&quot;")}"`))
    .join(" ");
  const selfClose = /\/\s*>$/.test(openTagSource(parsed, el));
  return `<${el.tag}${attrStr ? " " + attrStr : ""}${selfClose ? " /" : ""}>`;
}

function openTagFix(
  parsed: ParsedHtml,
  el: HtmlElement,
  overrides: Record<string, string | null>,
  description: string,
  needsHumanWording: boolean,
): FindingFix {
  return {
    start: el.openStart,
    end: el.openEnd,
    before: openTagSource(parsed, el),
    after: buildOpenTag(parsed, el, overrides),
    description,
    needsHumanWording,
  };
}

function parseStyleDecls(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim().toLowerCase().replace(/!important$/, "").trim();
    if (prop) out[prop] = val;
  }
  return out;
}

interface StyleRule {
  compounds: string[]; // selector split on combinators; last compound is the subject
  decls: Record<string, string>;
  order: number;
}

function parseStyleRules(styleText: string): StyleRule[] {
  const rules: StyleRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = re.exec(styleText)) !== null) {
    const decls = parseStyleDecls(m[2]!.replace(/\/\*[\s\S]*?\*\//g, ""));
    for (const sel of m[1]!.split(",")) {
      const compounds = sel.trim().split(/[\s>+~]+/).filter(Boolean);
      if (compounds.length) rules.push({ compounds, decls, order: order++ });
    }
  }
  return rules;
}

function matchesCompound(el: HtmlElement, compound: string): boolean {
  // compound like "p", ".note", "#main", "p.note", "div#main.x"
  const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(compound);
  if (tagMatch && el.tag !== tagMatch[0].toLowerCase()) return false;
  const classes = (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
  for (const part of compound.match(/[.#][a-zA-Z0-9-_]+/g) ?? []) {
    if (part.startsWith(".")) {
      if (!classes.includes(part.slice(1))) return false;
    } else if (el.attrs.id !== part.slice(1)) {
      return false;
    }
  }
  return true;
}

function specificity(compound: string): number {
  const ids = (compound.match(/#/g) ?? []).length;
  const classes = (compound.match(/\./g) ?? []).length;
  const tags = /^[a-zA-Z]/.test(compound) ? 1 : 0;
  return ids * 100 + classes * 10 + tags;
}

/**
 * Find a declared value for a CSS property for an element: inline style
 * wins, then the best-matching style rule (specificity, then order).
 * When `inherit` is true, ancestors are consulted nearest-first.
 */
function declaredValue(
  parsed: ParsedHtml,
  rules: StyleRule[],
  el: HtmlElement,
  prop: string,
  inherit: boolean,
): string | undefined {
  const chain = inherit ? [el, ...ancestors(parsed, el)] : [el];
  for (const node of chain) {
    const inline = parseStyleDecls(node.attrs.style);
    if (inline[prop]) return inline[prop];
    let best: { spec: number; order: number; val: string } | null = null;
    for (const rule of rules) {
      const subject = rule.compounds[rule.compounds.length - 1]!;
      if (!rule.decls[prop]) continue;
      if (!matchesCompound(node, subject)) continue;
      const spec = specificity(subject);
      if (!best || spec > best.spec || (spec === best.spec && rule.order > best.order)) {
        best = { spec, order: rule.order, val: rule.decls[prop] };
      }
    }
    if (best) return best.val;
  }
  return undefined;
}

/** Text belonging directly to this element (excluding child elements). */
function ownText(parsed: ParsedHtml, el: HtmlElement): string {
  if (el.closeStart === null) return "";
  let s = parsed.source.slice(el.openEnd, el.closeStart);
  for (const childIdx of el.children) {
    const child = parsed.elements[childIdx]!;
    const childSrc = elementSource(parsed, child);
    const pos = s.indexOf(childSrc);
    if (pos >= 0) s = s.slice(0, pos) + " " + s.slice(pos + childSrc.length);
  }
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Accessible-name approximation: aria-label, aria-labelledby target text, own text, descendant img alt, title. */
function accessibleName(parsed: ParsedHtml, el: HtmlElement): string {
  if (el.attrs["aria-label"]?.trim()) return el.attrs["aria-label"].trim();
  const text = textContent(parsed, el);
  if (text) return text;
  for (const d of descendants(parsed, el)) {
    if (d.tag === "img" && d.attrs.alt?.trim()) return d.attrs.alt.trim();
    if (d.tag === "input" && d.attrs.type === "image" && d.attrs.alt?.trim())
      return d.attrs.alt.trim();
  }
  return el.attrs.title?.trim() ?? "";
}

/* ------------------------------------------------------------------ */
/* audit                                                               */
/* ------------------------------------------------------------------ */

interface RuleContext {
  parsed: ParsedHtml;
  rules: StyleRule[];
  findings: Finding[];
  add: (f: Omit<Finding, "id">) => void;
}

export function auditHtml(html: string): AuditResult {
  const parsed = parseHtml(html);
  const rules = parseStyleRules(parsed.styleText);
  const findings: Finding[] = [];
  const ctx: RuleContext = {
    parsed,
    rules,
    findings,
    add: (f) => findings.push({ ...f, id: `f${findings.length + 1}` }),
  };

  const els = parsed.elements;
  const byTag = (tag: string) => els.filter((e) => e.tag === tag);
  const htmlEl = byTag("html")[0];
  const headEl = byTag("head")[0];
  const documentScope = !!htmlEl || !!headEl;

  /* ---- 3.1.1 html-lang ------------------------------------------- */
  if (htmlEl && !htmlEl.attrs.lang?.trim()) {
    ctx.add({
      ruleId: "html-lang",
      title: "Page language is not declared",
      wcag: "3.1.1 Language of Page",
      level: "A",
      severity: "serious",
      selector: selectorPath(parsed, htmlEl),
      snippet: truncate(openTagSource(parsed, htmlEl)),
      message:
        "The <html> element has no lang attribute, so screen readers cannot select the correct pronunciation rules for the page.",
      fix: openTagFix(parsed, htmlEl, { lang: "en" },
        'Add lang="en" to the <html> element. Change the value if the page is not in English.', false),
    });
  }

  /* ---- 2.4.2 document-title --------------------------------------- */
  if (documentScope) {
    const titleEl = byTag("title")[0];
    const headingText =
      els.find((e) => /^h[1-3]$/.test(e.tag) && textContent(parsed, e))?.attrs &&
      textContent(parsed, els.find((e) => /^h[1-3]$/.test(e.tag) && textContent(parsed, e))!);
    const draftTitle = headingText ? truncate(headingText, 80) : "";
    if (!titleEl) {
      const anchor = headEl ?? htmlEl;
      if (anchor) {
        ctx.add({
          ruleId: "document-title",
          title: "Document has no <title>",
          wcag: "2.4.2 Page Titled",
          level: "A",
          severity: "serious",
          selector: "head",
          snippet: truncate(openTagSource(parsed, anchor)),
          message:
            "The document has no <title>. The title is the first thing a screen reader announces and the text shown in tabs, bookmarks, and search results.",
          fix: {
            start: anchor.openEnd,
            end: anchor.openEnd,
            before: "",
            after: headEl
              ? `<title>${draftTitle || "Untitled page"}</title>`
              : `<head><title>${draftTitle || "Untitled page"}</title></head>`,
            description: draftTitle
              ? `Insert a <title> drafted from the page's first heading: "${draftTitle}".`
              : "Insert a <title> — the draft is a placeholder; replace it with the real page title.",
            needsHumanWording: !draftTitle,
          },
        });
      }
    } else if (!textContent(parsed, titleEl)) {
      ctx.add({
        ruleId: "document-title",
        title: "Document <title> is empty",
        wcag: "2.4.2 Page Titled",
        level: "A",
        severity: "serious",
        selector: selectorPath(parsed, titleEl),
        snippet: truncate(elementSource(parsed, titleEl)),
        message: "The <title> element is empty, so the page announces no title to assistive technology.",
        fix: {
          start: titleEl.start,
          end: titleEl.end,
          before: elementSource(parsed, titleEl),
          after: `<title>${draftTitle || "Untitled page"}</title>`,
          description: draftTitle
            ? `Set the title from the page's first heading: "${draftTitle}".`
            : "Set the title — the draft is a placeholder; replace it with the real page title.",
          needsHumanWording: !draftTitle,
        },
      });
    }
  }

  /* ---- 1.1.1 img-alt ---------------------------------------------- */
  const checkAlt = (el: HtmlElement, kind: string) => {
    if (!("alt" in el.attrs)) {
      const figcaption =
        el.parent >= 0 && parsed.elements[el.parent]!.tag === "figure"
          ? descendants(parsed, parsed.elements[el.parent]!).find((d) => d.tag === "figcaption")
          : undefined;
      const fromCaption = figcaption ? textContent(parsed, figcaption) : "";
      const fromName = el.attrs.src ? humanize(el.attrs.src.split(/[?#]/)[0]!) : "";
      const draft = fromCaption || fromName;
      ctx.add({
        ruleId: "img-alt",
        title: `${kind} has no alt attribute`,
        wcag: "1.1.1 Non-text Content",
        level: "A",
        severity: "critical",
        selector: selectorPath(parsed, el),
        snippet: truncate(openTagSource(parsed, el)),
        message:
          "This non-text element has no alt attribute at all. Screen readers will announce the file name or nothing. Every image needs a text alternative — or alt=\"\" if it is purely decorative.",
        fix: openTagFix(parsed, el, { alt: draft },
          draft
            ? `Add alt text drafted from ${fromCaption ? "the figure caption" : "the file name"}: "${draft}". Confirm it describes the image's content or purpose.`
            : "Add alt=\"\" to mark the image decorative. Only correct if the image carries no information — otherwise write a description.",
          true),
      });
    } else if (el.attrs.alt.trim()) {
      const alt = el.attrs.alt.trim();
      const base = (el.attrs.src ?? "").split(/[?#]/)[0]!.split("/").pop() ?? "";
      if (
        base &&
        (alt.toLowerCase() === base.toLowerCase() ||
          alt.toLowerCase() === base.replace(/\.[a-z0-9]+$/i, "").toLowerCase())
      ) {
        ctx.add({
          ruleId: "img-alt-filename",
          title: "Alt text is just the file name",
          wcag: "1.1.1 Non-text Content",
          level: "A",
          severity: "minor",
          selector: selectorPath(parsed, el),
          snippet: truncate(openTagSource(parsed, el)),
          message: `The alt text "${alt}" repeats the file name instead of describing the image.`,
          fix: openTagFix(parsed, el, { alt: humanize(base) },
            `Replace the file-name alt with a human description. Draft: "${humanize(base)}" — edit it to describe what the image shows.`, true),
        });
      }
    }
  };
  for (const img of byTag("img")) checkAlt(img, "Image");
  for (const inp of byTag("input")) {
    if ((inp.attrs.type ?? "").toLowerCase() === "image") checkAlt(inp, "Image button");
  }

  /* ---- 1.3.1 / 3.3.2 / 4.1.2 input-label -------------------------- */
  const labelFors = new Set(
    byTag("label").map((l) => l.attrs.for).filter((v): v is string => !!v),
  );
  // Generated ids must never collide with ids already in the document —
  // audits re-run after every applied fix, and a restarted counter
  // would hand out the same id again and create duplicate-id findings.
  const usedIds = new Set(els.map((e) => e.attrs.id).filter(Boolean));
  let generatedFieldCount = 0;
  const nextFieldId = () => {
    do {
      generatedFieldCount++;
    } while (usedIds.has(`remedy-field-${generatedFieldCount}`));
    const id = `remedy-field-${generatedFieldCount}`;
    usedIds.add(id);
    return id;
  };
  for (const el of els) {
    const tag = el.tag;
    if (tag !== "input" && tag !== "select" && tag !== "textarea") continue;
    const type = (el.attrs.type ?? "text").toLowerCase();
    if (tag === "input" && ["hidden", "submit", "reset", "button", "image"].includes(type)) continue;
    const hasLabel =
      (el.attrs.id && labelFors.has(el.attrs.id)) ||
      ancestors(parsed, el).some((a) => a.tag === "label") ||
      !!el.attrs["aria-label"]?.trim() ||
      !!el.attrs["aria-labelledby"]?.trim() ||
      !!el.attrs.title?.trim();
    if (hasLabel) continue;

    const id = el.attrs.id || nextFieldId();
    const labelText =
      (el.attrs.placeholder ?? "").replace(/[*:\s]+$/, "").trim() ||
      humanize(el.attrs.name ?? "") ||
      humanize(id) ||
      "Field";
    const elSrc = elementSource(parsed, el);
    const newOpen = el.attrs.id
      ? openTagSource(parsed, el)
      : buildOpenTag(parsed, el, { id });
    const after = `<label for="${id}">${labelText}</label>` + newOpen + elSrc.slice(openTagSource(parsed, el).length);
    ctx.add({
      ruleId: "input-label",
      title: "Form field has no label",
      wcag: "1.3.1 Info and Relationships · 3.3.2 Labels or Instructions · 4.1.2 Name, Role, Value",
      level: "A",
      severity: "critical",
      selector: selectorPath(parsed, el),
      snippet: truncate(openTagSource(parsed, el)),
      message:
        "This form control has no programmatically associated label. A placeholder is not a label — it disappears while typing and is not reliably announced. Screen-reader and voice-control users cannot identify the field.",
      fix: {
        start: el.start,
        end: el.end,
        before: elSrc,
        after,
        description: `Insert a visible <label for="${id}">${labelText}</label> immediately before the field${el.attrs.id ? "" : ` and give the field id="${id}"`}. Label text was drafted from ${el.attrs.placeholder ? "the placeholder" : "the field name"} — edit it if the wording should differ.`,
        needsHumanWording: false,
      },
    });
  }

  /* ---- 4.1.2 button-name ------------------------------------------ */
  for (const btn of byTag("button")) {
    if (accessibleName(parsed, btn)) continue;
    const imgChild = descendants(parsed, btn).find((d) => d.tag === "img" && d.attrs.src);
    const draft = imgChild ? humanize(imgChild.attrs.src!) : "";
    ctx.add({
      ruleId: "button-name",
      title: "Button has no accessible name",
      wcag: "4.1.2 Name, Role, Value",
      level: "A",
      severity: "critical",
      selector: selectorPath(parsed, btn),
      snippet: truncate(elementSource(parsed, btn)),
      message:
        "This button exposes no accessible name, so assistive technology announces only \"button\". The user cannot tell what it does.",
      fix: openTagFix(parsed, btn, { "aria-label": draft || "Describe this button's action" },
        draft
          ? `Add aria-label drafted from the button's icon file name: "${draft}". Confirm it names the action.`
          : "Add an aria-label naming the action this button performs. The draft is a placeholder — replace it.",
        true),
    });
  }

  /* ---- 2.4.4 link-name -------------------------------------------- */
  for (const a of byTag("a")) {
    if (!("href" in a.attrs)) continue;
    if (accessibleName(parsed, a)) continue;
    const href = a.attrs.href.trim();
    const usable = href && href !== "#" && !href.toLowerCase().startsWith("javascript:");
    const draft = usable ? humanize(href) : "";
    ctx.add({
      ruleId: "link-name",
      title: "Link has no accessible name",
      wcag: "2.4.4 Link Purpose (In Context)",
      level: "A",
      severity: "serious",
      selector: selectorPath(parsed, a),
      snippet: truncate(elementSource(parsed, a)),
      message:
        "This link has no text, aria-label, or labelled image, so its purpose cannot be determined by assistive technology.",
      fix: openTagFix(parsed, a, { "aria-label": draft || "Describe this link's destination" },
        draft
          ? `Add aria-label drafted from the destination: "${draft}". Confirm it describes where the link goes.`
          : "Add an aria-label describing the link's destination. The draft is a placeholder — replace it.",
        !draft),
    });
  }

  /* ---- headings: 1.3.1 order, 2.4.6 empty -------------------------- */
  const headings = els.filter((e) => /^h[1-6]$/.test(e.tag));
  let prevLevel = 0;
  for (const h of headings) {
    const level = parseInt(h.tag.charAt(1), 10);
    if (prevLevel > 0 && level > prevLevel + 1) {
      const newLevel = prevLevel + 1;
      const src = elementSource(parsed, h);
      const after = src
        .replace(new RegExp(`^<h${level}`, "i"), `<h${newLevel}`)
        .replace(new RegExp(`</h${level}>\\s*$`, "i"), `</h${newLevel}>`);
      ctx.add({
        ruleId: "heading-order",
        title: "Heading level is skipped",
        wcag: "1.3.1 Info and Relationships",
        level: "A",
        severity: "moderate",
        selector: selectorPath(parsed, h),
        snippet: truncate(src),
        message: `This heading is h${level} but the previous heading is h${prevLevel}. Skipped levels break the document outline that screen-reader users navigate by.`,
        fix: {
          start: h.start,
          end: h.end,
          before: src,
          after,
          description: `Change h${level} to h${newLevel} so the outline descends one level at a time. Restyle with CSS if the visual size must stay.`,
          needsHumanWording: false,
        },
      });
    }
    prevLevel = level;
    if (!textContent(parsed, h) && !accessibleName(parsed, h)) {
      ctx.add({
        ruleId: "empty-heading",
        title: "Heading is empty",
        wcag: "2.4.6 Headings and Labels",
        level: "AA",
        severity: "moderate",
        selector: selectorPath(parsed, h),
        snippet: truncate(elementSource(parsed, h)),
        message:
          "This heading contains no text. It appears in screen-reader heading navigation as a blank stop.",
        fix: {
          start: h.start,
          end: h.end,
          before: elementSource(parsed, h),
          after: "",
          description: "Remove the empty heading. If it was holding layout space, use CSS margin on the neighbouring element instead.",
          needsHumanWording: false,
        },
      });
    }
  }

  /* ---- 4.1.1 duplicate-id ------------------------------------------ */
  const idCount = new Map<string, number>();
  for (const el of els) {
    const id = el.attrs.id;
    if (!id) continue;
    const k = (idCount.get(id) ?? 0) + 1;
    idCount.set(id, k);
    if (k >= 2) {
      ctx.add({
        ruleId: "duplicate-id",
        title: "Duplicate id attribute",
        wcag: "4.1.1 Parsing",
        level: "A",
        severity: "serious",
        selector: selectorPath(parsed, el),
        snippet: truncate(openTagSource(parsed, el)),
        message: `The id "${id}" is used ${k} times in this document (this is occurrence ${k}). Duplicate ids break label associations, ARIA references, and in-page links, which resolve to the first occurrence only.`,
        fix: openTagFix(parsed, el, { id: `${id}-${k}` },
          `Rename this occurrence to id="${id}-${k}". Check any CSS or script that targeted the shared id.`, false),
      });
    }
  }

  /* ---- 2.4.3 positive-tabindex ------------------------------------- */
  for (const el of els) {
    const raw = el.attrs.tabindex;
    if (raw === undefined) continue;
    const val = parseInt(raw, 10);
    if (Number.isNaN(val) || val <= 0) continue;
    ctx.add({
      ruleId: "positive-tabindex",
      title: "Positive tabindex disrupts focus order",
      wcag: "2.4.3 Focus Order",
      level: "A",
      severity: "moderate",
      selector: selectorPath(parsed, el),
      snippet: truncate(openTagSource(parsed, el)),
      message: `tabindex="${val}" pulls this element out of the natural focus order, so keyboard users reach it before content that visually precedes it.`,
      fix: openTagFix(parsed, el, { tabindex: "0" },
        'Set tabindex="0" so the element joins the natural tab order at its document position.', false),
    });
  }

  /* ---- 1.4.3 contrast ---------------------------------------------- */
  const SKIP_CONTRAST_TAGS = new Set([
    "script", "style", "title", "head", "html", "meta", "link", "option",
    "svg", "path", "input", "select", "textarea", "img", "br", "hr",
  ]);
  for (const el of els) {
    if (SKIP_CONTRAST_TAGS.has(el.tag)) continue;
    const text = ownText(parsed, el);
    if (!text) continue;
    const fgVal = declaredValue(parsed, rules, el, "color", true);
    const bgVal = declaredValue(parsed, rules, el, "background-color", true);
    const fg: Rgb = parseColor(fgVal) ?? { r: 0, g: 0, b: 0 };
    const bg: Rgb = parseColor(bgVal) ?? { r: 255, g: 255, b: 255 };
    const fontSizeRaw = declaredValue(parsed, rules, el, "font-size", true);
    let fontSizePx = 16;
    if (fontSizeRaw) {
      const m = /^([\d.]+)(px|pt|em|rem|%)$/.exec(fontSizeRaw.trim());
      if (m) {
        const v = parseFloat(m[1]!);
        fontSizePx = m[2] === "px" ? v : m[2] === "pt" ? v * 1.333 : m[2] === "%" ? (v / 100) * 16 : v * 16;
      }
    }
    const weightRaw = declaredValue(parsed, rules, el, "font-weight", true) ?? "";
    const bold =
      ["b", "strong", "h1", "h2", "h3"].includes(el.tag) ||
      weightRaw === "bold" ||
      parseInt(weightRaw, 10) >= 600;
    const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && bold);
    const target = large ? 3 : 4.5;
    const ratio = contrastRatio(fg, bg);
    if (ratio < target) {
      const fixed = fixContrast(fg, bg, target);
      const fixedHex = toHex(fixed);
      const inlineDecls = parseStyleDecls(el.attrs.style);
      inlineDecls.color = fixedHex;
      const styleStr = Object.entries(inlineDecls)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      ctx.add({
        ruleId: "contrast-insufficient",
        title: "Text contrast is below the WCAG minimum",
        wcag: "1.4.3 Contrast (Minimum)",
        level: "AA",
        severity: "serious",
        selector: selectorPath(parsed, el),
        snippet: truncate(openTagSource(parsed, el)),
        message: `Text "${truncate(text, 40)}" renders at ${ratio.toFixed(2)}:1 (${toHex(fg)} on ${toHex(bg)}), below the ${target}:1 minimum for ${large ? "large" : "normal"} text. Low-vision users may not be able to read it. Contrast is evaluated only where colors are declared in the document (inline styles or style rules).`,
        fix: openTagFix(parsed, el, { style: styleStr },
          `Set the text color to ${fixedHex} inline, which reaches ${contrastRatio(fixed, bg).toFixed(2)}:1 against the ${toHex(bg)} background. The color was computed deterministically — same hue direction, stepped until it passes.`, false),
      });
    }
  }

  /* ---- 1.3.1 table-headers ------------------------------------------ */
  for (const table of byTag("table")) {
    const rows = descendants(parsed, table).filter((d) => d.tag === "tr");
    const headers = descendants(parsed, table).filter((d) => d.tag === "th");
    if (rows.length < 1 || headers.length > 0) continue;
    const firstRow = rows[0]!;
    const firstRowCells = descendants(parsed, firstRow).filter((d) => d.tag === "td");
    if (firstRowCells.length === 0) continue;
    const src = elementSource(parsed, table);
    const trStartInTable = firstRow.start - table.start;
    const trEndInTable = firstRow.end - table.start;
    const trSrc = src.slice(trStartInTable, trEndInTable);
    const newTr = trSrc
      .replace(/<td(\s|>)/gi, '<th scope="col"$1')
      .replace(/<\/td>/gi, "</th>");
    const after = src.slice(0, trStartInTable) + newTr + src.slice(trEndInTable);
    ctx.add({
      ruleId: "table-headers",
      title: "Data table has no header cells",
      wcag: "1.3.1 Info and Relationships",
      level: "A",
      severity: "moderate",
      selector: selectorPath(parsed, table),
      snippet: truncate(src, 200),
      message:
        "This table presents data but uses no <th> header cells, so screen readers cannot associate data cells with their column headers.",
      fix: {
        start: table.start,
        end: table.end,
        before: src,
        after,
        description: 'Convert the first row\'s cells to <th scope="col"> so each column has a programmatic header.',
        needsHumanWording: false,
      },
    });
  }

  /* ---- 4.1.2 frame-title --------------------------------------------- */
  for (const frame of byTag("iframe")) {
    if (frame.attrs.title?.trim()) continue;
    const draft = frame.attrs.src ? humanize(frame.attrs.src) : "";
    ctx.add({
      ruleId: "frame-title",
      title: "Iframe has no title",
      wcag: "4.1.2 Name, Role, Value",
      level: "A",
      severity: "serious",
      selector: selectorPath(parsed, frame),
      snippet: truncate(openTagSource(parsed, frame)),
      message:
        "This iframe has no title attribute. Screen readers announce it as an unnamed frame, and users cannot tell what it contains without entering it.",
      fix: openTagFix(parsed, frame, { title: draft || "Describe the embedded content" },
        draft
          ? `Add title drafted from the frame source: "${draft}". Confirm it describes the embedded content.`
          : "Add a title describing the embedded content. The draft is a placeholder — replace it.",
        !draft),
    });
  }

  /* ---- 1.4.4 viewport-zoom ------------------------------------------- */
  for (const meta of byTag("meta")) {
    if ((meta.attrs.name ?? "").toLowerCase() !== "viewport") continue;
    const content = meta.attrs.content ?? "";
    const parts = content.split(",").map((p) => p.trim()).filter(Boolean);
    const bad = parts.filter((p) => {
      if (/^user-scalable\s*=\s*(no|0)$/i.test(p)) return true;
      const ms = /^maximum-scale\s*=\s*([\d.]+)$/i.exec(p);
      return ms ? parseFloat(ms[1]!) < 2 : false;
    });
    if (bad.length === 0) continue;
    const kept = parts.filter((p) => !bad.includes(p));
    const newContent = kept.length ? kept.join(", ") : "width=device-width, initial-scale=1";
    ctx.add({
      ruleId: "viewport-zoom",
      title: "Page disables or limits zoom",
      wcag: "1.4.4 Resize Text",
      level: "AA",
      severity: "moderate",
      selector: selectorPath(parsed, meta),
      snippet: truncate(openTagSource(parsed, meta)),
      message: `The viewport meta sets ${bad.join(" and ")}, which prevents or limits pinch-zoom. Low-vision users who rely on zoom are locked out of enlarging the content.`,
      fix: openTagFix(parsed, meta, { content: newContent },
        `Remove the zoom restriction, leaving content="${newContent}".`, false),
    });
  }

  /* ---- score + result -------------------------------------------------- */
  const counts: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const f of findings) counts[f.severity]++;
  const deduction = findings.reduce((sum, f) => sum + SEVERITY_DEDUCTION[f.severity], 0);
  const score = Math.max(0, 100 - deduction);

  // The criteria list reports what the engine can evaluate at all,
  // not only what failed — keep it complete and static.
  const ALL_CRITERIA = [
    "1.1.1 Non-text Content",
    "1.3.1 Info and Relationships",
    "1.4.3 Contrast (Minimum)",
    "1.4.4 Resize Text",
    "2.4.2 Page Titled",
    "2.4.3 Focus Order",
    "2.4.4 Link Purpose (In Context)",
    "2.4.6 Headings and Labels",
    "3.1.1 Language of Page",
    "3.3.2 Labels or Instructions",
    "4.1.1 Parsing",
    "4.1.2 Name, Role, Value",
  ];

  return {
    score,
    total: findings.length,
    counts,
    documentScope,
    criteriaEvaluated: ALL_CRITERIA,
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* prioritization — deterministic triage the agent explains            */
/* ------------------------------------------------------------------ */

const RATIONALE: Record<string, string> = {
  "img-alt":
    "Blocks screen-reader users from the image's content entirely. Alt text is fast to confirm and unblocks the most users per minute of effort.",
  "input-label":
    "An unlabelled field can make a form impossible to complete with a screen reader or voice control. Fix before anything cosmetic.",
  "button-name":
    "An unnamed button is an action the user cannot identify or invoke by voice. Name the action and the control becomes usable.",
  "link-name":
    "Users navigating by link list hear only 'link'. Naming the destination restores the page's primary navigation mechanic.",
  "html-lang":
    "Wrong or missing language makes the entire page be read with the wrong pronunciation rules — one attribute fixes every word on the page.",
  "document-title":
    "The title is the page's identity in tabs, history, and screen-reader announcements. One element, whole-page payoff.",
  "frame-title":
    "An unnamed frame is a mystery region users must enter to identify. A title restores orientation at negligible cost.",
  "contrast-insufficient":
    "Low contrast affects the largest user group of any finding here — everyone with low vision, plus anyone in bright light. The computed color fix is ready to apply.",
  "duplicate-id":
    "Duplicate ids silently corrupt label and ARIA references elsewhere on the page; fixing them can resolve findings that appear unrelated.",
  "heading-order":
    "The heading outline is the table of contents screen-reader users navigate by. Restoring order makes the whole document navigable.",
  "empty-heading":
    "A blank stop in heading navigation. Removing it costs nothing and cleans the outline.",
  "table-headers":
    "Without header cells, a data table reads as an unstructured stream of numbers. The conversion is mechanical.",
  "positive-tabindex":
    "A positive tabindex hijacks the keyboard path through the page. Resetting it restores the visual order as the focus order.",
  "viewport-zoom":
    "Disabling zoom locks out low-vision users on mobile entirely. Removing the restriction is a one-line change.",
  "img-alt-filename":
    "File-name alt text wastes the announcement but does not block comprehension. Worth fixing while the neighbouring alt findings are open.",
};

const SEVERITY_PRIORITY: Record<Severity, number> = {
  critical: 100,
  serious: 60,
  moderate: 30,
  minor: 10,
};
const INTERACTIVE_RULES = new Set(["input-label", "button-name", "link-name", "frame-title"]);

export interface PriorityEntry {
  findingId: string;
  ruleId: string;
  title: string;
  rank: number;
  priorityScore: number;
  rationale: string;
}

export function prioritizeFindings(audit: AuditResult): {
  priorities: PriorityEntry[];
  summary: string;
} {
  const scored = audit.findings.map((f, idx) => {
    let score = SEVERITY_PRIORITY[f.severity];
    score += f.level === "A" ? 15 : 5;
    if (INTERACTIVE_RULES.has(f.ruleId)) score += 10;
    return { f, idx, score };
  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const priorities = scored.map((s, i) => ({
    findingId: s.f.id,
    ruleId: s.f.ruleId,
    title: s.f.title,
    rank: i + 1,
    priorityScore: s.score,
    rationale: RATIONALE[s.f.ruleId] ?? "Ordered by severity, conformance level, and whether the finding blocks interaction.",
  }));
  const top = priorities.slice(0, 3).map((p) => p.title.toLowerCase());
  const summary =
    audit.total === 0
      ? "No findings. Nothing to prioritize — the evaluated criteria pass on this markup."
      : `${audit.total} finding(s): ${audit.counts.critical} critical, ${audit.counts.serious} serious, ${audit.counts.moderate} moderate, ${audit.counts.minor} minor. ` +
        `Recommended order starts with ${top.join("; ")}. Ordering is deterministic: severity first, then WCAG level (A before AA), then whether the finding blocks interaction.`;
  return { priorities, summary };
}

/* ------------------------------------------------------------------ */
/* ACR/VPAT-style remediation report                                    */
/* ------------------------------------------------------------------ */

/**
 * A fix as the reviewer actually approved it. The wording may differ
 * from the engine's draft, so the report prints this rather than the
 * draft whenever the caller supplies it.
 */
export interface AppliedFix {
  ruleId: string;
  selector: string;
  snippet: string;
  before: string;
  after: string;
  /** The draft shown at approval time; differs from `after` when the reviewer edited it. */
  draftedAfter?: string | undefined;
}

/** Pair each resolved finding with the applied fix recorded for it, most specific match first. */
function matchAppliedFixes(resolved: Finding[], applied: AppliedFix[]): Map<string, AppliedFix> {
  const unused = [...applied];
  const matched = new Map<string, AppliedFix>();
  const passes: ((f: Finding, a: AppliedFix) => boolean)[] = [
    (f, a) => a.snippet === f.snippet,
    (f, a) => a.selector === f.selector,
    (f, a) => !!f.fix && a.before === f.fix.before,
  ];
  for (const pass of passes) {
    for (const f of resolved) {
      if (matched.has(f.id)) continue;
      const i = unused.findIndex((a) => a.ruleId === f.ruleId && pass(f, a));
      if (i !== -1) matched.set(f.id, unused.splice(i, 1)[0]!);
    }
  }
  return matched;
}

export function buildReport(opts: {
  projectName: string;
  generatedFor: string;
  originalHtml: string;
  fixedHtml: string;
  appliedFixes?: AppliedFix[] | undefined;
}): { markdown: string; beforeScore: number; afterScore: number; fixedCount: number; remainingCount: number } {
  const before = auditHtml(opts.originalHtml);
  const after = auditHtml(opts.fixedHtml);

  // A before-finding counts as resolved when no after-finding shares
  // its rule and target snippet.
  const afterKeys = new Set(after.findings.map((f) => `${f.ruleId}|${f.snippet}`));
  const resolved = before.findings.filter((f) => !afterKeys.has(`${f.ruleId}|${f.snippet}`));
  const stillOpen = before.findings.filter((f) => afterKeys.has(`${f.ruleId}|${f.snippet}`));
  const newInFixed = after.findings.filter(
    (f) => !before.findings.some((b) => `${b.ruleId}|${b.snippet}` === `${f.ruleId}|${f.snippet}`),
  );

  const byCriterion = new Map<string, { resolved: Finding[]; open: Finding[] }>();
  const critOf = (f: Finding) => f.wcag;
  for (const f of before.findings) {
    const key = critOf(f);
    if (!byCriterion.has(key)) byCriterion.set(key, { resolved: [], open: [] });
  }
  for (const f of resolved) byCriterion.get(critOf(f))!.resolved.push(f);
  for (const f of stillOpen) byCriterion.get(critOf(f))!.open.push(f);

  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Accessibility Remediation Report — ${opts.projectName}`);
  lines.push("");
  lines.push(`**Product / page:** ${opts.generatedFor}`);
  lines.push(`**Report date:** ${date}`);
  lines.push(`**Generated by:** Remedy (deterministic WCAG rule engine — Agent-Native actions)`);
  lines.push(`**Standard:** WCAG 2.1, criteria listed in Table 1`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| | Before remediation | After remediation |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Remedy score (heuristic) | ${before.score} / 100 | ${after.score} / 100 |`);
  lines.push(`| Findings | ${before.total} | ${after.total} |`);
  lines.push(`| Critical | ${before.counts.critical} | ${after.counts.critical} |`);
  lines.push(`| Serious | ${before.counts.serious} | ${after.counts.serious} |`);
  lines.push(`| Moderate | ${before.counts.moderate} | ${after.counts.moderate} |`);
  lines.push(`| Minor | ${before.counts.minor} | ${after.counts.minor} |`);
  lines.push("");
  lines.push(
    `**${resolved.length} finding(s) resolved, ${stillOpen.length + newInFixed.length} remaining.** ` +
      `The Remedy score is a working heuristic for triage (100 minus weighted deductions). It is not a conformance determination.`,
  );
  lines.push("");
  lines.push(`## About this evaluation`);
  lines.push("");
  lines.push(
    `Remedy evaluated the page's static HTML against the criteria in Table 1 using deterministic rules — ` +
      `the same checks, in the same order, every run. Contrast is evaluated only where colors are declared ` +
      `in the document (inline styles or style rules). The evaluation does not render the page, execute ` +
      `JavaScript, or test keyboard interaction, so criteria that require rendered or interactive testing ` +
      `are out of scope and are not listed. **This report describes findings against the listed criteria; ` +
      `it is not a certification of WCAG or Section 508 conformance.**`,
  );
  lines.push("");
  lines.push(`## Table 1 — Criteria with findings`);
  lines.push("");
  if (byCriterion.size === 0) {
    lines.push(`No findings were recorded against any evaluated criterion in the original markup.`);
  } else {
    lines.push(`| WCAG criterion | Conformance level | Remarks |`);
    lines.push(`|---|---|---|`);
    for (const [crit, group] of [...byCriterion.entries()].sort()) {
      const level = group.open.length === 0 ? "Supports (after remediation)" : "Partially Supports";
      const remarks = [
        ...group.resolved.map((f) => `Resolved: ${f.title} (${f.selector})`),
        ...group.open.map((f) => `Open: ${f.title} (${f.selector})`),
      ].join("; ");
      lines.push(`| ${crit} | ${level} | ${remarks} |`);
    }
  }
  lines.push("");
  lines.push(`## Resolved findings`);
  lines.push("");
  if (resolved.length === 0) lines.push(`None.`);
  // The report states what is in the remediated markup, not what was
  // drafted: an "After" line is printed only for text the caller recorded
  // as applied, or for a draft that is present verbatim in the fixed HTML.
  const appliedByFinding = matchAppliedFixes(resolved, opts.appliedFixes ?? []);
  const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
  for (const f of resolved) {
    lines.push(`### ${f.title} — ${f.wcag} (${f.severity})`);
    lines.push("");
    lines.push(`- **Location:** \`${f.selector}\``);
    lines.push(`- **Issue:** ${f.message}`);
    const applied = appliedByFinding.get(f.id);
    if (applied) {
      const edited = applied.draftedAfter !== undefined && applied.draftedAfter !== applied.after;
      const stillPresent = opts.fixedHtml.includes(applied.after);
      if (f.fix) lines.push(`- **Remediation:** ${f.fix.description}`);
      lines.push(`- **Before:** ${code(applied.before)}`);
      lines.push(
        `- **After${edited ? " (wording edited by the reviewer before approval)" : ""}:** ${code(applied.after)}` +
          (stillPresent ? "" : ` — later changed again by another approved fix`),
      );
    } else if (f.fix && opts.fixedHtml.includes(f.fix.after)) {
      lines.push(`- **Remediation:** ${f.fix.description}`);
      lines.push(`- **Before:** ${code(f.fix.before)}`);
      lines.push(`- **After:** ${code(f.fix.after)}`);
    } else {
      if (f.fix) lines.push(`- **Drafted fix (not applied as written):** ${f.fix.description}`);
      lines.push(`- **Resolution:** The finding no longer occurs in the remediated markup.`);
    }
    lines.push("");
  }
  lines.push(`## Remaining findings`);
  lines.push("");
  const remaining = [...stillOpen, ...newInFixed];
  if (remaining.length === 0) lines.push(`None. All findings recorded in the original markup are resolved in the remediated markup.`);
  for (const f of remaining) {
    lines.push(`### ${f.title} — ${f.wcag} (${f.severity})`);
    lines.push("");
    lines.push(`- **Location:** \`${f.selector}\``);
    lines.push(`- **Issue:** ${f.message}`);
    if (f.fix) lines.push(`- **Drafted fix (not applied):** ${f.fix.description}`);
    lines.push("");
  }
  lines.push(`---`);
  lines.push(`*Remedy — Accessibility Remediation Studio. Built on the Agent-Native framework for the Builder.io Agent-Native Hackathon. Findings are against the criteria listed in this report only.*`);

  return {
    markdown: lines.join("\n"),
    beforeScore: before.score,
    afterScore: after.score,
    fixedCount: resolved.length,
    remainingCount: remaining.length,
  };
}
