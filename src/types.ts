import type { SourceId } from "./providers/types";

export type BookFormat = "epub" | "pdf";
export type ReadStatus = "unread" | "reading" | "finished";
export type Lang = "fr" | "en";

export interface Book {
  id: string;
  /** Where it came from. `import` = a file the user added themselves. */
  source: SourceId | "import";
  sourceId?: string;
  title: string;
  author: string;
  language?: string;
  year?: number;
  description?: string;
  subjects?: string[];
  format: BookFormat;
  size: number;
  /** SHA-256 (hex) of the file, to spot the same book arriving twice. */
  hash: string;
  /** Small JPEG/PNG data URL. Missing → a typographic cover is generated. */
  cover?: string;
  detailUrl?: string;
  rights?: string;
  addedAt: number;
  lastOpenedAt?: number;
  /** 0..1 */
  progress: number;
  /** EPUB CFI. */
  location?: string;
  finishedAt?: number;
  favorite?: boolean;
  shelfIds: string[];
}

/** File bytes live in their own table so listing the library never loads them. */
export interface BookFile {
  id: string; // = Book.id
  data: ArrayBuffer;
  type: string;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export interface Annotation {
  id: string;
  bookId: string;
  kind: "highlight" | "bookmark";
  cfi: string;
  text?: string;
  note?: string;
  color: HighlightColor;
  chapter?: string;
  createdAt: number;
}

export interface Shelf {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export type ReaderTheme = "paper" | "sepia" | "night";
export type ReaderFont = "literata" | "serif" | "sans" | "atkinson";

export interface ReaderPrefs {
  theme: ReaderTheme;
  /** Percent, 80–220. */
  fontSize: number;
  font: ReaderFont;
  lineHeight: number;
  margin: "narrow" | "normal" | "wide";
  flow: "paginated" | "scrolled";
}

export interface Settings {
  lang: Lang;
  ui: "auto" | "light" | "dark";
  onboarded: boolean;
  reader: ReaderPrefs;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: "fr",
  ui: "auto",
  onboarded: false,
  reader: {
    theme: "paper",
    fontSize: 110,
    font: "literata",
    lineHeight: 1.65,
    margin: "normal",
    flow: "paginated",
  },
};
