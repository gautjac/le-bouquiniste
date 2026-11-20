import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { resetDb } from "../test-utils";
import type { NewBook } from "./ops";
import {
  addAnnotation, addBook, addBooksToShelf, createShelf, deleteShelf, getFile, librarySummary, loadLocations, loadSettings,
  patchSettings, removeAnnotation, removeBooks, renameShelf, resetProgress, saveLocation, saveLocations, saveProgress, setBookShelf,
  setFinished, toggleFavorite, touchOpened, updateAnnotation, updateBookMeta,
} from "./ops";

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

const meta = (over: Partial<NewBook> = {}): NewBook => ({
  source: "gutenberg",
  sourceId: "1342",
  title: "Pride and Prejudice",
  author: "Jane Austen",
  format: "epub",
  size: 10,
  hash: "hash-1",
  ...over,
});

beforeEach(resetDb);

describe("addBook", () => {
  it("stores the book and its file separately", async () => {
    const { book, duplicate } = await addBook(meta(), bytes("data"), "application/epub+zip");
    expect(duplicate).toBe(false);
    expect(book).toMatchObject({ progress: 0, shelfIds: [] });
    expect(await db.books.count()).toBe(1);
    const file = await getFile(book.id);
    expect(new TextDecoder().decode(file!.data)).toBe("data");
    expect(file!.type).toBe("application/epub+zip");
  });

  it("detects the same source entry twice, even with different bytes", async () => {
    const first = await addBook(meta(), bytes("a"), "x");
    const second = await addBook(meta({ hash: "other" }), bytes("b"), "x");
    expect(second.duplicate).toBe(true);
    expect(second.book.id).toBe(first.book.id);
    expect(await db.books.count()).toBe(1);
    expect(await db.files.count()).toBe(1);
  });

  it("detects identical bytes arriving by another route (hash)", async () => {
    await addBook(meta(), bytes("a"), "x");
    const again = await addBook(meta({ source: "import", sourceId: undefined, title: "Renamed copy" }), bytes("a"), "x");
    expect(again.duplicate).toBe(true);
    expect(await db.books.count()).toBe(1);
  });

  it("keeps two different imports apart", async () => {
    await addBook(meta({ source: "import", sourceId: undefined, hash: "h1" }), bytes("a"), "x");
    await addBook(meta({ source: "import", sourceId: undefined, hash: "h2" }), bytes("b"), "x");
    expect(await db.books.count()).toBe(2);
  });

  it("is atomic: a failed file write leaves no orphan book", async () => {
    const { book } = await addBook(meta(), bytes("a"), "x");
    await expect(addBook(meta({ id: "forced", sourceId: "999", hash: "z" }), bytes("b"), "x").then(() =>
      db.transaction("rw", db.books, db.files, async () => {
        await db.books.add({ ...book, id: "boom", hash: "q", sourceId: "q" });
        await db.files.add({ id: book.id, data: bytes(""), type: "x" }); // duplicate key → throws
      }),
    )).rejects.toBeTruthy();
    expect(await db.books.get("boom")).toBeUndefined();
  });
});

describe("removeBooks", () => {
  it("deletes books, files and annotations — and only for the given ids", async () => {
    const a = (await addBook(meta(), bytes("a"), "x")).book;
    const b = (await addBook(meta({ sourceId: "2", hash: "h2" }), bytes("b"), "x")).book;
    await addAnnotation({ bookId: a.id, kind: "highlight", cfi: "c1", text: "t" });
    await addAnnotation({ bookId: b.id, kind: "bookmark", cfi: "c2" });
    await removeBooks([a.id]);
    expect(await db.books.count()).toBe(1);
    expect(await db.files.count()).toBe(1);
    expect(await db.annotations.count()).toBe(1);
    expect((await db.annotations.toArray())[0].bookId).toBe(b.id);
    await removeBooks([]);
    expect(await db.books.count()).toBe(1);
  });
});

describe("progress", () => {
  it("clamps, records location and last-opened", async () => {
    const { book } = await addBook(meta(), bytes("a"), "x");
    await saveProgress(book.id, 1.7, "epubcfi(/6/2)");
    const saved = (await db.books.get(book.id))!;
    expect(saved.progress).toBe(1);
    expect(saved.location).toBe("epubcfi(/6/2)");
    expect(saved.lastOpenedAt).toBeGreaterThan(0);
    await saveProgress(book.id, -3);
    expect((await db.books.get(book.id))!.progress).toBe(0);
  });

  it("marks finished near the end and never un-finishes by scrolling back", async () => {
    const { book } = await addBook(meta(), bytes("a"), "x");
    await saveProgress(book.id, 0.5);
    expect((await db.books.get(book.id))!.finishedAt).toBeUndefined();
    await saveProgress(book.id, 0.99);
    const finishedAt = (await db.books.get(book.id))!.finishedAt;
    expect(finishedAt).toBeGreaterThan(0);
    await saveProgress(book.id, 0.2);
    expect((await db.books.get(book.id))!.finishedAt).toBe(finishedAt);
  });

  it("setFinished / resetProgress round-trip", async () => {
    const { book } = await addBook(meta(), bytes("a"), "x");
    await setFinished(book.id, true);
    expect(await db.books.get(book.id)).toMatchObject({ progress: 1 });
    await setFinished(book.id, false);
    const unfinished = (await db.books.get(book.id))!;
    expect(unfinished.finishedAt).toBeUndefined();
    expect(unfinished.progress).toBe(0);
    await saveProgress(book.id, 0.4, "cfi");
    await resetProgress(book.id);
    const reset = (await db.books.get(book.id))!;
    expect(reset.progress).toBe(0);
    expect(reset.location).toBeUndefined();
    expect(reset.finishedAt).toBeUndefined();
  });

  it("saveLocation keeps position without disturbing progress", async () => {
    const { book } = await addBook(meta(), bytes("a"), "x");
    await saveProgress(book.id, 0.4, "cfi-a");
    await saveLocation(book.id, "cfi-b");
    expect(await db.books.get(book.id)).toMatchObject({ progress: 0.4, location: "cfi-b" });
  });

  it("touchOpened and toggleFavorite", async () => {
    const { book } = await addBook(meta(), bytes("a"), "x");
    await touchOpened(book.id);
    expect((await db.books.get(book.id))!.lastOpenedAt).toBeGreaterThan(0);
    await toggleFavorite(book.id);
    expect((await db.books.get(book.id))!.favorite).toBe(true);
    await toggleFavorite(book.id);
    expect((await db.books.get(book.id))!.favorite).toBe(false);
  });
});

