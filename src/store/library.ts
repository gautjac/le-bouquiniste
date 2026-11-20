import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { Annotation, Book, Shelf } from "../types";

/** Every book (metadata only — file bytes live in another table). `undefined` while loading. */
export function useBooks(): Book[] | undefined {
  return useLiveQuery(() => db.books.toArray(), []);
}

export function useShelves(): Shelf[] {
  return useLiveQuery(() => db.shelves.orderBy("name").toArray(), []) ?? [];
}

export function useAnnotations(bookId: string): Annotation[] {
  return useLiveQuery(() => db.annotations.where("bookId").equals(bookId).sortBy("createdAt"), [bookId]) ?? [];
}

/** Map of `source:sourceId` → book id, so result cards know what's already on the shelf. */
export function useLibraryIndex(): Map<string, string> {
  return (
    useLiveQuery(async () => {
      const index = new Map<string, string>();
      await db.books.each((book) => {
        if (book.source !== "import" && book.sourceId) index.set(`${book.source}:${book.sourceId}`, book.id);
      });
      return index;
    }, []) ?? new Map<string, string>()
  );
}
