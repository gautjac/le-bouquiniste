/**
 * CORS fallback for book sources.
 *
 * Le Bouquiniste always tries to talk to a source directly from the browser. Some sources
 * (Project Gutenberg's file server, for one) don't send CORS headers, so the browser blocks
 * the response. In that case — and only then — the client retries through this function.
 *
 * Because proxied bytes are served from OUR origin, this is a security boundary:
 *   - only https, only an explicit allowlist of hosts, no credentials, no odd ports;
 *   - redirects are followed by hand and every hop is re-checked against the allowlist;
 *   - GET/HEAD only, with a size cap;
 *   - every response carries `Content-Security-Policy: sandbox` + `nosniff`, so even if an
 *     allowlisted host served HTML, navigating to the proxy URL could never run script here.
 */

export const ALLOWED_HOSTS = [
  "gutenberg.org",
  "gutendex.com",
  "standardebooks.org",
  "archive.org",
] as const;

export const MAX_BYTES = 200 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 25_000;
const USER_AGENT = "LeBouquiniste/1.0 (personal DRM-free reader)";

export function isAllowedUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function reply(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}

export async function handleProxy(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply(405, "Method not allowed");
  }

  const target = new URL(request.url).searchParams.get("url");
  if (!target) return reply(400, "Missing ?url=");

  let current: URL;
  try {
    current = new URL(target);
  } catch {
    return reply(400, "Invalid url");
  }
  if (!isAllowedUrl(current)) return reply(403, "Host not allowed");

  let upstream: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      upstream = await fetchImpl(current.toString(), {
        method: request.method,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return reply(502, "Upstream unreachable");
    }

    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.has("location")) {
      let next: URL;
      try {
        next = new URL(upstream.headers.get("location") ?? "", current);
      } catch {
        return reply(502, "Bad redirect");
      }
      if (!isAllowedUrl(next)) return reply(403, "Redirect target not allowed");
      await upstream.body?.cancel();
      current = next;
      upstream = undefined;
      continue;
    }
    break;
  }
  if (!upstream) return reply(508, "Too many redirects");

  const declared = Number(upstream.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    await upstream.body?.cancel();
    return reply(413, "File too large");
  }

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    "cache-control": upstream.ok ? "public, max-age=600" : "no-store",
    "x-proxied-host": current.hostname,
  });
  // Node's fetch transparently decompresses; a stale content-length would then truncate.
  if (!upstream.headers.has("content-encoding") && upstream.headers.has("content-length")) {
    headers.set("content-length", upstream.headers.get("content-length") ?? "");
  } else if (upstream.headers.has("content-length")) {
    headers.set("x-upstream-length", upstream.headers.get("content-length") ?? "");
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
