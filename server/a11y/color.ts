/**
 * Color parsing, WCAG contrast math, and a deterministic contrast fixer.
 * Pure functions only — no I/O, no randomness.
 */

export interface Rgb {
  r: number; // 0-255
  g: number;
  b: number;
}

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", maroon: "#800000", purple: "#800080", fuchsia: "#ff00ff",
  lime: "#00ff00", olive: "#808000", navy: "#000080", teal: "#008080",
  aqua: "#00ffff", orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a",
  gold: "#ffd700", beige: "#f5f5dc", ivory: "#fffff0", coral: "#ff7f50",
  crimson: "#dc143c", indigo: "#4b0082", khaki: "#f0e68c", lavender: "#e6e6fa",
  salmon: "#fa8072", skyblue: "#87ceeb", slategray: "#708090",
  slategrey: "#708090", steelblue: "#4682b4", tan: "#d2b48c",
  tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3", dimgray: "#696969", dimgrey: "#696969",
  whitesmoke: "#f5f5f5", rebeccapurple: "#663399",
};

export function parseColor(input: string | undefined | null): Rgb | null {
  if (!input) return null;
  let v = input.trim().toLowerCase();
  const named = NAMED[v];
  if (named) v = named;

  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(v);
  const h = hexMatch?.[1];
  if (h) {
    if (h.length === 3) {
      return {
        r: parseInt(h.charAt(0) + h.charAt(0), 16),
        g: parseInt(h.charAt(1) + h.charAt(1), 16),
        b: parseInt(h.charAt(2) + h.charAt(2), 16),
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    return null;
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(v);
  if (rgb) {
    return {
      r: Math.round(parseFloat(rgb[1]!)),
      g: Math.round(parseFloat(rgb[2]!)),
      b: Math.round(parseFloat(rgb[3]!)),
    };
  }
  return null;
}

export function toHex(c: Rgb): string {
  const p = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`;
}

function channelLuminance(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(c: Rgb): number {
  return (
    0.2126 * channelLuminance(c.r) +
    0.7152 * channelLuminance(c.g) +
    0.0722 * channelLuminance(c.b)
  );
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Deterministically adjust the foreground color until it reaches the
 * target ratio against the background: step the color toward black or
 * toward white (whichever direction increases contrast) in 1% steps
 * and return the first passing color.
 */
export function fixContrast(fg: Rgb, bg: Rgb, target: number): Rgb {
  if (contrastRatio(fg, bg) >= target) return fg;
  const bgLum = relativeLuminance(bg);
  const fgLum = relativeLuminance(fg);
  // Move away from the background's luminance.
  const darken = fgLum <= bgLum;
  const dest: Rgb = darken ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  for (let step = 1; step <= 100; step++) {
    const t = step / 100;
    const cand: Rgb = {
      r: fg.r + (dest.r - fg.r) * t,
      g: fg.g + (dest.g - fg.g) * t,
      b: fg.b + (dest.b - fg.b) * t,
    };
    if (contrastRatio(cand, bg) >= target) return cand;
  }
  return dest;
}
