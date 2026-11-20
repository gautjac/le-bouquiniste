import { db } from "../db";
import type { Annotation, Book, BookFile, HighlightColor, Settings, Shelf } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { newId } from "./format";

/* ───────────────────────── books ───────────────────────── */

export type NewBook = Omit<Book, "id" | "addedAt" | "progress" | "shelfIds"> &
  Partial<Pick<Book, "id" | "addedAt" | "progress" | "shelfIds" | "location" | "lastOpenedAt" | "finishedAt" | "favorite">>;

export interface AddResult {
  book: Book;
  /** True when the same book was already in the library (nothing was written). */
  duplicate: boolean;
}

/** Finds the book this one would duplicate: same source entry, or identical file bytes. */
async function findDuplicate(input: Pick<Book, "source" | "sourceId" | "hash">): Promise<Book | undefined> {
  if (input.source !== "import" && input.sourceId) {
    const bySource = await db.books.where("[source+sourceId]").equals([input.source, input.sourceId]).first();
    if (bySource) return bySource;
  }
  return db.books.where("hash").equals(input.hash).first();
}

export async function addBook(input: NewBook, data: ArrayBuffer, type: string): Promise<AddResult> {
  return db.transaction("rw", db.books, db.files, async () => {
    const existing = await findDuplicate(input);
    if (existing) return { book: existing, duplicate: true };

    const book: Book = {
      ...input,
      id: input.id ?? newId(),
      addedAt: input.addedAt ?? Date.now(),
      progress: input.progress ?? 0,
      shelfIds: input.shelfIds ?? [],
    };
    await db.books.add(book);
    await db.files.add({ id: book.id, data, type } satisfies BookFile);
    return { book, duplicate: false };
  });
}

export async function getFile(id: string): Promise<BookFile | undefined> {
  return db.files.get(id);
}

export async function removeBooks(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.transaction("rw", db.books, db.files, db.annotations, async () => {
    await db.books.bulkDelete(ids);
    await db.files.bulkDelete(ids);
    await db.annotations.where("bookId").anyOf(ids).delete();
  });
}

/** Saves reading position. Reaching the end marks the book finished; it never un-finishes. */
export async function saveProgress(id: string, progress: number, location?: string): Promise<void> {
  const clamped = Math.min(Math.max(progress, 0), 1);
  await db.books.where("id").equals(id).modify((book) => {
    book.progress = clamped;
    if (location !== undefined) book.location = location;
    book.lastOpenedAt = Date.now();
    if (clamped >= 0.985 && !book.finishedAt) book.finishedAt = Date.now();
  });
}

/** Remembers where the reader is without touching progress (used while page numbering is still being computed). */
export async function saveLocation(id: string, location: string): Promise<void> {
  await db.books.update(id, { location, lastOpenedAt: Date.now() });
}

export async function touchOpened(id: string): Promise<void> {
  await db.books.update(id, { lastOpenedAt: Date.now() });
}

export async function setFinished(id: string, finished: boolean): Promise<void> {
  await db.books.where("id").equals(id).modify((book) => {
    if (finished) {
      book.finishedAt = Date.now();
      book.progress = 1;
    } else {
      delete book.finishedAt;
      if (book.progress >= 0.985) book.progress = 0;
    }
  });
}

export async function resetProgress(id: string): Promise<void> {
  await db.books.where("id").equals(id).modify((book) => {
    book.progress = 0;
    delete book.location;
    delete book.finishedAt;
  });
}

export async function toggleFavorite(id: string): Promise<void> {
  await db.books.where("id").equals(id).modify((book) => {
    book.favorite = !book.favorite;
  });
}

export async function updateBookMeta(
  id: string,
  patch: Partial<Pick<Book, "title" | "author" | "language" | "description">>,
): Promise<void> {
  const clean: typeof patch = {};
  if (patch.title !== undefined) clean.title = patch.title.trim() || "Sans titre";
  if (patch.author !== undefined) clean.author = patch.author.trim();
  if (patch.language !== undefined) clean.language = patch.language.trim() || undefined;
  if (patch.description !== undefined) clean.description = patch.description.trim() || undefined;
  await db.books.update(id, clean);
}

