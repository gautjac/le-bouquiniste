import { afterEach, describe, expect, it, vi } from "vitest";
import gutendexFixture from "./__fixtures__/gutendex-search.json?raw";
import opdsFixture from "./__fixtures__/gutenberg-opds.xml?raw";
import archiveFixture from "./__fixtures__/archive-search.json?raw";
import archiveMeta from "./__fixtures__/archive-metadata.json?raw";
import seFixture from "./__fixtures__/standardebooks-search.html?raw";
import { archive } from "./archive";
import { gutenberg } from "./gutenberg";
import { PROVIDERS, PROVIDER_BY_ID } from "./index";
import { standardEbooks } from "./standardebooks";

afterEach(() => vi.unstubAllGlobals());

/** Records every URL requested; `route` decides the response per URL. */
function stubFetch(route: (url: URL) => Response | Promise<Response>) {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(String(input), "http://app.test");
      urls.push(url);
      return route(url);
    }),
  );
  return urls;
}

const json = (body: string) => new Response(body, { headers: { "content-type": "application/json" } });

describe("provider registry", () => {
  it("lists Standard Ebooks first and knows every source by id", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["standardebooks", "gutenberg", "archive"]);
    for (const p of PROVIDERS) expect(PROVIDER_BY_ID[p.id]).toBe(p);
  });
  it("only offers 'browse' on sources where an empty query is meaningful", () => {
    expect(PROVIDER_BY_ID.standardebooks.browsable).toBe(true);
    expect(PROVIDER_BY_ID.gutenberg.browsable).toBe(true);
    expect(PROVIDER_BY_ID.archive.browsable).toBe(false);
  });
});

