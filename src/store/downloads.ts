import { useSyncExternalStore } from "react";
import { ingestBytes } from "../lib/ingest";
import { downloadBytes, isAbort, SourceError, type ErrorKind } from "../lib/net";
import { PROVIDER_BY_ID, type Hit } from "../providers";

/**
 * In-memory download manager. Lives outside React so a download keeps going while the user
 * browses elsewhere or opens a book. Two at a time, each cancellable, each retryable.
 */

export type DownloadPhase = "queued" | "resolving" | "downloading" | "saving" | "done" | "error";

export interface DownloadState {
  key: string;
  phase: DownloadPhase;
  loaded: number;
  total: number | null;
  bookId?: string;
  duplicate?: boolean;
  errorKind?: ErrorKind | "unknown";
  /** Source-provided detail, shown only for kinds we have no translated message for. */
  errorDetail?: string;
}

export interface DownloadOptions {
  /** Asked when a file is very large. Resolve false to cancel. */
  confirmLarge?: (bytes: number) => boolean | Promise<boolean>;
}

export const MAX_CONCURRENT = 2;
export const LARGE_FILE_BYTES = 120 * 1024 * 1024;

const states = new Map<string, DownloadState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const queue: { hit: Hit; options: DownloadOptions }[] = [];
const settledListeners = new Set<(hit: Hit, state: DownloadState) => void>();
let running = 0;
let activeSnapshot: DownloadState[] = [];

function emit(): void {
  activeSnapshot = [...states.values()].filter((s) => s.phase !== "done" && s.phase !== "error");
  listeners.forEach((l) => l());
}

function set(key: string, patch: Partial<DownloadState> & { phase: DownloadPhase }): void {
  const prev = states.get(key);
  states.set(key, { key, loaded: 0, total: null, ...prev, ...patch });
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called once when a download finishes (done) or fails (error); not on cancel. */
export function onDownloadSettled(listener: (hit: Hit, state: DownloadState) => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

function settled(hit: Hit): void {
  const state = states.get(hit.key);
  if (state) settledListeners.forEach((l) => l(hit, state));
}

export function getDownload(key: string): DownloadState | undefined {
  return states.get(key);
}

export function useDownload(key: string): DownloadState | undefined {
  return useSyncExternalStore(subscribe, () => states.get(key));
}

/** Downloads still in flight (queued, resolving, downloading, saving). Stable between changes. */
export function useActiveDownloads(): DownloadState[] {
  return useSyncExternalStore(subscribe, () => activeSnapshot);
}

export function startDownload(hit: Hit, options: DownloadOptions = {}): void {
  const current = states.get(hit.key);
  if (current && current.phase !== "error" && current.phase !== "done") return;
  states.set(hit.key, { key: hit.key, phase: "queued", loaded: 0, total: null });
  emit();
  queue.push({ hit, options });
  pump();
}

export function cancelDownload(key: string): void {
  const queued = queue.findIndex((j) => j.hit.key === key);
  if (queued >= 0) {
    queue.splice(queued, 1);
    states.delete(key);
    emit();
    return;
  }
  controllers.get(key)?.abort();
}

/** Forget a finished or failed download (removes its card state). */
export function dismissDownload(key: string): void {
  const s = states.get(key);
  if (s && (s.phase === "done" || s.phase === "error")) {
    states.delete(key);
    emit();
  }
}

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    if (job) void run(job.hit, job.options);
  }
}

async function run(hit: Hit, options: DownloadOptions): Promise<void> {
  running += 1;
  const controller = new AbortController();
  controllers.set(hit.key, controller);
  const { signal } = controller;

  try {
    set(hit.key, { phase: "resolving" });
    const resolved = await PROVIDER_BY_ID[hit.source].resolveDownload(hit, signal);

    if (resolved.sizeHint && resolved.sizeHint > LARGE_FILE_BYTES && options.confirmLarge) {
      const ok = await options.confirmLarge(resolved.sizeHint);
      if (!ok) throw new SourceError("Annulé", "cancelled");
    }

    set(hit.key, { phase: "downloading", total: resolved.sizeHint ?? null });
    const { data, contentType } = await downloadBytes(
      resolved.url,
      (loaded, total) => set(hit.key, { phase: "downloading", loaded, total: total ?? resolved.sizeHint ?? null }),
      signal,
    );

    set(hit.key, { phase: "saving" });
    const { book, duplicate } = await ingestBytes(data, contentType, {
      filename: resolved.filename,
      format: resolved.format,
      hit,
      signal,
    });
    set(hit.key, { phase: "done", bookId: book.id, duplicate });
    settled(hit);
  } catch (error) {
    if (isAbort(error) || signal.aborted) {
      states.delete(hit.key);
      emit();
    } else if (error instanceof SourceError) {
      set(hit.key, { phase: "error", errorKind: error.kind, errorDetail: error.message });
      settled(hit);
    } else {
      set(hit.key, {
        phase: "error",
        errorKind: "unknown",
        errorDetail: error instanceof Error ? error.message : String(error),
      });
      settled(hit);
    }
  } finally {
    controllers.delete(hit.key);
    running -= 1;
    pump();
  }
}

/** Test seam: forget everything. */
export function resetDownloadsForTests(): void {
  for (const c of controllers.values()) c.abort();
  states.clear();
  controllers.clear();
  queue.length = 0;
  running = 0;
  emit();
}
