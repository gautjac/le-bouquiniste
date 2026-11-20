import JSZip from "jszip";
import { db } from "./db";

export interface TestEpubOptions {
  title?: string;
  authors?: string[];
  language?: string;
  description?: string;
  subjects?: string[];
  /** "epub3" → properties="cover-image"; "epub2" → <meta name="cover">; "name" → found by filename; none → no cover. */
  cover?: "epub3" | "epub2" | "name" | "none";
  /** Extra files, e.g. META-INF/rights.xml to simulate DRM. */
  extra?: Record<string, string>;
  opfDir?: string;
}

// 1×1 transparent PNG.
export const PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

export async function buildEpub(options: TestEpubOptions = {}): Promise<ArrayBuffer> {
  const {
    title = "Le Livre de Test",
    authors = ["Austen, Jane, 1775-1817"],
    language = "fre",
    description,
    subjects = ["Fiction"],
    cover = "epub3",
    extra = {},
    opfDir = "OEBPS",
  } = options;

  const dir = opfDir ? `${opfDir}/` : "";
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${dir}content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );

  const coverItem =
    cover === "epub3"
      ? `<item id="img" href="images/c.png" media-type="image/png" properties="cover-image"/>`
      : cover === "epub2"
        ? `<item id="cov" href="images/c.png" media-type="image/png"/>`
        : cover === "name"
          ? `<item id="front-cover-img" href="images/cover.png" media-type="image/png"/>`
          : "";
  const coverMeta = cover === "epub2" ? `<meta name="cover" content="cov"/>` : "";

  zip.file(
    `${dir}content.opf`,
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:test:1</dc:identifier>
    <dc:title>${title}</dc:title>
    ${authors.map((a) => `<dc:creator>${a}</dc:creator>`).join("")}
    <dc:language>${language}</dc:language>
    ${description ? `<dc:description>${description}</dc:description>` : ""}
    ${subjects.map((s) => `<dc:subject>${s}</dc:subject>`).join("")}
    ${coverMeta}
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    ${coverItem}
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`,
  );
  zip.file(`${dir}c1.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Bonjour.</p></body></html>`);
  if (cover !== "none") {
    zip.file(`${dir}images/${cover === "name" ? "cover.png" : "c.png"}`, PNG_BYTES);
  }
  for (const [path, content] of Object.entries(extra)) zip.file(path, content);
  return zip.generateAsync({ type: "arraybuffer" });
}

export function buildPdf(info: { title?: string; author?: string } = {}): ArrayBuffer {
  const parts = ["%PDF-1.4", "1 0 obj << /Type /Catalog >> endobj"];
  const dict = [
    info.title ? `/Title (${info.title})` : "",
    info.author ? `/Author (${info.author})` : "",
  ].join(" ");
  parts.push(`2 0 obj << ${dict} >> endobj`, "trailer << /Info 2 0 R >>", "%%EOF");
  return new TextEncoder().encode(parts.join("\n")).buffer as ArrayBuffer;
}

export async function resetDb(): Promise<void> {
  await Promise.all([db.books.clear(), db.files.clear(), db.annotations.clear(), db.shelves.clear(), db.settings.clear()]);
}

export function file(data: ArrayBuffer | string, name: string, type = ""): File {
  return new File([data], name, { type });
}
