import { fetchJson, fetchText, isAbort, SourceError } from "../lib/net";
import { cleanTitle, normalizeAuthor, normalizeLanguage } from "../lib/names";
import type { Hit, Provider, ResolvedDownload, SearchOptions, SearchPage } from "./types";

/**
 * Project Gutenberg, via Gutendex (a JSON API over the catalogue). If Gutendex is down we
 * fall back to Gutenberg's own OPDS search feed, which is slower and has less metadata.
 */

const GUTENDEX = "https://gutendex.com/books/";
const OPDS_SEARCH = "https://www.gutenberg.org/ebooks/search.opds/";
const OPDS_PAGE_SIZE = 25;

const RIGHTS = "Domaine public aux États-Unis (Project Gutenberg)";

interface GutendexBook {
  id: number;
  title: string;
  authors?: { name: string }[];
  subjects?: string[];
  languages?: string[];
  copyright?: boolean | null;
  formats?: Record<string, string>;
  download_count?: number;
}

interface GutendexResponse {
  count: number;
  next: string | null;
  results: GutendexBook[];
}

function coverFor(id: number | string): string {
  return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
}

export function parseGutendex(json: GutendexResponse, page: number): SearchPage {
  const hits: Hit[] = [];
  for (const book of json.results ?? []) {
    const formats = book.formats ?? {};
    const downloads: Hit["downloads"] = [];
    const epub = formats["application/epub+zip"];
    const pdf = formats["application/pdf"];
    if (epub) downloads.push({ format: "epub", url: epub });
    if (pdf) downloads.push({ format: "pdf", url: pdf });
    if (downloads.length === 0) continue;

    hits.push({
      key: `gutenberg:${book.id}`,
      source: "gutenberg",
      sourceId: String(book.id),
      title: cleanTitle(book.title),
      authors: (book.authors ?? []).map((a) => normalizeAuthor(a.name)).filter(Boolean),
      languages: (book.languages ?? []).map((l) => normalizeLanguage(l)).filter((l): l is string => !!l),
      subjects: (book.subjects ?? []).slice(0, 8),
      coverUrl: formats["image/jpeg"] ?? coverFor(book.id),
      detailUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
      rights: book.copyright ? "Diffusé avec la permission des ayants droit (Project Gutenberg)" : RIGHTS,
      downloads,
      downloadCount: book.download_count,
    });
  }
  return { hits, total: json.count ?? null, nextPage: json.next ? page + 1 : null };
}

/** Best-effort parse of Gutenberg's OPDS (Atom) search results. */
export function parseGutenbergOpds(xml: string, page: number): SearchPage {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new SourceError("Flux OPDS illisible.", "parse");

  const hits: Hit[] = [];
  for (const entry of Array.from(doc.getElementsByTagName("entry"))) {
    const idText = entry.getElementsByTagName("id")[0]?.textContent ?? "";
    const idMatch = /\/ebooks\/(\d+)/.exec(idText) ?? /urn:gutenberg:(\d+)/.exec(idText);
    if (!idMatch) continue; // navigation / search-box entries
    const id = idMatch[1];
    const title = entry.getElementsByTagName("title")[0]?.textContent?.trim();
    if (!title) continue;
    const author = entry.getElementsByTagName("content")[0]?.textContent?.trim() ?? "";
    hits.push({
      key: `gutenberg:${id}`,
      source: "gutenberg",
      sourceId: id,
      title: cleanTitle(title),
      authors: author ? [normalizeAuthor(author)] : [],
      languages: [],
      subjects: [],
      coverUrl: coverFor(id),
      detailUrl: `https://www.gutenberg.org/ebooks/${id}`,
      rights: RIGHTS,
      downloads: [{ format: "epub", url: `https://www.gutenberg.org/ebooks/${id}.epub3.images` }],
    });
  }
  const hasNext = Array.from(doc.getElementsByTagName("link")).some((l) => l.getAttribute("rel") === "next");
  return { hits, total: null, nextPage: hasNext ? page + 1 : null };
}

async function searchGutendex({ query, language, page, signal }: SearchOptions): Promise<SearchPage> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("search", query.trim());
  if (language) params.set("languages", language);
  if (page > 1) params.set("page", String(page));
  // Gutendex is a free community service and can take 25s+ to answer; the UI shows a "slow" hint meanwhile.
  const json = await fetchJson<GutendexResponse>(`${GUTENDEX}?${params}`, { signal, timeoutMs: 35_000 });
  return parseGutendex(json, page);
}

async function searchOpds({ query, page, signal }: SearchOptions): Promise<SearchPage> {
  const params = new URLSearchParams({ query: query.trim() || "a" });
  if (page > 1) params.set("start_index", String((page - 1) * OPDS_PAGE_SIZE + 1));
  const xml = await fetchText(`${OPDS_SEARCH}?${params}`, { signal, timeoutMs: 12_000 });
  return parseGutenbergOpds(xml, page);
}

export const gutenberg: Provider = {
  id: "gutenberg",
  label: "Project Gutenberg",
  browsable: true,

  async search(options) {
    try {
      return await searchGutendex(options);
    } catch (error) {
      if (isAbort(error) || (error instanceof SourceError && error.kind === "cancelled")) throw error;
      try {
        return await searchOpds(options);
      } catch (fallbackError) {
        if (isAbort(fallbackError)) throw fallbackError;
        throw error; // report the primary failure
      }
    }
  },

  async resolveDownload(hit): Promise<ResolvedDownload> {
    const pick = hit.downloads.find((d) => d.format === "epub") ?? hit.downloads[0];
    if (!pick) throw new SourceError("Aucun fichier disponible pour ce livre.", "invalid");
    return { format: pick.format, url: pick.url, filename: `pg${hit.sourceId}.${pick.format}` };
  },
};
