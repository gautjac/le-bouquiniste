import type { Book as EpubBook } from "epubjs";

export interface SearchHit {
  cfi: string;
  excerpt: string;
  /** Spine position, for ordering and for finding the chapter. */
  spineIndex: number;
}

interface SearchableSection {
  index: number;
  load(request?: unknown): Promise<unknown>;
  unload(): void;
  // epub.js 0.3 has this; its bundled typings omit it.
  search?(query: string, maxSequentialElements?: number): { cfi: string; excerpt: string }[];
}

export interface SearchOptions {
  signal: AbortSignal;
  onHits: (hits: SearchHit[]) => void;
  /** Stop once this many passages are found. */
  max?: number;
}

/**
 * Full-text search across every section, streaming hits as each section is scanned so
 * the panel fills in while a long book is still being searched.
 */
export async function searchBook(book: EpubBook, query: string, { signal, onHits, max = 80 }: SearchOptions): Promise<{ truncated: boolean }> {
  const needle = query.trim();
  if (needle.length < 2) return { truncated: false };
  await book.ready;
  const sections = (book.spine as unknown as { spineItems: SearchableSection[] }).spineItems;
  let found = 0;

  for (const section of sections) {
    if (signal.aborted) return { truncated: false };
    try {
      await section.load(book.load.bind(book));
      const matches = section.search?.(needle) ?? [];
      section.unload();
      if (matches.length) {
        const remaining = max - found;
        const hits = matches.slice(0, remaining).map((m) => ({ cfi: m.cfi, excerpt: m.excerpt.replace(/\s+/g, " ").trim(), spineIndex: section.index }));
        found += hits.length;
        if (!signal.aborted) onHits(hits);
        if (found >= max) return { truncated: matches.length > hits.length || section !== sections[sections.length - 1] };
      }
    } catch {
      /* an unreadable section shouldn't sink the whole search */
    }
  }
  return { truncated: false };
}
