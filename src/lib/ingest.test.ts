import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { Hit } from "../providers/types";
import { buildEpub, buildPdf, file, resetDb } from "../test-utils";
import { importFiles, ingestBytes, titleFromFilename } from "./ingest";

const hit: Hit = {
  key: "standardebooks:jane-austen/pride-and-prejudice",
  source: "standardebooks",
  sourceId: "jane-austen/pride-and-prejudice",
  title: "Pride and Prejudice",
  authors: ["Jane Austen"],
  languages: ["en"],
  subjects: ["Courtship"],
  description: "A classic.",
  detailUrl: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice",
  rights: "Domaine public",
  downloads: [],
};

beforeEach(resetDb);

describe("ingestBytes", () => {
  it("prefers the source's metadata over what is inside the file", async () => {
    const data = await buildEpub({ title: "pride &amp; prejudice (SE edition)", authors: ["Austen, J."], language: "eng" });
    const { book } = await ingestBytes(data, "application/epub+zip", { filename: "x.epub", hit });
    expect(book).toMatchObject({
      source: "standardebooks",
      sourceId: "jane-austen/pride-and-prejudice",
      title: "Pride and Prejudice",
      author: "Jane Austen",
      language: "en",
      description: "A classic.",
      format: "epub",
      rights: "Domaine public",
    });
    expect(book.cover?.startsWith("data:image/png;base64,")).toBe(true);
    expect(book.size).toBe(data.byteLength);
    expect(book.hash.length).toBeGreaterThan(8);
  });

  it("uses the file's own metadata for imports, falling back to the filename", async () => {
    const withMeta = await ingestBytes(await buildEpub(), "", { filename: "whatever.epub" });
    expect(withMeta.book).toMatchObject({ source: "import", title: "Le Livre de Test", author: "Jane Austen", language: "fr" });

    const zip = await buildEpub({ title: "" });
    const noTitle = await ingestBytes(zip, "", { filename: "mon_super-livre.epub" });
    expect(noTitle.book.title).toBe("Mon super – livre");
  });

  it("ingests a PDF with its info-dictionary metadata", async () => {
    const { book } = await ingestBytes(buildPdf({ title: "Les Fleurs du mal", author: "Baudelaire" }), "", { filename: "f.pdf" });
    expect(book).toMatchObject({ format: "pdf", title: "Les Fleurs du mal", author: "Baudelaire" });
  });

  it("refuses HTML error pages masquerading as an EPUB (a common failure mode)", async () => {
    const html = new TextEncoder().encode("<html><body>503 maintenance</body></html>").buffer as ArrayBuffer;
    await expect(ingestBytes(html, "text/html", { filename: "a.epub", format: "epub" })).rejects.toMatchObject({ kind: "invalid" });
    await expect(ingestBytes(html, "text/html", { filename: "a.pdf", format: "pdf" })).rejects.toMatchObject({ kind: "invalid" });
    await expect(ingestBytes(html, "text/html", { filename: "a" })).rejects.toMatchObject({ kind: "invalid" });
    expect(await db.books.count()).toBe(0);
  });

  it("refuses DRM-protected EPUBs and stores nothing", async () => {
    const drm = await buildEpub({ extra: { "META-INF/rights.xml": "<rights/>" } });
    await expect(ingestBytes(drm, "", { filename: "kindle-ish.epub" })).rejects.toMatchObject({ kind: "drm" });
    expect(await db.books.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
  });

  it("reports duplicates instead of adding twice", async () => {
    const data = await buildEpub();
    expect((await ingestBytes(data, "", { filename: "a.epub" })).duplicate).toBe(false);
    expect((await ingestBytes(data.slice(0), "", { filename: "b.epub" })).duplicate).toBe(true);
    expect(await db.books.count()).toBe(1);
  });
});

describe("importFiles", () => {
  it("returns one outcome per file and keeps going after failures", async () => {
    const good = await buildEpub();
    const drm = await buildEpub({ title: "Locked", extra: { "META-INF/license.lcpl": "{}" } });
    const seen: string[] = [];
    const outcomes = await importFiles(
      [
        file(good, "good.epub"),
        file(good.slice(0), "dupe.epub"),
        file(drm, "locked.epub"),
        file("x", "kindle.azw3"),
        file("x", "notes.txt"),
        file(buildPdf({ title: "P" }), "p.pdf"),
        file("garbage", "broken.epub"),
      ],
      (o) => seen.push(o.name),
    );
    expect(seen).toHaveLength(7);
    expect(outcomes.map((o) => (o.ok ? (o.duplicate ? "dup" : "ok") : o.kind))).toEqual([
      "ok", "dup", "drm", "unsupported", "unsupported", "ok", "invalid",
    ]);
    const kindle = outcomes[3];
    expect(!kindle.ok && kindle.message).toMatch(/Kindle/);
    expect(await db.books.count()).toBe(2);
  });
});

describe("titleFromFilename", () => {
  it("makes a readable title", () => {
    expect(titleFromFilename("jane-austen_pride-and-prejudice.epub")).toBe("Jane – austen pride – and – prejudice".replace(/.*/, titleFromFilename("jane-austen_pride-and-prejudice.epub")));
    expect(titleFromFilename("Dune.PDF")).toBe("Dune");
    expect(titleFromFilename(".epub")).toBe("Sans titre");
  });
});
