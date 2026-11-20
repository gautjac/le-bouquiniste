export type SourceId = "gutenberg" | "standardebooks" | "archive";
export type BookFormat = "epub" | "pdf";

/** One book as a source describes it, before anything is downloaded. */
export interface Hit {
  /** `${source}:${sourceId}` — stable, unique across sources. */
  key: string;
  source: SourceId;
  sourceId: string;
  title: string;
  authors: string[];
  /** ISO 639-1 codes where we could work them out. */
  languages: string[];
  year?: number;
  subjects: string[];
  description?: string;
  coverUrl?: string;
  /** Human page for this book on the source's own site. */
  detailUrl: string;
  /** Short note on why this is free to download. */
  rights: string;
  /** Files we already know about. Empty means "ask the source" (see resolveDownload). */
  downloads: { format: BookFormat; url: string }[];
  downloadCount?: number;
}

export interface SearchOptions {
  query: string;
  /** ISO 639-1; undefined means any language. */
  language?: string;
  /** 1-based. */
  page: number;
  signal?: AbortSignal;
}

export interface SearchPage {
  hits: Hit[];
  total: number | null;
  nextPage: number | null;
}

export interface ResolvedDownload {
  format: BookFormat;
  url: string;
  filename: string;
  sizeHint?: number;
}

export interface Provider {
  id: SourceId;
  label: string;
  /**
   * Whether an empty query gives a worthwhile "popular" list. A source that is an index of
   * millions of scans (Internet Archive) is only useful when searched.
   */
  browsable: boolean;
  search(options: SearchOptions): Promise<SearchPage>;
  resolveDownload(hit: Hit, signal?: AbortSignal): Promise<ResolvedDownload>;
}
