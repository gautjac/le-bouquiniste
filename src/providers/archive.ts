import { asArray, cleanTitle, firstOf, languageVariants, normalizeAuthor, normalizeLanguage, stripHtml } from "../lib/names";
import { fetchJson, SourceError } from "../lib/net";
import type { Hit, Provider, ResolvedDownload, SearchOptions, SearchPage } from "./types";

/**
 * Internet Archive, restricted to collections made of public-domain scans, and to items
 * that are not access-restricted (so nothing borrowable / DRM-wrapped ever shows up).
 */

const ADVANCED_SEARCH = "https://archive.org/advancedsearch.php";
const PER_PAGE = 24;
const RIGHTS = "Texte du domaine public numérisé (Internet Archive)";

const PUBLIC_DOMAIN_COLLECTIONS = ["americana", "europeanlibraries", "gutenberg", "universallibrary"];

interface ArchiveDoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  language?: string | string[];
  year?: number | string;
  downloads?: number;
  description?: string | string[];
}

interface ArchiveResponse {
  response: { numFound: number; start: number; docs: ArchiveDoc[] };
}

/** Lucene reserved characters would let a search term rewrite our filters. */
function sanitizeTerms(text: string): string[] {
  return text
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

export function buildArchiveQuery(text: string, language?: string): string {
  const terms = sanitizeTerms(text);
  const clauses: string[] = [];
  if (terms.length) {
    const all = terms.join(" AND ");
    clauses.push(`(title:(${all}) OR creator:(${all}))`);
  }
  clauses.push("mediatype:texts");
  clauses.push(`(${PUBLIC_DOMAIN_COLLECTIONS.map((c) => `collection:${c}`).join(" OR ")})`);
  clauses.push("-access-restricted-item:true");
  clauses.push('(format:EPUB OR format:"Text PDF")');
  if (language) clauses.push(`language:(${languageVariants(language).join(" OR ")})`);
  return clauses.join(" AND ");
}

export function parseArchive(json: ArchiveResponse, page: number): SearchPage {
  // An error payload ({"error": …}) has no `response`; fail as a source error, not a TypeError.
  if (!json?.response || !Array.isArray(json.response.docs)) {
    throw new SourceError("Réponse inattendue de l'Internet Archive.", "parse");
  }
  const { numFound, start, docs } = json.response;
  const hits: Hit[] = docs.map((doc) => {
    const year = Number(doc.year);
    const description = stripHtml(asArray(doc.description).join(" "));
    return {
      key: `archive:${doc.identifier}`,
      source: "archive",
      sourceId: doc.identifier,
      title: cleanTitle(String(firstOf(doc.title) ?? doc.identifier)),
      authors: asArray(doc.creator).map(normalizeAuthor).filter(Boolean).slice(0, 3),
      languages: asArray(doc.language).map((l) => normalizeLanguage(l)).filter((l): l is string => !!l),
      year: Number.isFinite(year) && year > 0 ? year : undefined,
      subjects: [],
      description: description || undefined,
      coverUrl: `https://archive.org/services/img/${doc.identifier}`,
      detailUrl: `https://archive.org/details/${doc.identifier}`,
      rights: RIGHTS,
      downloads: [], // resolved lazily — file names vary per item
      downloadCount: doc.downloads,
    };
  });
  return { hits, total: numFound, nextPage: start + docs.length < numFound ? page + 1 : null };
}

interface ArchiveFile {
  name: string;
  format?: string;
  size?: string;
}

/** Picks a DRM-free file: EPUB first, then OCR'd PDF. Encrypted / lending formats never qualify. */
export function pickArchiveFile(files: ArchiveFile[]): { file: ArchiveFile; format: "epub" | "pdf" } | null {
  const clean = files.filter(
    (f) => !/encrypted|acs|lcp/i.test(f.format ?? "") && !/\.(acsm|lcpl)$/i.test(f.name) && !/_encrypted/i.test(f.name),
  );
  const bySize = (a: ArchiveFile, b: ArchiveFile) => Number(a.size ?? 0) - Number(b.size ?? 0);
  const epub = clean.filter((f) => f.format === "EPUB" && /\.epub$/i.test(f.name)).sort(bySize)[0];
  if (epub) return { file: epub, format: "epub" };
  const pdf = clean.filter((f) => f.format === "Text PDF" && /\.pdf$/i.test(f.name)).sort(bySize)[0];
  if (pdf) return { file: pdf, format: "pdf" };
  return null;
}

export const archive: Provider = {
  id: "archive",
  label: "Internet Archive",
  browsable: false,

  async search({ query, language, page, signal }: SearchOptions): Promise<SearchPage> {
    const params = new URLSearchParams();
    params.set("q", buildArchiveQuery(query, language));
    for (const field of ["identifier", "title", "creator", "language", "year", "downloads", "description"]) {
      params.append("fl[]", field);
    }
    params.set("rows", String(PER_PAGE));
    params.set("page", String(page));
    params.append("sort[]", "downloads desc"); // relevance alone surfaces obscure scans first
    params.set("output", "json");
    const json = await fetchJson<ArchiveResponse>(`${ADVANCED_SEARCH}?${params}`, { signal, timeoutMs: 15_000 });
    return parseArchive(json, page);
  },

  async resolveDownload(hit, signal): Promise<ResolvedDownload> {
    const meta = await fetchJson<{ files?: ArchiveFile[] }>(`https://archive.org/metadata/${encodeURIComponent(hit.sourceId)}`, {
      signal,
      timeoutMs: 15_000,
    });
    const picked = pickArchiveFile(meta.files ?? []);
    if (!picked) {
      throw new SourceError("Aucun fichier EPUB ou PDF libre n'est disponible pour ce livre.", "invalid");
    }
    return {
      format: picked.format,
      url: `https://archive.org/download/${encodeURIComponent(hit.sourceId)}/${encodeURIComponent(picked.file.name)}`,
      filename: picked.file.name,
      sizeHint: Number(picked.file.size) || undefined,
    };
  },
};