/** Library-wide totals for the settings screen. */
export async function librarySummary(): Promise<{ count: number; bytes: number }> {
  let bytes = 0;
  let count = 0;
  await db.books.each((book) => {
    count += 1;
    bytes += book.size;
  });
  return { count, bytes };
}

/* ───────────────────────── shelves ───────────────────────── */

export const SHELF_COLORS = ["#d64026", "#0e4a36", "#f4b93a", "#245ed6", "#8a3a8c", "#1f8a8a", "#6b4b2a"];

export async function createShelf(name: string, color?: string): Promise<Shelf> {
  const count = await db.shelves.count();
  const shelf: Shelf = {
    id: newId(),
    name: name.trim() || "Étagère",
    color: color ?? SHELF_COLORS[count % SHELF_COLORS.length],
    createdAt: Date.now(),
  };
  await db.shelves.add(shelf);
  return shelf;
}

export async function renameShelf(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed) await db.shelves.update(id, { name: trimmed });
}

export async function deleteShelf(id: string): Promise<void> {
  await db.transaction("rw", db.shelves, db.books, async () => {
    await db.shelves.delete(id);
    await db.books.where("shelfIds").equals(id).modify((book) => {
      book.shelfIds = book.shelfIds.filter((s) => s !== id);
    });
  });
}

export async function setBookShelf(bookId: string, shelfId: string, on: boolean): Promise<void> {
  await db.books.where("id").equals(bookId).modify((book) => {
    const has = book.shelfIds.includes(shelfId);
    if (on && !has) book.shelfIds = [...book.shelfIds, shelfId];
    if (!on && has) book.shelfIds = book.shelfIds.filter((s) => s !== shelfId);
  });
}

export async function addBooksToShelf(bookIds: string[], shelfId: string): Promise<void> {
  await db.books.where("id").anyOf(bookIds).modify((book) => {
    if (!book.shelfIds.includes(shelfId)) book.shelfIds = [...book.shelfIds, shelfId];
  });
}

/* ───────────────────────── annotations ───────────────────────── */

export async function addAnnotation(
  input: Omit<Annotation, "id" | "createdAt" | "color"> & { color?: HighlightColor },
): Promise<Annotation> {
  const annotation: Annotation = { ...input, color: input.color ?? "yellow", id: newId(), createdAt: Date.now() };
  await db.annotations.add(annotation);
  return annotation;
}

export async function updateAnnotation(id: string, patch: Partial<Pick<Annotation, "note" | "color">>): Promise<void> {
  await db.annotations.update(id, patch);
}

export async function removeAnnotation(id: string): Promise<void> {
  await db.annotations.delete(id);
}

/* ───────────────────────── settings ───────────────────────── */

const SETTINGS_KEY = "app";

function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    reader: { ...DEFAULT_SETTINGS.reader, ...stored?.reader },
  };
}

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get(SETTINGS_KEY);
  return mergeSettings(row?.value as Partial<Settings> | undefined);
}

export async function patchSettings(patch: Partial<Omit<Settings, "reader">> & { reader?: Partial<Settings["reader"]> }): Promise<Settings> {
  return db.transaction("rw", db.settings, async () => {
    const current = await loadSettings();
    const next: Settings = { ...current, ...patch, reader: { ...current.reader, ...patch.reader } };
    await db.settings.put({ key: SETTINGS_KEY, value: next });
    return next;
  });
}

/** Cached epub.js "locations" (page-ish positions) so big books don't re-index on every open. */
export async function loadLocations(bookId: string): Promise<string | undefined> {
  const row = await db.settings.get(`locations:${bookId}`);
  return typeof row?.value === "string" ? row.value : undefined;
}

export async function saveLocations(bookId: string, serialized: string): Promise<void> {
  await db.settings.put({ key: `locations:${bookId}`, value: serialized });
}
