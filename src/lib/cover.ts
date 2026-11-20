import { fetchResilient } from "./net";

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Shrinks a cover to a small JPEG data URL so a library of hundreds of books stays light.
 * Without canvas support (tests, odd environments) small images are kept as-is and large
 * ones dropped — a generated cover takes over.
 */
export async function toCoverDataUrl(data: ArrayBuffer, type: string, maxWidth = 360): Promise<string | undefined> {
  if (!data.byteLength) return undefined;
  try {
    if (typeof createImageBitmap === "function" && typeof document !== "undefined") {
      const bitmap = await createImageBitmap(new Blob([data], { type }));
      const scale = Math.min(1, maxWidth / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return canvas.toDataURL("image/jpeg", 0.82);
      }
    }
  } catch {
    /* fall through to the raw path */
  }
  if (data.byteLength <= 300 * 1024) return `data:${type};base64,${toBase64(data)}`;
  return undefined;
}

/** Fetches a cover image from a source. Never throws: a missing cover is not an error. */
export async function fetchCoverDataUrl(url: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetchResilient(url, { signal, timeoutMs: 8_000 });
    if (!response.ok) return undefined;
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return undefined;
    const data = await response.arrayBuffer();
    if (data.byteLength > 4 * 1024 * 1024) return undefined;
    return await toCoverDataUrl(data, type.split(";")[0]);
  } catch {
    return undefined;
  }
}

export interface CoverPalette {
  bg: string;
  fg: string;
  accent: string;
}

const PALETTES: CoverPalette[] = [
  { bg: "#0e4a36", fg: "#f7f0de", accent: "#f4b93a" },
  { bg: "#d64026", fg: "#fff4e0", accent: "#14110d" },
  { bg: "#f4b93a", fg: "#1c1914", accent: "#d64026" },
  { bg: "#245ed6", fg: "#f7f0de", accent: "#f4b93a" },
  { bg: "#1c1914", fg: "#f7f0de", accent: "#d64026" },
  { bg: "#8a3a8c", fg: "#fbeaff", accent: "#f4b93a" },
  { bg: "#e9d9b0", fg: "#0e4a36", accent: "#d64026" },
  { bg: "#1f8a8a", fg: "#f2fffb", accent: "#f4b93a" },
];

/** Deterministic palette per book, so a generated cover never changes between visits. */
export function coverPalette(seed: string): CoverPalette {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTES[(h >>> 0) % PALETTES.length];
}