describe("Standard Ebooks search requests", () => {
  it("sorts by popularity when browsing and by relevance when searching", async () => {
    const urls = stubFetch(() => new Response(seFixture));
    await standardEbooks.search({ query: "", page: 1 });
    await standardEbooks.search({ query: " dickens ", page: 2 });
    expect(urls[0].searchParams.get("sort")).toBe("popularity");
    expect(urls[0].searchParams.has("query")).toBe(false);
    expect(urls[1].searchParams.get("query")).toBe("dickens");
    expect(urls[1].searchParams.get("page")).toBe("2");
    expect(urls[1].searchParams.has("sort")).toBe(false);
  });

  it("does not even ask for non-English books — the catalogue has none", async () => {
    const urls = stubFetch(() => new Response(seFixture));
    expect(await standardEbooks.search({ query: "hugo", language: "fr", page: 1 })).toEqual({ hits: [], total: 0, nextPage: null });
    expect(urls).toHaveLength(0);
    expect((await standardEbooks.search({ query: "hugo", language: "en", page: 1 })).hits.length).toBe(3);
  });

  it("resolves its download from the hit", async () => {
    stubFetch(() => new Response(seFixture));
    const { hits } = await standardEbooks.search({ query: "x", page: 1 });
    const resolved = await standardEbooks.resolveDownload(hits[0]);
    expect(resolved.format).toBe("epub");
    expect(resolved.url).toContain("/downloads/");
    expect(resolved.filename).toMatch(/\.epub$/);
    await expect(standardEbooks.resolveDownload({ ...hits[0], downloads: [] })).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("Gutenberg search requests", () => {
  it("passes query, language and page to Gutendex", async () => {
    const urls = stubFetch(() => json(gutendexFixture));
    const page = await gutenberg.search({ query: "hugo", language: "fr", page: 3 });
    expect(urls).toHaveLength(1);
    expect(urls[0].host).toBe("gutendex.com");
    expect(urls[0].searchParams.get("search")).toBe("hugo");
    expect(urls[0].searchParams.get("languages")).toBe("fr");
    expect(urls[0].searchParams.get("page")).toBe("3");
    expect(page.hits.length).toBe(2);
  });

  it("browses with no search term and no page param on page 1", async () => {
    const urls = stubFetch(() => json(gutendexFixture));
    await gutenberg.search({ query: "  ", page: 1 });
    expect(urls[0].search).toBe("");
  });

  it("falls back to Gutenberg's own OPDS feed when Gutendex is down", async () => {
    const urls = stubFetch((url) => (url.host === "gutendex.com" ? new Response("down", { status: 503 }) : new Response(opdsFixture)));
    const page = await gutenberg.search({ query: "hugo", page: 2 });
    expect(urls.map((u) => u.host)).toEqual(["gutendex.com", "www.gutenberg.org"]);
    expect(urls[1].pathname).toBe("/ebooks/search.opds/");
    expect(urls[1].searchParams.get("start_index")).toBe("26");
    expect(page.hits.map((h) => h.sourceId)).toEqual(["135", "2610"]);
  });

  it("reports the original failure when both routes are down", async () => {
    stubFetch(() => new Response("down", { status: 503 }));
    await expect(gutenberg.search({ query: "hugo", page: 1 })).rejects.toMatchObject({ kind: "http", status: 503 });
  });

  it("downloads the EPUB when there is one, else the PDF", async () => {
    stubFetch(() => json(gutendexFixture));
    const { hits } = await gutenberg.search({ query: "austen", page: 1 });
    expect(await gutenberg.resolveDownload(hits[0])).toMatchObject({ format: "epub", filename: "pg1342.epub" });
    expect(await gutenberg.resolveDownload(hits[1])).toMatchObject({ format: "pdf", filename: "pg13846.pdf" });
    await expect(gutenberg.resolveDownload({ ...hits[0], downloads: [] })).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("Internet Archive search & download requests", () => {
  it("always sorts by downloads and keeps the public-domain filter", async () => {
    const urls = stubFetch(() => json(archiveFixture));
    await archive.search({ query: "moby dick", language: "en", page: 2 });
    const params = urls[0].searchParams;
    expect(params.getAll("sort[]")).toEqual(["downloads desc"]);
    expect(params.get("page")).toBe("2");
    expect(params.get("rows")).toBe("24");
    expect(params.get("q")).toContain("-access-restricted-item:true");
    expect(params.get("q")).toContain("language:(");
    expect(params.getAll("fl[]")).toEqual(expect.arrayContaining(["identifier", "title", "creator"]));
  });

  it("resolves a download through the item's file list and refuses items with no free file", async () => {
    stubFetch((url) => {
      if (url.pathname === "/advancedsearch.php") return json(archiveFixture);
      if (url.pathname === "/metadata/mobydick00melv_1") return json(archiveMeta);
      return json(JSON.stringify({ files: [{ name: "x_encrypted.epub", format: "ACS Encrypted EPUB" }] }));
    });
    const { hits } = await archive.search({ query: "x", page: 1 });
    const resolved = await archive.resolveDownload({ ...hits[0], sourceId: "mobydick00melv_1" });
    expect(resolved).toMatchObject({
      format: "epub",
      url: "https://archive.org/download/mobydick00melv_1/mobydick00melv_1.epub",
      sizeHint: 31526226,
    });
    await expect(archive.resolveDownload({ ...hits[0], sourceId: "locked" })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("encodes odd identifiers and file names in the download URL", async () => {
    stubFetch((url) =>
      url.pathname === "/advancedsearch.php" ? json(archiveFixture) : json(JSON.stringify({ files: [{ name: "a b#1.epub", format: "EPUB", size: "10" }] })),
    );
    const { hits } = await archive.search({ query: "x", page: 1 });
    const resolved = await archive.resolveDownload({ ...hits[0], sourceId: "weird id" });
    expect(resolved.url).toBe("https://archive.org/download/weird%20id/a%20b%231.epub");
  });

  it("treats an error payload as a parse failure, not a crash", async () => {
    stubFetch(() => json(JSON.stringify({ error: "overloaded" })));
    await expect(archive.search({ query: "x", page: 1 })).rejects.toMatchObject({ kind: "parse" });
  });
});