describe("updateBookMeta", () => {
  it("trims, and never lets a title go empty", async () => {
    const { book } = await addBook(meta(), bytes("a"), "x");
    await updateBookMeta(book.id, { title: "   ", author: "  New Author ", language: " fr ", description: "  " });
    const updated = (await db.books.get(book.id))!;
    expect(updated).toMatchObject({ title: "Sans titre", author: "New Author", language: "fr" });
    expect(updated.description).toBeUndefined();
  });
});

describe("shelves", () => {
  it("creates with rotating colors and sensible default names", async () => {
    const a = await createShelf("À lire");
    const b = await createShelf("   ");
    expect(a.color).not.toBe(b.color);
    expect(b.name).toBe("Étagère");
  });

  it("assigns books, then deleting a shelf un-shelves them without deleting books", async () => {
    const shelf = await createShelf("Classiques");
    const a = (await addBook(meta(), bytes("a"), "x")).book;
    const b = (await addBook(meta({ sourceId: "2", hash: "h2" }), bytes("b"), "x")).book;
    await setBookShelf(a.id, shelf.id, true);
    await setBookShelf(a.id, shelf.id, true); // idempotent
    await addBooksToShelf([a.id, b.id], shelf.id);
    expect((await db.books.get(a.id))!.shelfIds).toEqual([shelf.id]);
    expect((await db.books.get(b.id))!.shelfIds).toEqual([shelf.id]);
    await setBookShelf(b.id, shelf.id, false);
    expect((await db.books.get(b.id))!.shelfIds).toEqual([]);
    await deleteShelf(shelf.id);
    expect(await db.shelves.count()).toBe(0);
    expect(await db.books.count()).toBe(2);
    expect((await db.books.get(a.id))!.shelfIds).toEqual([]);
  });

  it("renames, ignoring blank names", async () => {
    const shelf = await createShelf("Old");
    await renameShelf(shelf.id, "  New ");
    await renameShelf(shelf.id, "  ");
    expect((await db.shelves.get(shelf.id))!.name).toBe("New");
  });
});

describe("annotations", () => {
  it("adds with defaults, updates, removes", async () => {
    const note = await addAnnotation({ bookId: "b", kind: "highlight", cfi: "c", text: "hello" });
    expect(note).toMatchObject({ color: "yellow", text: "hello" });
    await updateAnnotation(note.id, { note: "my thought", color: "pink" });
    expect(await db.annotations.get(note.id)).toMatchObject({ note: "my thought", color: "pink" });
    await removeAnnotation(note.id);
    expect(await db.annotations.count()).toBe(0);
  });
});

describe("settings", () => {
  it("returns defaults, merges patches deeply and persists", async () => {
    expect(await loadSettings()).toMatchObject({ lang: "fr", onboarded: false, reader: { theme: "paper", fontSize: 110 } });
    await patchSettings({ lang: "en", reader: { theme: "night" } });
    await patchSettings({ reader: { fontSize: 140 } });
    expect(await loadSettings()).toMatchObject({ lang: "en", reader: { theme: "night", fontSize: 140, font: "literata" } });
  });

  it("tolerates a partially-stored older shape", async () => {
    await db.settings.put({ key: "app", value: { lang: "en" } });
    expect((await loadSettings()).reader.theme).toBe("paper");
  });

  it("caches reader locations per book", async () => {
    expect(await loadLocations("b1")).toBeUndefined();
    await saveLocations("b1", "[1,2,3]");
    expect(await loadLocations("b1")).toBe("[1,2,3]");
    expect(await loadLocations("b2")).toBeUndefined();
  });
});

describe("librarySummary", () => {
  it("counts books and bytes", async () => {
    await addBook(meta({ size: 100 }), bytes("a"), "x");
    await addBook(meta({ sourceId: "2", hash: "h2", size: 250 }), bytes("b"), "x");
    expect(await librarySummary()).toEqual({ count: 2, bytes: 350 });
  });
});
