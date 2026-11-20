import type { Hit } from "../providers/types";
import type { Book, BookFormat } from "../types";
import { fetchCoverDataUrl, toCoverDataUrl } from "./cover";
import { looksLikePdf, looksLikeZip, readEpubMeta, readPdfMeta } from "./epub-meta";
import { hashBytes } from "./format";
import { joinAuthors, normalizeLanguage } from "./names";
import { SourceError } from "./net";
import { addBook, type AddResult } from "./ops";

const UNSUPPORTED_EXT = /\.(mobi|azw3?|kfx|kfx-zip|prc|lit|djvu|cbz|cbr|txt|html?|docx?)$/i;
const KINDLE_EXT = /\.(mobi|azw3?|kfx|kfx-zip|prc)$/i;

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s*-\s*/g, " – ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Sans titre";
}

export interface IngestContext {
  filename: string;
  /** If we already know the format (a source told us), it is verified against the bytes. */
  format?: BookFormat;
  /** Present for downloads: the source's metadata wins over what's inside the file. */
  hit?: Hit;
  signal?: AbortSignal;
}

/**
 * The one door into the library. Verifies the bytes really are a DRM-free EPUB/PDF,
 * extracts metadata and a cover, then stores it (or reports the duplicate).
 */
export async function ingestBytes(data: ArrayBuffer, type: string, ctx: IngestContext): Promise<AddResult> {
  const { hit } = ctx;
  const byExtension: BookFormat | undefined = /\.epub$/i.test(ctx.filename) ? "epub" : /\.pdf$/i.test(ctx.filename) ? "pdf" : undefined;
  const format: BookFormat | undefined =
    ctx.format ?? (looksLikePdf(data) ? "pdf" : looksLikeZip(data) ? "epub" : byExtension);

  if (format === "pdf") {
    if (!looksLikePdf(data)) throw new SourceError("Ce fichier n'est pas un PDF valide.", "invalid");
  } else if (format === "epub") {
    if (!looksLikeZip(data)) throw new SourceError("Ce fichier n'est pas un EPUB valide.", "invalid");
  } else {
    throw new SourceError("Format non pris en charge. Utilisez un EPUB ou un PDF.", "invalid");
  }

  let title: string | undefined;
  let author: string | undefined;
  let language: string | undefined;
  let description: string | undefined;
  let subjects: string[] = [];
  let cover: string | undefined;

  if (format === "epub") {
    const meta = await readEpubMeta(data);
    title = meta.title;
    author = meta.author;
    language = meta.language;
    description = meta.description;
    subjects = meta.subjects;
    if (meta.cover) cover = await toCoverDataUrl(meta.cover.data, meta.cover.type);
  } else {
    const meta = readPdfMeta(data);
    title = meta.title;
    author = meta.author;
  }

  if (hit) {
    title = hit.title || title;
    author = hit.authors.length ? joinAuthors(hit.authors) : author;
    language = hit.languages[0] ?? language;
    description = hit.description ?? description;
    if (hit.subjects.length) subjects = hit.subjects;
  }
  if (!cover && hit?.coverUrl) cover = await fetchCoverDataUrl(hit.coverUrl, ctx.signal);

  const hash = await hashBytes(data);
  const input: Omit<Book, "id" | "addedAt" | "progress" | "shelfIds"> = {
    source: hit?.source ?? "import",
    sourceId: hit?.sourceId,
    title: title?.trim() || titleFromFilename(ctx.filename),
    author: author?.trim() ?? "",
    language: normalizeLanguage(language),
    year: hit?.year,
    description,
    subjects,
    format,
    size: data.byteLength,
    hash,
    cover,
    detailUrl: hit?.detailUrl,
    rights: hit?.rights,
  };
  return addBook(input, data, type || (format === "epub" ? "application/epub+zip" : "application/pdf"));
}

export type ImportOutcome =
  | { name: string; ok: true; duplicate: boolean; book: Book }
  | { name: string; ok: false; kind: "drm" | "unsupported" | "invalid" | "error"; message: string };

/** Imports user-chosen files, one result per file; one bad file never stops the rest. */
export async function importFiles(files: File[], onEach?: (outcome: ImportOutcome) => void): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];
  for (const file of files) {
    let outcome: ImportOutcome;
    try {
      if (KINDLE_EXT.test(file.name)) {
        throw new SourceError(
          "Les formats Kindle (AZW, MOBI, KFX) ne sont pas pris en charge — et sont presque toujours protégés par DRM.",
          "invalid",
        );
      }
      if (UNSUPPORTED_EXT.test(file.name)) {
        throw new SourceError("Format non pris en charge. Utilisez un EPUB ou un PDF.", "invalid");
      }
      const data = await file.arrayBuffer();
      const { book, duplicate } = await ingestBytes(data, file.type, { filename: file.name });
      outcome = { name: file.name, ok: true, duplicate, book };
    } catch (error) {
      if (error instanceof SourceError) {
        const kind = error.kind === "drm" ? "drm" : /non pris en charge|Kindle/.test(error.message) ? "unsupported" : "invalid";
        outcome = { name: file.name, ok: false, kind, message: error.message };
      } else {
        outcome = { name: file.name, ok: false, kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    }
    outcomes.push(outcome);
    onEach?.(outcome);
  }
  return outcomes;
}
