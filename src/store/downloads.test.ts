import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hit } from "../providers";

const resolveDownload = vi.fn();
const downloadBytes = vi.fn();
const ingestBytes = vi.fn();

vi.mock("../providers", () => ({
  PROVIDER_BY_ID: new Proxy({}, { get: () => ({ resolveDownload }) }),
}));
vi.mock("../lib/ingest", () => ({ ingestBytes: (...args: unknown[]) => ingestBytes(...args) }));
vi.mock("../lib/net", async () => {
  const actual = await vi.importActual<typeof import("../lib/net")>("../lib/net");
  return { ...actual, downloadBytes: (...args: unknown[]) => downloadBytes(...args) };
});

import { SourceError } from "../lib/net";
import {
  cancelDownload, dismissDownload, getDownload, LARGE_FILE_BYTES, MAX_CONCURRENT, onDownloadSettled, resetDownloadsForTests, startDownload,
} from "./downloads";

const hit = (id: string): Hit => ({
  key: `gutenberg:${id}`, source: "gutenberg", sourceId: id, title: `Book ${id}`, authors: [], languages: [],
  subjects: [], detailUrl: "", rights: "", downloads: [],
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

beforeEach(() => {
  resetDownloadsForTests();
  resolveDownload.mockReset().mockResolvedValue({ format: "epub", url: "https://x/y.epub", filename: "y.epub" });
  downloadBytes.mockReset().mockImplementation(async (_u: string, onProgress: (l: number, t: number | null) => void) => {
    onProgress(5, 10);
    return { data: new ArrayBuffer(10), contentType: "application/epub+zip" };
  });
  ingestBytes.mockReset().mockResolvedValue({ book: { id: "book-1" }, duplicate: false });
});
afterEach(() => resetDownloadsForTests());

describe("download manager", () => {
  it("runs a download through to done and records the book id", async () => {
    startDownload(hit("1"));
    expect(getDownload("gutenberg:1")?.phase).toBe("resolving"); // a free slot starts it at once
    await flush();
    expect(getDownload("gutenberg:1")).toMatchObject({ phase: "done", bookId: "book-1", duplicate: false });
    expect(ingestBytes).toHaveBeenCalledWith(expect.anything(), "application/epub+zip", expect.objectContaining({ format: "epub", filename: "y.epub" }));
  });

  it("limits concurrency and starts queued ones as slots free up", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    let i = 0;
    downloadBytes.mockImplementation(async () => {
      await gates[i++].promise;
      return { data: new ArrayBuffer(1), contentType: "x" };
    });
    ["1", "2", "3"].forEach((id) => startDownload(hit(id)));
    await flush();
    expect(MAX_CONCURRENT).toBe(2);
    expect(getDownload("gutenberg:1")?.phase).toBe("downloading");
    expect(getDownload("gutenberg:2")?.phase).toBe("downloading");
    expect(getDownload("gutenberg:3")?.phase).toBe("queued");
    gates[0].resolve();
    await flush();
    expect(getDownload("gutenberg:1")?.phase).toBe("done");
    expect(getDownload("gutenberg:3")?.phase).toBe("downloading");
    gates[1].resolve();
    gates[2].resolve();
    await flush();
    expect(getDownload("gutenberg:3")?.phase).toBe("done");
  });

  it("ignores a second start for something already in flight", async () => {
    startDownload(hit("1"));
    startDownload(hit("1"));
    await flush();
    expect(resolveDownload).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued download without ever starting it", async () => {
    const gate = deferred<void>();
    downloadBytes.mockImplementation(async () => {
      await gate.promise;
      return { data: new ArrayBuffer(1), contentType: "x" };
    });
    ["1", "2", "3"].forEach((id) => startDownload(hit(id)));
    await flush();
    cancelDownload("gutenberg:3");
    expect(getDownload("gutenberg:3")).toBeUndefined();
    gate.resolve();
    await flush();
    expect(resolveDownload).toHaveBeenCalledTimes(2);
  });

  it("cancels an in-flight download and clears its state", async () => {
    downloadBytes.mockImplementation(
      (_u: string, _p: unknown, signal: AbortSignal) =>
        new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new SourceError("Annulé", "cancelled")))),
    );
    startDownload(hit("1"));
    await flush();
    expect(getDownload("gutenberg:1")?.phase).toBe("downloading");
    cancelDownload("gutenberg:1");
    await flush();
    expect(getDownload("gutenberg:1")).toBeUndefined();
    expect(ingestBytes).not.toHaveBeenCalled();
  });

  it("surfaces errors by kind, never saves, and can be retried", async () => {
    ingestBytes.mockRejectedValueOnce(new SourceError("DRM!", "drm"));
    startDownload(hit("1"));
    await flush();
    expect(getDownload("gutenberg:1")).toMatchObject({ phase: "error", errorKind: "drm", errorDetail: "DRM!" });
    startDownload(hit("1"));
    await flush();
    expect(getDownload("gutenberg:1")?.phase).toBe("done");
  });

  it("wraps unexpected exceptions", async () => {
    resolveDownload.mockRejectedValueOnce(new Error("kaboom"));
    startDownload(hit("1"));
    await flush();
    expect(getDownload("gutenberg:1")).toMatchObject({ phase: "error", errorKind: "unknown", errorDetail: "kaboom" });
  });

  it("asks before fetching a huge file and honours a refusal", async () => {
    resolveDownload.mockResolvedValue({ format: "pdf", url: "u", filename: "f.pdf", sizeHint: LARGE_FILE_BYTES + 1 });
    const confirmLarge = vi.fn().mockResolvedValue(false);
    startDownload(hit("1"), { confirmLarge });
    await flush();
    expect(confirmLarge).toHaveBeenCalledWith(LARGE_FILE_BYTES + 1);
    expect(downloadBytes).not.toHaveBeenCalled();
    expect(getDownload("gutenberg:1")).toBeUndefined();

    confirmLarge.mockResolvedValue(true);
    startDownload(hit("1"), { confirmLarge });
    await flush();
    expect(getDownload("gutenberg:1")?.phase).toBe("done");
  });

  it("flags duplicates and can dismiss finished cards", async () => {
    ingestBytes.mockResolvedValue({ book: { id: "old" }, duplicate: true });
    startDownload(hit("1"));
    await flush();
    expect(getDownload("gutenberg:1")).toMatchObject({ duplicate: true, bookId: "old" });
    dismissDownload("gutenberg:1");
    expect(getDownload("gutenberg:1")).toBeUndefined();
    startDownload(hit("2"));
    dismissDownload("gutenberg:2"); // still active: must not be dropped
    expect(getDownload("gutenberg:2")).toBeDefined();
  });

  it("announces completion and failure once each, but not cancellation", async () => {
    const seen: string[] = [];
    const off = onDownloadSettled((h, state) => seen.push(`${h.sourceId}:${state.phase}`));
    startDownload(hit("1"));
    await flush();
    ingestBytes.mockRejectedValueOnce(new SourceError("x", "invalid"));
    startDownload(hit("2"));
    await flush();
    downloadBytes.mockImplementationOnce(
      (_u: string, _p: unknown, signal: AbortSignal) =>
        new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new SourceError("Annulé", "cancelled")))),
    );
    startDownload(hit("3"));
    await flush();
    cancelDownload("gutenberg:3");
    await flush();
    off();
    expect(seen).toEqual(["1:done", "2:error"]);
  });
});
