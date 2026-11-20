import { describe, expect, it, vi } from "vitest";
import { handleProxy, isAllowedUrl, MAX_BYTES } from "./proxy";

const call = (url: string | null, init?: RequestInit) =>
  new Request(`http://localhost/api/proxy${url === null ? "" : `?url=${encodeURIComponent(url)}`}`, init);

function mockFetch(handler: (url: string) => Response) {
  return vi.fn(async (input: RequestInfo | URL) => handler(String(input))) as unknown as typeof fetch;
}

describe("isAllowedUrl", () => {
  it.each([
    ["https://www.gutenberg.org/ebooks/1.epub", true],
    ["https://gutenberg.org/x", true],
    ["https://gutendex.com/books/", true],
    ["https://standardebooks.org/ebooks", true],
    ["https://archive.org/download/a/b.epub", true],
    ["https://ia803208.us.archive.org/16/items/a/b.epub", true],
    ["http://archive.org/x", false],
    ["https://evil.com/", false],
    ["https://archive.org.evil.com/", false],
    ["https://evilarchive.org/", false],
    ["https://user:pw@archive.org/", false],
    ["https://archive.org:8443/", false],
    ["https://127.0.0.1/", false],
    ["https://localhost/", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["file:///etc/passwd", false],
  ])("%s → %s", (url, expected) => {
    expect(isAllowedUrl(new URL(url))).toBe(expected);
  });
});

describe("handleProxy", () => {
  it("rejects non-GET methods, missing and invalid urls", async () => {
    expect((await handleProxy(call("https://archive.org/", { method: "POST" }))).status).toBe(405);
    expect((await handleProxy(call(null))).status).toBe(400);
    expect((await handleProxy(call("not a url"))).status).toBe(400);
  });

  it("refuses hosts outside the allowlist without fetching", async () => {
    const fetchImpl = mockFetch(() => new Response("x"));
    const res = await handleProxy(call("https://evil.com/a"), fetchImpl);
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("streams an allowed file with a neutralizing CSP and nosniff", async () => {
    const fetchImpl = mockFetch(() => new Response("EPUBDATA", { headers: { "content-type": "application/epub+zip", "content-length": "8" } }));
    const res = await handleProxy(call("https://standardebooks.org/a.epub"), fetchImpl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("EPUBDATA");
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("follows redirects between allowed hosts", async () => {
    const seen: string[] = [];
    const fetchImpl = mockFetch((url) => {
      seen.push(url);
      return url.includes("/download/")
        ? new Response(null, { status: 302, headers: { location: "https://dn1.us.archive.org/0/items/x/x.epub" } })
        : new Response("OK");
    });
    const res = await handleProxy(call("https://archive.org/download/x/x.epub"), fetchImpl);
    expect(res.status).toBe(200);
    expect(seen).toEqual(["https://archive.org/download/x/x.epub", "https://dn1.us.archive.org/0/items/x/x.epub"]);
  });

  it("blocks a redirect that leaves the allowlist (SSRF)", async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
    const res = await handleProxy(call("https://archive.org/download/x/x.epub"), fetchImpl);
    expect(res.status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up on redirect loops", async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 302, headers: { location: "https://archive.org/again" } }));
    const res = await handleProxy(call("https://archive.org/loop"), fetchImpl);
    expect(res.status).toBe(508);
  });

  it("enforces the size cap", async () => {
    const fetchImpl = mockFetch(() => new Response("x", { headers: { "content-length": String(MAX_BYTES + 1) } }));
    expect((await handleProxy(call("https://archive.org/huge.pdf"), fetchImpl)).status).toBe(413);
  });

  it("does not cache failures and passes status through", async () => {
    const fetchImpl = mockFetch(() => new Response("down", { status: 503 }));
    const res = await handleProxy(call("https://www.gutenberg.org/x"), fetchImpl);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("maps network failure to 502", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await handleProxy(call("https://archive.org/x"), fetchImpl)).status).toBe(502);
  });

  it("drops a stale content-length when upstream compressed the body", async () => {
    const fetchImpl = mockFetch(
      () => new Response("decoded", { headers: { "content-encoding": "gzip", "content-length": "3" } }),
    );
    const res = await handleProxy(call("https://gutendex.com/books/"), fetchImpl);
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("x-upstream-length")).toBe("3");
  });
});
