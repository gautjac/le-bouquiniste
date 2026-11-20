import JSZip from "jszip";
import { db } from "../db";
import type { Annotation, Book, Shelf } from "../types";
import { SourceError } from "./net";

export const BACKUP_VERSION = 1;

export interface BackupManifest {
  app: "le-bouquiniste";
  version: number;
  exportedAt: number;
  books: Book[];
  shelves: Shelf[];
  annotations: Annotation[];
}

const extensionFor = (book: Book) => (book.format === "pdf" ? "pdf" : "epub");

/** The whole library as one ZIP: library.json + the original book files. */
export async function exportLibrary(onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const [books, shelves, annotations] = await Promise.all([db.books.toArray(), db.shelves.toArray(), db.annotations.toArray()]);
  const manifest: BackupManifest = { app: "le-bouquiniste", version: BACKUP_VERSION, exportedAt: Date.now(), books, shelves, annotations };

  const zip = new JSZip();
  zip.file("library.json", JSON.stringify(manifest));
  let done = 0;
  for (const book of books) {
    const file = await db.files.get(book.id);
    if (file) zip.file(`files/${book.id}.${extensionFor(book)}`, file.data, { binary: true });
    onProgress?.(++done, books.length);
  }
  // EPUBs and PDFs are already compressed; storing them is faster and barely larger.
  return zip.generateAsync({ type: "blob", compression: "STORE", mimeType: "application/zip" });
}

export function parseManifest(json: unknown): BackupManifest {
  const m = json as Partial<BackupManifest> | null;
  if (!m || typeof m !== "object" || m.app !== "le-bouquiniste") {
    throw new SourceError("Ce fichier n'est pas une sauvegarde du Bouquiniste.", "invalid");
  }
  if (typeof m.version !== "number" || m.version > BACKUP_VERSION) {
    throw new SourceError("Cette sauvegarde vient d'une version plus récente de l'app.", "invalid");
  }
  if (!Array.isArray(m.books) || !Array.isArray(m.shelves) || !Array.isArray(m.annotations)) {
    throw new SourceError("Sauvegarde incomplète.", "invalid");
  }
  for (const b of m.books) {
    if (!b || typeof b.id !== "string" || typeof b.title !== "string" || (b.format !== "epub" && b.format !== "pdf")) {
      throw new SourceError("Sauvegarde corrompue (livre invalide).", "invalid");
    }
  }
  return m as BackupManifest;
}

export interface RestoreResult {
  added: number;
  skipped: number;
  missingFiles: number;
  shelves: number;
  annotations: number;
}

/** Merges a backup into the library. Never overwrites or deletes anything that already exists. */
export async function restoreLibrary(
  source: Blob | ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<RestoreResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(source);
  } catch {
    throw new SourceError("Ce fichier n'est pas une sauvegarde valide.", "invalid");
  }
  const raw = await zip.file("library.json")?.async("string");
  if (!raw) throw new SourceError("Sauvegarde sans library.json.", "invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SourceError("library.json illisible.", "invalid");
  }
  const manifest = parseManifest(parsed);

  const result: RestoreResult = { added: 0, skipped: 0, missingFiles: 0, shelves: 0, annotations: 0 };

  for (const shelf of manifest.shelves) {
    if (!(await db.shelves.get(shelf.id))) {
      await db.shelves.add(shelf);
      result.shelves += 1;
    }
  }

  const addedIds = new Set<string>();
  let done = 0;
  for (const book of manifest.books) {
    onProgress?.(done++, manifest.books.length);
    const entry = zip.file(`files/${book.id}.${extensionFor(book)}`);
    if (!entry) {
      result.missingFiles += 1;
      continue;
    }
    const exists =
      (await db.books.get(book.id)) ??
      (await db.books.where("hash").equals(book.hash).first()) ??
      (book.source !== "import" && book.sourceId
        ? await db.books.where("[source+sourceId]").equals([book.source, book.sourceId]).first()
        : undefined);
    if (exists) {
      result.skipped += 1;
      continue;
    }
    const data = await entry.async("arraybuffer");
    await db.transaction("rw", db.books, db.files, async () => {
      await db.books.add({ ...book, shelfIds: book.shelfIds ?? [] });
      await db.files.add({ id: book.id, data, type: book.format === "pdf" ? "application/pdf" : "application/epub+zip" });
    });
    addedIds.add(book.id);
    result.added += 1;
  }
  onProgress?.(manifest.books.length, manifest.books.length);

  // Only restore notes for books we actually brought in, so existing notes are never duplicated.
  const notes = manifest.annotations.filter((a) => addedIds.has(a.bookId));
  if (notes.length) {
    await db.annotations.bulkPut(notes);
    result.annotations = notes.length;
  }

  // Shelves referenced by restored books must exist, even if the manifest omitted one.
  const shelfIds = new Set((await db.shelves.toArray()).map((s) => s.id));
  await db.books.where("id").anyOf([...addedIds]).modify((book) => {
    book.shelfIds = book.shelfIds.filter((id) => shelfIds.has(id));
  });

  return result;
}
