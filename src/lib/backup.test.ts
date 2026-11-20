import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { buildEpub, buildPdf, resetDb } from "../test-utils";
import { exportLibrary, parseManifest, restoreLibrary } from "./backup";
import { ingestBytes } from "./ingest";
import { addAnnotation, createShelf, saveProgress, setBookShelf } from "./ops";

async function seed() {
  const epub = (await ingestBytes(await buildEpub({ title: "Un" }), "", { filename: "un.epub" })).book;
  const pdf = (await ingestBytes(buildPdf({ title: "Deux" }), "", { filename: "deux.pdf" })).book;
  const shelf = await createShelf("Favoris");
  await setBookShelf(epub.id, shelf.id, true);
  await saveProgress(epub.id, 0.42, "epubcfi(/6/4)");
  await addAnnotation({ bookId: epub.id, kind: "highlight", cfi: "c", text: "passage", note: "hm" });
  return { epub, pdf, shelf };
}

beforeEach(resetDb);

describe("backup round-trip", () => {
  it("restores books, files, shelves, progress and annotations into an empty library", async () => {
    const { epub, pdf, shelf } = await seed();
    const before = {
      books: (await db.books.toArray()).sort((a, b) => a.title.localeCompare(b.title)),
      annotations: await db.annotations.toArray(),
    };
    const originalBytes = new Uint8Array((await db.files.get(epub.id))!.data);

    const backup = await exportLibrary();
    await resetDb();
    expect(await db.books.count()).toBe(0);

    const result = await restoreLibrary(backup);
    expect(result).toEqual({ added: 2, skipped: 0, missingFiles: 0, shelves: 1, annotations: 1 });

    const after = (await db.books.toArray()).sort((a, b) => a.title.localeCompare(b.title));
    expect(after).toEqual(before.books);
    expect(await db.annotations.toArray()).toEqual(before.annotations);
    expect((await db.shelves.get(shelf.id))!.name).toBe("Favoris");
    expect(Array.from(new Uint8Array((await db.files.get(epub.id))!.data))).toEqual(Array.from(originalBytes));
    expect((await db.files.get(pdf.id))!.type).toBe("application/pdf");
    expect((await db.books.get(epub.id))!.location).toBe("epubcfi(/6/4)");
  });

  it("is idempotent: restoring twice adds nothing and duplicates no notes", async () => {
    await seed();
    const backup = await exportLibrary();
    const again = await restoreLibrary(backup);
    expect(again).toMatchObject({ added: 0, skipped: 2, annotations: 0 });
    expect(await db.books.count()).toBe(2);
    expect(await db.annotations.count()).toBe(1);
  });

  it("merges into a non-empty library without touching what's there", async () => {
    await seed();
    const backup = await exportLibrary();
    await resetDb();
    const existing = (await ingestBytes(await buildEpub({ title: "Local only" }), "", { filename: "l.epub" })).book;
    await saveProgress(existing.id, 0.9);
    const result = await restoreLibrary(backup);
    expect(result.added).toBe(2);
    expect(await db.books.count()).toBe(3);
    expect((await db.books.get(existing.id))!.progress).toBe(0.9);
  });

  it("reports progress", async () => {
    await seed();
    const ticks: number[] = [];
    await exportLibrary((done) => ticks.push(done));
    expect(ticks).toEqual([1, 2]);
  });

  it("flags books whose file is missing from the archive rather than failing", async () => {
    const { epub } = await seed();
    const zip = await JSZip.loadAsync(await exportLibrary());
    zip.remove(`files/${epub.id}.epub`);
    await resetDb();
    const result = await restoreLibrary(await zip.generateAsync({ type: "arraybuffer" }));
    expect(result).toMatchObject({ added: 1, missingFiles: 1 });
  });
});

describe("restore validation", () => {
  it("rejects non-zips, foreign zips and tampered manifests", async () => {
    await expect(restoreLibrary(new TextEncoder().encode("nope").buffer as ArrayBuffer)).rejects.toMatchObject({ kind: "invalid" });

    const foreign = new JSZip();
    foreign.file("hello.txt", "hi");
    await expect(restoreLibrary(await foreign.generateAsync({ type: "arraybuffer" }))).rejects.toMatchObject({ kind: "invalid" });

    const badJson = new JSZip();
    badJson.file("library.json", "{oops");
    await expect(restoreLibrary(await badJson.generateAsync({ type: "arraybuffer" }))).rejects.toMatchObject({ kind: "invalid" });
  });

  it("validates the manifest shape and version", () => {
    const ok = { app: "le-bouquiniste", version: 1, exportedAt: 1, books: [], shelves: [], annotations: [] };
    expect(parseManifest(ok)).toEqual(ok);
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest({ ...ok, app: "other" })).toThrow(/sauvegarde du Bouquiniste/);
    expect(() => parseManifest({ ...ok, version: 99 })).toThrow(/plus récente/);
    expect(() => parseManifest({ ...ok, books: "x" })).toThrow(/incomplète/);
    expect(() => parseManifest({ ...ok, books: [{ id: 1 }] })).toThrow(/corrompue/);
  });

  it("drops shelf references that don't exist", async () => {
    const { epub } = await seed();
    const zip = await JSZip.loadAsync(await exportLibrary());
    const manifest = JSON.parse(await zip.file("library.json")!.async("string"));
    manifest.shelves = [];
    zip.file("library.json", JSON.stringify(manifest));
    await resetDb();
    await restoreLibrary(await zip.generateAsync({ type: "arraybuffer" }));
    expect((await db.books.get(epub.id))!.shelfIds).toEqual([]);
  });
});
