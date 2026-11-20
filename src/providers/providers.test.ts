import { describe, expect, it } from "vitest";
import archiveMetadata from "./__fixtures__/archive-metadata.json?raw";
import archiveSearch from "./__fixtures__/archive-search.json?raw";
import gutendexSearch from "./__fixtures__/gutendex-search.json?raw";
import gutenbergOpds from "./__fixtures__/gutenberg-opds.xml?raw";
import standardEbooksSearch from "./__fixtures__/standardebooks-search.html?raw";
import { buildArchiveQuery, parseArchive, pickArchiveFile } from "./archive";
import { parseGutenbergOpds, parseGutendex } from "./gutenberg";
import { downloadUrlFor, parseStandardEbooks } from "./standardebooks";

const FIXTURES: Record<string, string> = {
  "gutendex-search.json": gutendexSearch,
  "gutenberg-opds.xml": gutenbergOpds,
  "standardebooks-search.html": standardEbooksSearch,
  "archive-search.json": archiveSearch,
  "archive-metadata.json": archiveMetadata,
};
const fixture = (name: string) => FIXTURES[name];

describe("Gutenberg (Gutendex)", () => {
  const page = parseGutendex(JSON.parse(fixture("gutendex-search.json")), 1);

  it("keeps only books with a downloadable EPUB or PDF", () => {
    expect(page.hits.map((h) => h.sourceId)).toEqual(["1342", "13846"]);
  });

  it("maps metadata and normalizes names", () => {
    const hit = page.hits[0];
    expect(hit).toMatchObject({
      key: "gutenberg:1342",
      title: "Pride and Prejudice",
      authors: ["Jane Austen"],
      languages: ["en"],
      detailUrl: "https://www.gutenberg.org/ebooks/1342",
      downloadCount: 98765,
    });
    expect(hit.downloads).toEqual([{ format: "epub", url: "https://www.gutenberg.org/ebooks/1342.epub3.images" }]);
    expect(hit.coverUrl).toContain("pg1342.cover.medium.jpg");
    expect(hit.rights).toMatch(/domaine public/i);
  });

  it("notes permissioned (copyrighted) books honestly and allows PDF-only", () => {
    const hit = page.hits[1];
    expect(hit.rights).toMatch(/permission/i);
    expect(hit.downloads).toEqual([{ format: "pdf", url: "https://www.gutenberg.org/files/13846/13846-pdf.pdf" }]);
    expect(hit.coverUrl).toBe("https://www.gutenberg.org/cache/epub/13846/pg13846.cover.medium.jpg");
  });

  it("reports totals and the next page", () => {
    expect(page.total).toBe(64);
    expect(page.nextPage).toBe(2);
    expect(parseGutendex({ count: 1, next: null, results: [] }, 3).nextPage).toBeNull();
  });
});

describe("Gutenberg (OPDS fallback)", () => {
  const page = parseGutenbergOpds(fixture("gutenberg-opds.xml"), 1);

  it("skips navigation entries and builds file + cover URLs", () => {
    expect(page.hits.map((h) => h.sourceId)).toEqual(["135", "2610"]);
    expect(page.hits[0]).toMatchObject({ title: "Les Misérables", authors: ["Victor Hugo"] });
    expect(page.hits[0].downloads[0].url).toBe("https://www.gutenberg.org/ebooks/135.epub3.images");
  });

  it("detects a next page", () => {
    expect(page.nextPage).toBe(2);
  });

  it("rejects malformed XML", () => {
    expect(() => parseGutenbergOpds("<feed><entry>", 1)).toThrow();
  });
});

