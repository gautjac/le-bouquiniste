import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildEpub, buildPdf, PNG_BYTES } from "../test-utils";
import { detectEpubDrm, looksLikePdf, looksLikeZip, readEpubMeta, readPdfMeta, resolvePath } from "./epub-meta";
import { SourceError } from "./net";

describe("readEpubMeta", () => {
  it("reads title, flips author names, normalizes language, keeps subjects", async () => {
    const meta = await readEpubMeta(await buildEpub({ description: "<p>Un <b>roman</b>.</p>" }));
    expect(meta).toMatchObject({
      title: "Le Livre de Test",
      author: "Jane Austen",
      language: "fr",
      description: "Un roman.",
      subjects: ["Fiction"],
    });
  });

  it("joins at most two authors", async () => {
    const meta = await readEpubMeta(await buildEpub({ authors: ["A, X", "B, Y", "C, Z"] }));
    expect(meta.author).toBe("X A & Y B");
  });

  it.each(["epub3", "epub2", "name"] as const)("finds a cover (%s style)", async (style) => {
    const meta = await readEpubMeta(await buildEpub({ cover: style }));
    expect(meta.cover?.type).toBe("image/png");
    expect(Array.from(new Uint8Array(meta.cover!.data))).toEqual(Array.from(PNG_BYTES));
  });

  it("has no cover when the book has none", async () => {
    expect((await readEpubMeta(await buildEpub({ cover: "none" }))).cover).toBeUndefined();
  });

  it("copes with a package in the zip root and with ./ prefixed paths", async () => {
    const root = await readEpubMeta(await buildEpub({ opfDir: "" }));
    expect(root.title).toBe("Le Livre de Test");
    expect(root.cover?.type).toBe("image/png");
    const zip = await JSZip.loadAsync(await buildEpub({ opfDir: "" }));
    zip.file("META-INF/container.xml", (await zip.file("META-INF/container.xml")!.async("string")).replace('full-path="content.opf"', 'full-path="./content.opf"'));
    expect((await readEpubMeta(await zip.generateAsync({ type: "arraybuffer" }))).title).toBe("Le Livre de Test");
  });

  it("rejects things that are not EPUBs", async () => {
    await expect(readEpubMeta(new TextEncoder().encode("hello").buffer as ArrayBuffer)).rejects.toMatchObject({ kind: "invalid" });
    const zip = new JSZip();
    zip.file("readme.txt", "just a zip");
    await expect(readEpubMeta(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toMatchObject({ kind: "invalid" });
  });

  it("rejects broken XML", async () => {
    const zip = new JSZip();
    zip.file("META-INF/container.xml", "<container><rootfiles><rootfile full-path='a.opf'/></rootfiles></container>");
    zip.file("a.opf", "<package><metadata></package>");
    await expect(readEpubMeta(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toBeInstanceOf(SourceError);
  });
});

describe("DRM detection", () => {
  const encryption = (algorithm: string) =>
    `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/></EncryptedData></encryption>`;

  it("flags Adobe ADEPT (rights.xml)", async () => {
    const epub = await buildEpub({ extra: { "META-INF/rights.xml": "<rights/>" } });
    await expect(readEpubMeta(epub)).rejects.toMatchObject({ kind: "drm" });
  });

  it("flags Readium LCP", async () => {
    const epub = await buildEpub({ extra: { "META-INF/license.lcpl": "{}" } });
    await expect(readEpubMeta(epub)).rejects.toMatchObject({ kind: "drm" });
  });

  it("flags content encrypted with a real cipher", async () => {
    const epub = await buildEpub({ extra: { "META-INF/encryption.xml": encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc") } });
    await expect(readEpubMeta(epub)).rejects.toMatchObject({ kind: "drm" });
  });

  it("does NOT flag font obfuscation, which many ordinary books use", async () => {
    for (const algo of ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]) {
      const epub = await buildEpub({ extra: { "META-INF/encryption.xml": encryption(algo) } });
      expect(await readEpubMeta(epub)).toMatchObject({ title: "Le Livre de Test" });
      expect(await detectEpubDrm(await JSZip.loadAsync(epub))).toBeNull();
    }
  });

  it("explains itself in French", async () => {
    const epub = await buildEpub({ extra: { "META-INF/rights.xml": "<rights/>" } });
    await expect(readEpubMeta(epub)).rejects.toThrow(/DRM/);
  });
});

describe("resolvePath", () => {
  it.each([
    ["OEBPS/content.opf", "images/c.png", "OEBPS/images/c.png"],
    ["OEBPS/content.opf", "../cover.jpg", "cover.jpg"],
    ["content.opf", "c.png", "c.png"],
    ["OEBPS/content.opf", "my%20cover.png", "OEBPS/my cover.png"],
    ["OEBPS/content.opf", "/abs/c.png", "abs/c.png"],
    ["a/b/c.opf", "./x/../y.png#frag", "a/b/y.png"],
  ])("%s + %s", (base, rel, expected) => {
    expect(resolvePath(base, rel)).toBe(expected);
  });
});

describe("format sniffing", () => {
  it("recognizes zip and pdf magic", async () => {
    expect(looksLikeZip(await buildEpub())).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode("<html>").buffer as ArrayBuffer)).toBe(false);
    expect(looksLikePdf(buildPdf())).toBe(true);
    expect(looksLikePdf(await buildEpub())).toBe(false);
    expect(looksLikeZip(new ArrayBuffer(2))).toBe(false);
  });
});

describe("readPdfMeta", () => {
  it("reads plain info strings", () => {
    expect(readPdfMeta(buildPdf({ title: "Les Fleurs du mal", author: "Charles Baudelaire" }))).toEqual({
      title: "Les Fleurs du mal",
      author: "Charles Baudelaire",
    });
  });
  it("handles escapes and ignores 'untitled'", () => {
    expect(readPdfMeta(buildPdf({ title: "A \\(draft\\) title" })).title).toBe("A (draft) title");
    expect(readPdfMeta(buildPdf({ title: "Untitled" })).title).toBeUndefined();
  });
  it("decodes UTF-16BE strings", () => {
    const utf16 = "\xfe\xff\x00H\x00i";
    const bytes = new TextEncoder().encode("%PDF-1.4\n").length;
    expect(bytes).toBeGreaterThan(0);
    const data = Uint8Array.from(`%PDF-1.4\n2 0 obj << /Title (${utf16}) >> endobj`, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
    expect(readPdfMeta(data).title).toBe("Hi");
  });
  it("returns nothing for PDFs without a readable info dictionary", () => {
    expect(readPdfMeta(buildPdf())).toEqual({ title: undefined, author: undefined });
  });
});
