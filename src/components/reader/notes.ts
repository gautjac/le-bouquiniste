import type { Annotation, Book } from "../../types";

/** The reader's notes as Markdown, ready to paste into any notebook. */
export function formatNotesMarkdown(book: Pick<Book, "title" | "author">, annotations: Annotation[], labels: { highlights: string; bookmarks: string }): string {
  // The caller supplies reading order; this only groups by kind.
  const highlights = annotations.filter((a) => a.kind === "highlight");
  const bookmarks = annotations.filter((a) => a.kind === "bookmark");

  const lines: string[] = [`# ${book.title}`];
  if (book.author) lines.push(`*${book.author}*`);

  if (highlights.length) {
    lines.push("", `## ${labels.highlights}`);
    for (const h of highlights) {
      const quote = (h.text ?? "").replace(/\s+/g, " ").trim();
      lines.push("", ...(h.chapter ? [`**${h.chapter}**`] : []), `> ${quote}`);
      if (h.note?.trim()) lines.push("", h.note.trim());
    }
  }
  if (bookmarks.length) {
    lines.push("", `## ${labels.bookmarks}`);
    for (const b of bookmarks) {
      const snippet = (b.text ?? "").replace(/\s+/g, " ").trim();
      lines.push(`- ${[b.chapter, snippet && `« ${snippet} »`].filter(Boolean).join(" — ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
