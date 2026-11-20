import type { HighlightColor, ReaderFont, ReaderPrefs, ReaderTheme } from "../../types";

export interface ThemeColors {
  bg: string;
  fg: string;
  soft: string;
  link: string;
  bar: string;
  line: string;
}

export const THEME_COLORS: Record<ReaderTheme, ThemeColors> = {
  paper: { bg: "#fbf7ec", fg: "#1d1a14", soft: "#6b6354", link: "#245ed6", bar: "#f3ecda", line: "#ddd2b6" },
  sepia: { bg: "#f1e4c7", fg: "#3b2f1e", soft: "#7a6850", link: "#8a3a1d", bar: "#e8d8b5", line: "#cdb98f" },
  night: { bg: "#13191a", fg: "#d9d4c5", soft: "#9a968a", link: "#7fb8d6", bar: "#1b2324", line: "#2c3739" },
};

export const FONT_STACKS: Record<ReaderFont, string> = {
  literata: '"Literata", Georgia, "Times New Roman", serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  atkinson: '"Atkinson Hyperlegible", system-ui, sans-serif',
};

/** Loaded inside each book iframe so the fonts are available there too. */
export const READER_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap";

/** Text column width for each margin choice, applied to the reader container. */
export const MARGIN_WIDTHS: Record<ReaderPrefs["margin"], string> = {
  narrow: "100%",
  normal: "50rem",
  wide: "38rem",
};

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: "#f4b93a",
  green: "#52b788",
  blue: "#4f8cff",
  pink: "#f06292",
};

export const FONT_SIZE_RANGE = { min: 80, max: 220, step: 10 } as const;
export const LINE_HEIGHT_RANGE = { min: 1.3, max: 2.1, step: 0.05 } as const;

export function clampFontSize(value: number): number {
  return Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, Math.round(value / 10) * 10));
}

/**
 * CSS rules injected into the book. Publisher styles are overridden for colour, font and
 * spacing (that's what a reading-settings panel is for) but layout is left alone.
 */
export function buildThemeRules(prefs: Pick<ReaderPrefs, "theme" | "font" | "lineHeight">): Record<string, Record<string, string>> {
  const c = THEME_COLORS[prefs.theme];
  const font = FONT_STACKS[prefs.font];
  return {
    html: { "-webkit-text-size-adjust": "100%" },
    body: {
      background: `${c.bg} !important`,
      color: `${c.fg} !important`,
      "font-family": `${font} !important`,
      "line-height": `${prefs.lineHeight} !important`,
      "text-rendering": "optimizeLegibility",
      "-webkit-font-smoothing": "antialiased",
      hyphens: "auto",
      "-webkit-hyphens": "auto",
    },
    "p, li, dd, dt, blockquote, td, th, span, div, em, strong, i, b, h1, h2, h3, h4, h5, h6": {
      color: `${c.fg} !important`,
      "font-family": `${font} !important`,
    },
    "p, li, dd, blockquote": { "line-height": `${prefs.lineHeight} !important` },
    "body *": { "background-color": "transparent !important" },
    a: { color: `${c.link} !important` },
    "img, svg, video": { "max-width": "100% !important", height: "auto !important", "object-fit": "contain" },
    "::selection": { background: "rgba(244, 185, 58, 0.55)" },
  };
}

/** Unique per combination, so epub.js always re-applies the rules it was handed. */
export function themeName(prefs: Pick<ReaderPrefs, "theme" | "font" | "lineHeight">): string {
  return `bq-${prefs.theme}-${prefs.font}-${String(prefs.lineHeight).replace(".", "_")}`;
}
