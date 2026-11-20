import type { Book, ReadStatus } from "../types";
import { foldText } from "./names";

export type SortKey = "recent" | "added" | "title" | "author" | "progress";
export type StatusFilter = "all" | ReadStatus | "favorite";

export interface LibraryFilter {
  text: string;
  status: StatusFilter;
  shelfId?: string;
  format?: Book["format"];
  language?: string;
}

export const EMPTY_FILTER: LibraryFilter = { text: "", status: "all" };

export function statusOf(book: Book): ReadStatus {
  if (book.finishedAt) return "finished";
  return book.progress > 0 ? "reading" : "unread";
}

export function filterBooks(books: Book[], filter: LibraryFilter): Book[] {
  const needle = foldText(filter.text);
  const words = needle ? needle.split(" ") : [];
  return books.filter((book) => {
    if (filter.status === "favorite" && !book.favorite) return false;
    if ((filter.status === "unread" || filter.status === "reading" || filter.status === "finished") && statusOf(book) !== filter.status) {
      return false;
    }
    if (filter.shelfId && !book.shelfIds.includes(filter.shelfId)) return false;
    if (filter.format && book.format !== filter.format) return false;
    if (filter.language && book.language !== filter.language) return false;
    if (words.length) {
      const haystack = foldText(`${book.title} ${book.author} ${(book.subjects ?? []).join(" ")}`);
      if (!words.every((w) => haystack.includes(w))) return false;
    }
    return true;
  });
}

/** Titles sort without a leading article or punctuation: "The Great Gatsby" under G. */
export function sortTitle(title: string): string {
  return foldText(title).replace(/^[^a-z0-9]+/, "").replace(/^(?:(?:the|a|an|le|la|les|un|une|des|el|los|las|der|die|das)\s+|l')/, "");
}

function lastName(author: string): string {
  const parts = foldText(author).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function sortBooks(books: Book[], key: SortKey): Book[] {
  const copy = [...books];
  const byTitle = (a: Book, b: Book) => sortTitle(a.title).localeCompare(sortTitle(b.title));
  switch (key) {
    case "recent":
      return copy.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt);
    case "added":
      return copy.sort((a, b) => b.addedAt - a.addedAt);
    case "title":
      return copy.sort(byTitle);
    case "author":
      return copy.sort((a, b) => lastName(a.author).localeCompare(lastName(b.author)) || byTitle(a, b));
    case "progress":
      return copy.sort((a, b) => b.progress - a.progress || byTitle(a, b));
  }
}

/** Languages present in the library, most common first — feeds the language filter. */
export function languagesIn(books: Book[]): string[] {
  const counts = new Map<string, number>();
  for (const book of books) if (book.language) counts.set(book.language, (counts.get(book.language) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
}

export function isFiltered(filter: LibraryFilter): boolean {
  return !!(filter.text.trim() || filter.status !== "all" || filter.shelfId || filter.format || filter.language);
}
