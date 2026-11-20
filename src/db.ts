import Dexie, { type EntityTable } from "dexie";
import type { Annotation, Book, BookFile, Shelf } from "./types";

export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Local-first: this IndexedDB is the ONLY copy of the user's library.
 * Migration rule (see house spec): never clear or drop a store holding user data in an
 * `.upgrade()`; add stores/indexes and backfill with `.modify()`.
 */
export class BouquinisteDB extends Dexie {
  books!: EntityTable<Book, "id">;
  files!: EntityTable<BookFile, "id">;
  annotations!: EntityTable<Annotation, "id">;
  shelves!: EntityTable<Shelf, "id">;
  settings!: EntityTable<SettingRow, "key">;

  constructor(name = "le-bouquiniste") {
    super(name);
    this.version(1).stores({
      books: "id, source, [source+sourceId], hash, title, author, addedAt, lastOpenedAt, favorite, *shelfIds",
      files: "id",
      annotations: "id, bookId, [bookId+kind], createdAt",
      shelves: "id, name",
      settings: "key",
    });
  }
}

export const db = new BouquinisteDB();
