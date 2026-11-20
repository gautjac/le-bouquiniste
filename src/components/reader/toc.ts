import type { NavItem } from "epubjs";

export interface FlatTocItem {
  id: string;
  label: string;
  href: string;
  depth: number;
}

/** Depth-first flattening: reading order, with `depth` kept for indentation. */
export function flattenToc(items: NavItem[] | undefined, depth = 0): FlatTocItem[] {
  const out: FlatTocItem[] = [];
  for (const item of items ?? []) {
    out.push({ id: item.id || item.href, label: (item.label ?? "").replace(/\s+/g, " ").trim(), href: item.href, depth });
    if (item.subitems?.length) out.push(...flattenToc(item.subitems, depth + 1));
  }
  return out.filter((i) => i.label);
}

export const stripFragment = (href: string): string => href.split("#")[0];

/**
 * The chapter the reader is in: the last TOC entry whose spine position is at or before
 * the current one. `spineIndexOf` maps a TOC href to its spine index (undefined if unknown).
 */
export function chapterFor(toc: FlatTocItem[], spineIndexOf: (href: string) => number | undefined, currentIndex: number): FlatTocItem | undefined {
  let best: FlatTocItem | undefined;
  let bestIndex = -1;
  for (const item of toc) {
    const index = spineIndexOf(stripFragment(item.href));
    if (index === undefined || index > currentIndex) continue;
    if (index >= bestIndex) {
      best = item;
      bestIndex = index;
    }
  }
  return best;
}

/**
 * Where to open (or re-open) the book. The live position always wins over the one stored when
 * the reader first opened: rebuilding the rendition mid-read (switching between pages and
 * scroll, hot reload…) must never throw the reader back to where the session began.
 */
export function resumeTarget(live: string | undefined | null, stored: string | undefined | null): string | undefined {
  return live || stored || undefined;
}