describe("Standard Ebooks", () => {
  const page = parseStandardEbooks(fixture("standardebooks-search.html"), 1);

  it("parses real search markup", () => {
    expect(page.hits.length).toBe(3);
    const hit = page.hits[0];
    expect(hit.source).toBe("standardebooks");
    expect(hit.title.length).toBeGreaterThan(0);
    expect(hit.authors[0]).toMatch(/Dickens/);
    expect(hit.languages).toEqual(["en"]);
    expect(hit.coverUrl).toMatch(/^https:\/\/standardebooks\.org\/images\/covers\//);
    expect(hit.detailUrl).toMatch(/^https:\/\/standardebooks\.org\/ebooks\/charles-dickens\//);
  });

  it("builds the download URL the site itself uses", () => {
    expect(downloadUrlFor("/ebooks/jane-austen/pride-and-prejudice")).toBe(
      "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=download",
    );
    expect(downloadUrlFor("/ebooks/a-n-afanasyev/russian-folktales/leonard-a-magnus")).toBe(
      "https://standardebooks.org/ebooks/a-n-afanasyev/russian-folktales/leonard-a-magnus/downloads/a-n-afanasyev_russian-folktales_leonard-a-magnus.epub?source=download",
    );
    expect(page.hits[0].downloads[0].url).toContain("/downloads/");
  });

  it("detects pagination", () => {
    expect(page.nextPage).toBe(2);
    expect(parseStandardEbooks("<main><ol class='ebooks-list'></ol></main>", 1)).toEqual({ hits: [], total: null, nextPage: null });
  });
});

describe("Internet Archive", () => {
  const page = parseArchive(JSON.parse(fixture("archive-search.json")), 1);

  it("maps docs, flips names, and cleans titles", () => {
    expect(page.hits[0]).toMatchObject({
      key: "archive:mobydick00melv_1",
      title: "Moby Dick",
      authors: ["Herman Melville"],
      languages: ["en"],
      year: 1922,
      coverUrl: "https://archive.org/services/img/mobydick00melv_1",
    });
    expect(page.hits[0].downloads).toEqual([]);
  });

  it("joins array descriptions and reports paging", () => {
    expect(page.hits[1].description).toContain("First American edition");
    expect(page.total).toBe(14);
    expect(page.nextPage).toBe(2);
  });

  describe("query building", () => {
    it("always restricts to public-domain, unrestricted, DRM-free-format items", () => {
      const q = buildArchiveQuery("");
      expect(q).toContain("mediatype:texts");
      expect(q).toContain("-access-restricted-item:true");
      expect(q).toContain("collection:americana");
      expect(q).toContain("format:EPUB");
      expect(q).not.toContain("title:");
    });

    it("searches title and creator with AND-ed terms", () => {
      expect(buildArchiveQuery("moby dick")).toContain("(title:(moby AND dick) OR creator:(moby AND dick))");
    });

    it("cannot be used to rewrite the filters (Lucene injection)", () => {
      const q = buildArchiveQuery('x") OR collection:inlibrary OR (title:("y');
      expect(q).not.toContain("inlibrary OR (");
      expect(q.match(/\(/g)?.length).toBe(q.match(/\)/g)?.length);
      expect(q).toContain("-access-restricted-item:true");
      expect(q).not.toMatch(/title:\(x\)/);
    });

    it("adds language variants", () => {
      const q = buildArchiveQuery("hugo", "fr");
      expect(q).toMatch(/language:\(.*fre.*\)/);
    });
  });

  describe("picking a file", () => {
    const files = JSON.parse(fixture("archive-metadata.json")).files;

    it("prefers EPUB over PDF", () => {
      const pick = pickArchiveFile(files);
      expect(pick?.format).toBe("epub");
      expect(pick?.file.name).toBe("mobydick00melv_1.epub");
    });

    it("falls back to OCR'd PDF, never to image-only PDFs", () => {
      const pick = pickArchiveFile(files.filter((f: { format: string }) => f.format !== "EPUB"));
      expect(pick).toMatchObject({ format: "pdf" });
      expect(pick?.file.format).toBe("Text PDF");
    });

    it("refuses encrypted / lending formats entirely", () => {
      expect(
        pickArchiveFile([
          { name: "a_encrypted.epub", format: "ACS Encrypted EPUB" },
          { name: "a.acsm", format: "Item Tile" },
          { name: "b.epub", format: "LCP Encrypted EPUB" },
          { name: "c.pdf", format: "Grayscale PDF" },
        ]),
      ).toBeNull();
    });

    it("chooses the smallest of several EPUBs", () => {
      const pick = pickArchiveFile([
        { name: "big.epub", format: "EPUB", size: "900" },
        { name: "small.epub", format: "EPUB", size: "100" },
      ]);
      expect(pick?.file.name).toBe("small.epub");
    });
  });
});
