/**
 * Network layer: talk to sources directly, fall back to our allowlisted proxy only when
 * the browser blocks the request (CORS / network), and stream downloads with progress.
 */

export type ErrorKind = "network" | "http" | "parse" | "drm" | "invalid" | "cancelled" | "too-large";

export class SourceError extends Error {
  kind: ErrorKind;
  status?: number;
  constructor(message: string, kind: ErrorKind, status?: number) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
    this.status = status;
  }
}

export function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof SourceError && error.kind === "cancelled")
  );
}

export interface FetchOptions {
  signal?: AbortSignal;
  /** Time allowed to receive response headers (not the whole body). */
  timeoutMs?: number;
}

/** Combines a caller's signal with a header timeout. `done()` clears the timer. */
function guard(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export function proxied(url: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Direct first. If the browser refuses (TypeError: CORS or offline), retry through the proxy.
 * A normal HTTP error status from the source is returned as-is — the proxy wouldn't fix it.
 */
export async function fetchResilient(url: string, options: FetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 20_000;

  const attempt = async (target: string): Promise<Response> => {
    const g = guard(options.signal, timeoutMs);
    try {
      return await fetch(target, { signal: g.signal });
    } finally {
      g.done();
    }
  };

  try {
    return await attempt(url);
  } catch (error) {
    if (options.signal?.aborted) throw new SourceError("Annulé", "cancelled");
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new SourceError("La source ne répond pas.", "network");
    }
    // CORS block or network failure: try the proxy once.
    try {
      return await attempt(proxied(url));
    } catch (proxyError) {
      if (options.signal?.aborted) throw new SourceError("Annulé", "cancelled");
      if (proxyError instanceof DOMException && proxyError.name === "TimeoutError") {
        throw new SourceError("La source ne répond pas.", "network");
      }
      throw new SourceError("Source inaccessible.", "network");
    }
  }
}

function ensureOk(response: Response): Response {
  if (!response.ok) {
    throw new SourceError(`La source a répondu ${response.status}.`, "http", response.status);
  }
  return response;
}

export async function fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  const response = ensureOk(await fetchResilient(url, options));
  try {
    return (await response.json()) as T;
  } catch {
    throw new SourceError("Réponse illisible de la source.", "parse");
  }
}

export async function fetchText(url: string, options?: FetchOptions): Promise<string> {
  const response = ensureOk(await fetchResilient(url, options));
  return response.text();
}

export type ProgressFn = (loaded: number, total: number | null) => void;

export interface Downloaded {
  data: ArrayBuffer;
  contentType: string;
}

/** Streams a file, reporting progress. Throws SourceError('too-large') above `maxBytes`. */
export async function downloadBytes(
  url: string,
  onProgress: ProgressFn,
  signal?: AbortSignal,
  maxBytes = 400 * 1024 * 1024,
): Promise<Downloaded> {
  const response = ensureOk(await fetchResilient(url, { signal, timeoutMs: 30_000 }));
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const lengthHeader = response.headers.get("content-length") ?? response.headers.get("x-upstream-length");
  const total = lengthHeader && Number(lengthHeader) > 0 ? Number(lengthHeader) : null;
  if (total && total > maxBytes) {
    await response.body?.cancel();
    throw new SourceError("Ce fichier est trop volumineux.", "too-large");
  }

  if (!response.body) {
    const data = await response.arrayBuffer();
    onProgress(data.byteLength, data.byteLength);
    return { data, contentType };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        if (loaded > maxBytes) {
          await reader.cancel();
          throw new SourceError("Ce fichier est trop volumineux.", "too-large");
        }
        onProgress(loaded, total);
      }
    }
  } catch (error) {
    if (signal?.aborted) throw new SourceError("Annulé", "cancelled");
    throw error;
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress(loaded, loaded);
  return { data: out.buffer, contentType };
}
