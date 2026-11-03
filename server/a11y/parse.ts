/**
 * Minimal, dependency-free HTML parser for the Remedy rule engine.
 *
 * It is deliberately small: it tokenizes tags, attributes, and text,
 * builds a tolerant element tree, and records exact source spans so
 * drafted fixes can be spliced back into the original document.
 * It is NOT a spec-complete HTML5 parser — it handles the well-formed
 * and near-well-formed markup Remedy is meant to audit.
 */

export interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  /** offset of the "<" of the open tag */
  start: number;
  /** offset just past the ">" of the close tag (or open tag for void/self-closed) */
  end: number;
  openStart: number;
  openEnd: number;
  closeStart: number | null;
  closeEnd: number | null;
  parent: number; // index into elements[], -1 for root-level
  children: number[];
  /** document-order index */
  index: number;
}

export interface ParsedHtml {
  source: string;
  elements: HtmlElement[];
  /** concatenated text of <style> elements */
  styleText: string;
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    if (!name) continue;
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

export function parseHtml(source: string): ParsedHtml {
  const elements: HtmlElement[] = [];
  const stack: number[] = [];
  let i = 0;
  const n = source.length;

  const pushTextFree = () => {};

  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt === -1) break;

    // Comments
    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    // Doctype / processing instructions
    if (source.startsWith("<!", lt) || source.startsWith("<?", lt)) {
      const close = source.indexOf(">", lt);
      i = close === -1 ? n : close + 1;
      continue;
    }
    // Closing tag
    if (source.startsWith("</", lt)) {
      const close = source.indexOf(">", lt);
      if (close === -1) break;
      const tagName = source.slice(lt + 2, close).trim().toLowerCase().split(/\s/)[0];
      // pop the stack to the matching open element
      for (let s = stack.length - 1; s >= 0; s--) {
        const el = elements[stack[s]!];
        if (el && el.tag === tagName) {
          el.closeStart = lt;
          el.closeEnd = close + 1;
          el.end = close + 1;
          stack.length = s;
          break;
        }
      }
      i = close + 1;
      continue;
    }

    // Opening tag — find the closing ">" respecting quotes
    let j = lt + 1;
    let quote: string | null = null;
    while (j < n) {
      const ch = source[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      j++;
    }
    if (j >= n) break;
    const inner = source.slice(lt + 1, j);
    const selfClosing = /\/\s*$/.test(inner);
    const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(inner.trim());
    if (!tagMatch) {
      i = j + 1;
      continue;
    }
    const tag = tagMatch[1]!.toLowerCase();
    const attrRaw = inner.trim().slice(tagMatch[1]!.length);
    const el: HtmlElement = {
      tag,
      attrs: parseAttrs(attrRaw),
      start: lt,
      end: j + 1,
      openStart: lt,
      openEnd: j + 1,
      closeStart: null,
      closeEnd: null,
      parent: stack.length ? stack[stack.length - 1]! : -1,
      children: [],
      index: elements.length,
    };
    elements.push(el);
    if (el.parent >= 0) elements[el.parent]!.children.push(el.index);
    i = j + 1;

    if (VOID_TAGS.has(tag) || selfClosing) {
      // complete already
    } else if (RAW_TEXT_TAGS.has(tag)) {
      // swallow raw content up to the close tag, then let the main loop
      // process the close tag normally
      const closeIdx = source.toLowerCase().indexOf(`</${tag}`, i);
      if (closeIdx === -1) {
        el.end = n;
        i = n;
      } else {
        stack.push(el.index);
        i = closeIdx;
      }
    } else {
      stack.push(el.index);
    }
  }
  pushTextFree();

  // Any unclosed elements end at EOF
  for (const el of elements) {
    if (el.closeEnd === null && !VOID_TAGS.has(el.tag)) {
      // leave end as openEnd if never closed; closeStart stays null
    }
  }

  const styleText = elements
    .filter((e) => e.tag === "style")
    .map((e) => source.slice(e.openEnd, e.closeStart ?? e.openEnd))
    .join("\n");

  return { source, elements, styleText };
}

/** Recursive text content of an element (tags stripped, entities kept raw). */
export function textContent(parsed: ParsedHtml, el: HtmlElement): string {
  const inner =
    el.closeStart !== null
      ? parsed.source.slice(el.openEnd, el.closeStart)
      : "";
  // strip nested tags
  return inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Raw inner HTML of an element. */
export function innerHtml(parsed: ParsedHtml, el: HtmlElement): string {
  if (el.closeStart === null) return "";
  return parsed.source.slice(el.openEnd, el.closeStart);
}

/** Full source of an element including its tags. */
export function elementSource(parsed: ParsedHtml, el: HtmlElement): string {
  return parsed.source.slice(el.start, el.end);
}

/** Open-tag-only source. */
export function openTagSource(parsed: ParsedHtml, el: HtmlElement): string {
  return parsed.source.slice(el.openStart, el.openEnd);
}

/** A short CSS-ish path: body > div.card > img */
export function selectorPath(parsed: ParsedHtml, el: HtmlElement): string {
  const parts: string[] = [];
  let cur: HtmlElement | undefined = el;
  while (cur) {
    let label = cur.tag;
    if (cur.attrs.id) label += `#${cur.attrs.id}`;
    else if (cur.attrs.class) label += `.${cur.attrs.class.trim().split(/\s+/)[0]}`;
    parts.unshift(label);
    cur = cur.parent >= 0 ? parsed.elements[cur.parent] : undefined;
    if (parts.length >= 5) break;
  }
  return parts.join(" > ");
}

/** Walk ancestors of an element, nearest first. */
export function ancestors(parsed: ParsedHtml, el: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [];
  let p = el.parent;
  while (p >= 0) {
    const parent = parsed.elements[p]!;
    out.push(parent);
    p = parent.parent;
  }
  return out;
}

/** All descendants (document order). */
export function descendants(parsed: ParsedHtml, el: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [];
  const walk = (idx: number) => {
    for (const c of parsed.elements[idx]!.children) {
      out.push(parsed.elements[c]!);
      walk(c);
    }
  };
  walk(el.index);
  return out;
}
