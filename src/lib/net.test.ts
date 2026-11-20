import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBytes, fetchJson, fetchResilient, isAbort, proxied, SourceError } from "./net";
import { coverPalette, toCoverDataUrl } from "./cover";
import { formatBytes, formatMinutes, formatPercent, hashBytes, relativeTime } from "./format";

afterEach(() => vi.unstubAllGlobals());

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("fetchResilient", () => {
  it("uses the direct response when the browser allows it", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchResilient("https://standardebooks.org/x");
    expect(await res.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the proxy on a CORS/network failure", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!String(url).startsWith("/api/proxy")) throw new TypeError("Failed to fetch");
      return new Response("via proxy");
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchResilient("https://www.gutenberg.org/a.epub");
    expect(await res.text()).toBe("via proxy");
    expect(fetchMock).toHaveBeenNthCalledWith(2, proxied("https://www.gutenberg.org/a.epub"), expect.anything());
  });

  it("does NOT use the proxy for a normal HTTP error — that would not help", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchResilient("https://archive.org/missing");
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a network error when both routes fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(fetchResilient("https://archive.org/x")).rejects.toMatchObject({ kind: "network" });
  });

  it("honours cancellation without trying the proxy", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    const error = await fetchResilient("https://archive.org/x", { signal: controller.signal }).catch((e) => e);
    expect(isAbort(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetchJson maps bad status and bad bodies to SourceError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(fetchJson("https://gutendex.com/")).rejects.toMatchObject({ kind: "http", status: 503 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>")));
    await expect(fetchJson("https://gutendex.com/")).rejects.toMatchObject({ kind: "parse" });
  });
});

describe("downloadBytes", () => {
  it("streams, reports progress and returns the bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(["abc", "defg", "h"]), { headers: { "content-length": "8", "content-type": "application/epub+zip" } })));
    const seen: [number, number | null][] = [];
    const { data, contentType } = await downloadBytes("https://archive.org/x.epub", (l, t) => seen.push([l, t]));
    expect(new TextDecoder().decode(data)).toBe("abcdefgh");
    expect(contentType).toBe("application/epub+zip");
    expect(seen[0]).toEqual([3, 8]);
    expect(seen.at(-1)).toEqual([8, 8]);
  });

  it("copes with an unknown length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(["xy"]))));
    const seen: (number | null)[] = [];
    await downloadBytes("https://archive.org/x", (_l, t) => seen.push(t));
    expect(seen[0]).toBeNull();
  });

  it("rejects over-large files up front and mid-stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { headers: { "content-length": "1000" } })));
    await expect(downloadBytes("https://archive.org/x", () => {}, undefined, 10)).rejects.toMatchObject({ kind: "too-large" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(["0123456789", "0123456789"]))));
    await expect(downloadBytes("https://archive.org/x", () => {}, undefined, 15)).rejects.toMatchObject({ kind: "too-large" });
  });

  it("surfaces HTTP failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(downloadBytes("https://www.gutenberg.org/x", () => {})).rejects.toBeInstanceOf(SourceError);
  });
});

describe("format helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 Ko");
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(1536)).toBe("1,5 Ko");
    expect(formatBytes(31_526_226)).toBe("30,1 Mo");
    expect(formatBytes(500 * 1024 * 1024)).toBe("500 Mo");
    expect(formatBytes(31_526_226, "en")).toBe("30.1 MB");
    expect(formatBytes(0, "en")).toBe("0 KB");
    expect(formatBytes(7.5 * 1024 ** 3, "fr")).toBe("7,5 Go");
  });
  it("formats durations and percentages", () => {
    expect(formatMinutes(0.2)).toBe("< 1 min");
    expect(formatMinutes(42)).toBe("42 min");
    expect(formatMinutes(125)).toBe("2 h 05");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatPercent(0.456)).toBe("46 %");
    expect(formatPercent(7)).toBe("100 %");
    expect(formatPercent(-1)).toBe("0 %");
  });
  it("formats relative time", () => {
    const now = Date.UTC(2026, 10, 20, 12);
    expect(relativeTime(now - 3 * 3600_000, "fr", now)).toMatch(/3 heures/);
    expect(relativeTime(now - 86400_000, "fr", now)).toMatch(/hier/);
    expect(relativeTime(now - 2 * 86400_000 * 30, "en", now)).toMatch(/2 months ago/);
  });
  it("hashes equal bytes equally and different bytes differently", async () => {
    const a = new TextEncoder().encode("hello").buffer as ArrayBuffer;
    const b = new TextEncoder().encode("hello").buffer as ArrayBuffer;
    const c = new TextEncoder().encode("hellp").buffer as ArrayBuffer;
    expect(await hashBytes(a)).toBe(await hashBytes(b));
    expect(await hashBytes(a)).not.toBe(await hashBytes(c));
  });
});

describe("covers", () => {
  it("picks a stable palette per seed", () => {
    expect(coverPalette("Moby Dick")).toEqual(coverPalette("Moby Dick"));
    const distinct = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((s) => coverPalette(s).bg));
    expect(distinct.size).toBeGreaterThan(2);
  });
  it("keeps small images and drops huge ones when canvas is unavailable", async () => {
    expect(await toCoverDataUrl(new ArrayBuffer(0), "image/png")).toBeUndefined();
    expect((await toCoverDataUrl(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, "image/png"))?.startsWith("data:image/png;base64,")).toBe(true);
    expect(await toCoverDataUrl(new ArrayBuffer(400 * 1024), "image/jpeg")).toBeUndefined();
  });
});
