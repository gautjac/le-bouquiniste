import { fetchText } from "../lib/net";
import { cleanTitle, normalizeAuthor } from "../lib/names";
import { SourceError } from "../lib/net";
import type { Hit, Provider, ResolvedDownload, SearchOptions, SearchPage } from "./types";

/**
 * Standard Ebooks: carefully produced editions of public-domain English literature.
 * Their OPDS feed requires a login, so we read the public search page instead — its markup
 * is semantic (schema.org RDFa), which makes it stable enough to parse.
 */

const ORIGIN = "https://standardebooks.org";
const PER_PAGE = 24;
const RIGHTS = "Domaine public — édition libre de droits (Standard Ebooks)";

export function downloadUrlFor(path: string): string {
  // /ebooks/jane-austen/pride-and-prejudice → jane-austen_pride-and-prejudice
  const slug = path.replace(/^\/ebooks\//, "").split("/").filter(Boolean).join("_");
  return `${ORIGIN}${path}/downloads/${slug}.epub?source=download`;
}

export function parseStandardEbooks(html: string, page: number): SearchPage {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const hits: Hit[] = [];

  for (const li of Array.from(doc.querySelectorAll('li[typeof="schema:Book"]'))) {
    const path = li.getAttribute("about");
    const title = li.querySelector('[property="schema:name"]')?.textContent?.trim();
    if (!path || !title) continue;
    const author = li.querySelector('.author [property="schema:name"]')?.textContent?.trim();
    const coverSrc = li.querySelector("img")?.getAttribute("src");

    hits.push({
      key: `standardebooks:${path.replace(/^\/ebooks\//, "")}`,
      source: "standardebooks",
      sourceId: path.replace(/^\/ebooks\//, ""),
      title: cleanTitle(title),
      authors: author ? [normalizeAuthor(author)] : [],
      languages: ["en"],
      subjects: [],
      coverUrl: coverSrc ? new URL(coverSrc, ORIGIN).toString() : undefined,
      detailUrl: `${ORIGIN}${path}`,
      rights: RIGHTS,
      downloads: [{ format: "epub", url: downloadUrlFor(path) }],
    });
  }

  const hasNext = !!doc.querySelector('nav.pagination a[rel~="next"]');
  return { hits, total: null, nextPage: hasNext ? page + 1 : null };
}

export const standardEbooks: Provider = {
  id: "standardebooks",
  label: "Standard Ebooks",
  browsable: true,

  async search({ query, language, page, signal }: SearchOptions): Promise<SearchPage> {
    // The whole catalogue is English.
    if (language && language !== "en") return { hits: [], total: 0, nextPage: null };

    const params = new URLSearchParams({ "per-page": String(PER_PAGE) });
    if (query.trim()) params.set("query", query.trim());
    else params.set("sort", "popularity"); // browsing: show what readers love first
    if (page > 1) params.set("page", String(page));
    const html = await fetchText(`${ORIGIN}/ebooks?${params}`, { signal, timeoutMs: 15_000 });
    return parseStandardEbooks(html, page);
  },

  async resolveDownload(hit): Promise<ResolvedDownload> {
    const epub = hit.downloads.find((d) => d.format === "epub");
    if (!epub) throw new SourceError("Aucun fichier disponible pour ce livre.", "invalid");
    return { format: "epub", url: epub.url, filename: `${hit.sourceId.replace(/\//g, "_")}.epub` };
  },
};
