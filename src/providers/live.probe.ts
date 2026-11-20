import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./index";
import type { Hit, Provider } from "./types";

/**
 * Smoke test against the live sources — run with `npm run probe`.
 * When a source changes its markup or API this is what tells you, with the source named.
 * A source being down (Project Gutenberg has maintenance windows) is reported, not failed.
 */
async function probe(provider: Provider, query: string) {
  try {
    return await provider.search({ query, page: 1 });
  } catch (error) {
    console.warn(`[probe] ${provider.label} unreachable right now:`, error instanceof Error ? error.message : error);
    return null;
  }
}

describe.each(PROVIDERS)("live: $label", (provider) => {
  it("returns well-formed hits for a known author", async () => {
    const page = await probe(provider, "dickens");
    if (!page) return;
    expect(page.hits.length).toBeGreaterThan(0);
    for (const hit of page.hits) {
      expect(hit.title.trim(), `title of ${hit.key}`).not.toBe("");
      expect(hit.key).toBe(`${hit.source}:${hit.sourceId}`);
      expect(hit.detailUrl).toMatch(/^https:\/\//);
      expect(hit.rights.length).toBeGreaterThan(0);
    }
  });

  it("resolves a real, DRM-free download for the first hit", async () => {
    const page = await probe(provider, "dickens");
    const hit: Hit | undefined = page?.hits[0];
    if (!hit) return;
    const resolved = await provider.resolveDownload(hit);
    expect(["epub", "pdf"]).toContain(resolved.format);
    const head = await fetch(resolved.url, { method: "HEAD", redirect: "follow" });
    if (head.status >= 500) {
      console.warn(`[probe] ${provider.label} file server is down right now (${head.status}) — skipped`);
      return;
    }
    expect(head.ok, `${resolved.url} → ${head.status}`).toBe(true);
    expect(head.headers.get("content-type") ?? "").not.toMatch(/html/);
  });

  if (provider.browsable) {
    it("browses (empty query) to a popular list", async () => {
      const page = await probe(provider, "");
      if (page) expect(page.hits.length).toBeGreaterThan(5);
    });
  }
});
