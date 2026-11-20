// Ask the browser to keep this app's local data (IndexedDB / localStorage) durable so it
// can't be silently evicted or cleared under storage pressure. Best-effort: browsers grant
// persistence based on engagement / installation, so it may be denied — this never throws
// and never blocks startup. (Settings → Storage shows the result and offers a retry.)
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
