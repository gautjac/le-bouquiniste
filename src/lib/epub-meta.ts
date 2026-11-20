import JSZip from "jszip";
import { SourceError } from "./net";
import { asArray, normalizeAuthor, normalizeLanguage, stripHtml } from "./names";

export type DrmKind = "adobe" | "lcp" | "encrypted";

export interface ImportedCover {
  data: ArrayBuffer;
  type: string;
}

export interface EpubMeta {
  title?: string;
  author?: string;
  language?: string;
  description?: string;
  subjects: string[];
  cover?: ImportedCover;
}

const DC = "http://purl.org/dc/elements/1.1/";
/** Font obfuscation is not DRM; any other cipher in encryption.xml is. */
const FONT_OBFUSCATION = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** Resolves `rel` against the directory of `base` ("OEBPS/content.opf" + "../x" → "x"). */
export function resolvePath(base: string, rel: string): string {
  const clean = decodeURIComponent(rel.split("#")[0]);
  if (clean.startsWith("/")) return clean.slice(1);
  const segments = base.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (part === "..") segments.pop();
    else if (part !== "." && part !== "") segments.push(part);
  }
  return segments.join("/");
}

export async function detectEpubDrm(zip: JSZip): Promise<DrmKind | null> {
  if (zip.file("META-INF/rights.xml")) return "adobe";
  if (zip.file("META-INF/license.lcpl")) return "lcp";
  const encryption = await zip.file("META-INF/encryption.xml")?.async("string");
  if (encryption) {
    const algorithms = [...encryption.matchAll(/Algorithm="([^"]+)"/g)].map((m) => m[1]);
    if (algorithms.some((a) => !FONT_OBFUSCATION.includes(a))) return "encrypted";
  }
  return null;
}

export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function looksLikeZip(data: ArrayBuffer): boolean {
  const head = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  return head.length === 4 && ZIP_MAGIC.every((b, i) => head[i] === b);
}

export function looksLikePdf(data: ArrayBuffer): boolean {
  const head = new Uint8Array(data, 0, Math.min(1024, data.byteLength));
  const text = String.fromCharCode(...head);
  return text.includes("%PDF-");
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new SourceError("EPUB illisible (XML invalide).", "invalid");
  return doc;
}

function dcValues(doc: Document, name: string): string[] {
  return Array.from(doc.getElementsByTagNameNS(DC, name))
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);
}

/**
 * Reads title, author, language, description, subjects and cover out of an EPUB.
 * Throws SourceError('drm') for protected files and ('invalid') for non-EPUBs.
 */
export async function readEpubMeta(data: ArrayBuffer): Promise<EpubMeta> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new SourceError("Ce fichier n'est pas un EPUB valide.", "invalid");
  }

  const drm = await detectEpubDrm(zip);
  if (drm) {
    throw new SourceError(
      "Ce livre est protégé par un DRM. Le Bouquiniste ne lit que les livres libres de DRM.",
      "drm",
    );
  }

  const container = await zip.file("META-INF/container.xml")?.async("string");
  if (!container) throw new SourceError("Ce fichier n'est pas un EPUB valide.", "invalid");
  const rootfile = parseXml(container).querySelector("rootfile")?.getAttribute("full-path");
  if (!rootfile) throw new SourceError("EPUB sans fichier de paquet (OPF).", "invalid");
  const opfPath = resolvePath("", rootfile); // tolerate "./content.opf", "/content.opf", "%20"
  const opfText = await zip.file(opfPath)?.async("string");
  if (!opfText) throw new SourceError("EPUB incomplet (OPF manquant).", "invalid");
  const opf = parseXml(opfText);

  const meta: EpubMeta = {
    title: dcValues(opf, "title")[0],
    author: asArray(dcValues(opf, "creator"))
      .map(normalizeAuthor)
      .filter(Boolean)
      .slice(0, 2)
      .join(" & ") || undefined,
    language: normalizeLanguage(dcValues(opf, "language")[0]),
    description: (() => {
      const text = stripHtml(dcValues(opf, "description")[0] ?? "");
      return text || undefined;
    })(),
    subjects: dcValues(opf, "subject").slice(0, 8),
  };

  meta.cover = await findCover(zip, opf, opfPath);
  return meta;
}

async function findCover(zip: JSZip, opf: Document, opfPath: string): Promise<ImportedCover | undefined> {
  const items = Array.from(opf.getElementsByTagName("item"));
  const imageItems = items.filter((i) => (i.getAttribute("media-type") ?? "").startsWith("image/"));

  // EPUB 3: properties="cover-image"; EPUB 2: <meta name="cover" content="<item id>">.
  let candidate = items.find((i) => (i.getAttribute("properties") ?? "").split(/\s+/).includes("cover-image"));
  if (!candidate) {
    const coverId = Array.from(opf.getElementsByTagName("meta"))
      .find((m) => m.getAttribute("name") === "cover")
      ?.getAttribute("content");
    if (coverId) candidate = items.find((i) => i.getAttribute("id") === coverId);
  }
  if (!candidate) {
    candidate = imageItems.find((i) => /cover/i.test(`${i.getAttribute("id")} ${i.getAttribute("href")}`));
  }
  if (!candidate) return undefined;

  const href = candidate.getAttribute("href");
  if (!href) return undefined;
  const path = resolvePath(opfPath, href);
  const entry = zip.file(path);
  if (!entry) return undefined;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const type = candidate.getAttribute("media-type") || IMAGE_TYPES[ext];
  if (!type?.startsWith("image/") || type === "image/svg+xml") return undefined;
  return { data: await entry.async("arraybuffer"), type };
}

/* ───────────────────────── PDF (best effort) ───────────────────────── */

export interface PdfMeta {
  title?: string;
  author?: string;
}

function decodePdfString(raw: string): string {
  const unescaped = raw
    .replace(/\\([nrtbf()\\])/g, (_m, c: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[c] ?? c)
    .replace(/\\([0-7]{1,3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)));
  if (unescaped.startsWith("\xfe\xff")) {
    let out = "";
    for (let i = 2; i + 1 < unescaped.length; i += 2) {
      out += String.fromCharCode((unescaped.charCodeAt(i) << 8) | unescaped.charCodeAt(i + 1));
    }
    return out.trim();
  }
  return unescaped.trim();
}

/** Reads /Title and /Author when they are plain strings in the info dictionary. */
export function readPdfMeta(data: ArrayBuffer): PdfMeta {
  const bytes = new Uint8Array(data);
  const window = 200 * 1024;
  const slices = [bytes.subarray(0, window), bytes.subarray(Math.max(0, bytes.length - window))];
  const text = slices.map((s) => new TextDecoder("latin1").decode(s)).join("\n");
  const grab = (key: string): string | undefined => {
    const match = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`).exec(text);
    const value = match ? decodePdfString(match[1]) : "";
    return value && !/^untitled/i.test(value) ? value : undefined;
  };
  return { title: grab("Title"), author: grab("Author") };
}
