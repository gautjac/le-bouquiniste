import { describe, expect, it } from "vitest";
import type { Book } from "../types";
import { EMPTY_FILTER, filterBooks, isFiltered, languagesIn, sortBooks, sortTitle, statusOf } from "./library";

const book = (over: Partial<Book>): Book => ({
  id: over.id ?? over.title ?? "x",
  source: "import",
  title: "T",
  author: "A B",
  format: "epub",
  size: 1,
  hash: over.id ?? over.title ?? "h",
  addedAt: 1,
  progress: 0,
  shelfIds: [],
  ...over,
});

const library = [
  book({ title: "The Great Gatsby", author: "F. Scott Fitzgerald", language: "en", addedAt: 3, progress: 0.4, lastOpenedAt: 50 }),
  book({ title: "Les Misérables", author: "Victor Hugo", language: "fr", addedAt: 2, finishedAt: 9, progress: 1, favorite: true, shelfIds: ["s1"] }),
  book({ title: "Emma", author: "Jane Austen", language: "en", addedAt: 5, format: "pdf", subjects: ["Matchmaking"] }),
  book({ title: "L'Étranger", author: "Albert Camus", language: "fr", addedAt: 1, lastOpenedAt: 100, progress: 0.1 }),
];

describe("statusOf", () => {
  it("derives status from progress and finish date", () => {
    expect(statusOf(library[0])).toBe("reading");
    expect(statusOf(library[1])).toBe("finished");
    expect(statusOf(library[2])).toBe("unread");
  });
});

describe("filterBooks", () => {
  const titles = (f: Partial<typeof EMPTY_FILTER>) => filterBooks(library, { ...EMPTY_FILTER, ...f }).map((b) => b.title);

  it("returns everything for an empty filter", () => expect(titles({})).toHaveLength(4));
  it("searches title, author and subjects, ignoring accents and case", () => {
    expect(titles({ text: "miserables" })).toEqual(["Les Misérables"]);
    expect(titles({ text: "AUSTEN" })).toEqual(["Emma"]);
    expect(titles({ text: "matchmaking" })).toEqual(["Emma"]);
    expect(titles({ text: "etranger" })).toEqual(["L'Étranger"]);
  });
  it("requires every word to match", () => {
    expect(titles({ text: "victor hugo" })).toEqual(["Les Misérables"]);
    expect(titles({ text: "victor austen" })).toEqual([]);
  });
  it("filters by status", () => {
    expect(titles({ status: "reading" })).toEqual(["The Great Gatsby", "L'Étranger"]);
    expect(titles({ status: "finished" })).toEqual(["Les Misérables"]);
    expect(titles({ status: "unread" })).toEqual(["Emma"]);
    expect(titles({ status: "favorite" })).toEqual(["Les Misérables"]);
  });
  it("filters by shelf, format and language, and combines", () => {
    expect(titles({ shelfId: "s1" })).toEqual(["Les Misérables"]);
    expect(titles({ format: "pdf" })).toEqual(["Emma"]);
    expect(titles({ language: "fr" })).toEqual(["Les Misérables", "L'Étranger"]);
    expect(titles({ language: "fr", status: "reading" })).toEqual(["L'Étranger"]);
  });
  it("knows when a filter is active", () => {
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, text: " " })).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, status: "reading" })).toBe(true);
  });
});

describe("sorting", () => {
  const order = (key: Parameters<typeof sortBooks>[1]) => sortBooks(library, key).map((b) => b.title);

  it("recent: last opened first, then newest added", () => {
    expect(order("recent")).toEqual(["L'Étranger", "The Great Gatsby", "Emma", "Les Misérables"]);
  });
  it("added: newest first", () => expect(order("added")).toEqual(["Emma", "The Great Gatsby", "Les Misérables", "L'Étranger"]));
  it("title: ignores leading articles and accents", () => {
    expect(order("title")).toEqual(["Emma", "L'Étranger", "The Great Gatsby", "Les Misérables"]);
  });
  it("author: by last name", () => {
    // Austen, Camus, Fitzgerald, Hugo
    expect(order("author")).toEqual(["Emma", "L'Étranger", "The Great Gatsby", "Les Misérables"]);
  });
  it("progress: furthest first", () => {
    expect(order("progress")[0]).toBe("Les Misérables");
  });
  it("does not mutate its input", () => {
    const copy = [...library];
    sortBooks(library, "title");
    expect(library).toEqual(copy);
  });
  it("sortTitle strips articles", () => {
    expect(sortTitle("The Hobbit")).toBe("hobbit");
    expect(sortTitle("L'Étranger")).toBe("etranger");
    expect(sortTitle("“Quoted”")).toBe("quoted”");
    expect(sortTitle("Theory of Everything")).toBe("theory of everything");
  });
});

describe("languagesIn", () => {
  it("lists languages by frequency", () => {
    expect(languagesIn([...library, book({ title: "z", language: "fr" })])).toEqual(["fr", "en"]);
    expect(languagesIn([book({ title: "q" })])).toEqual([]);
  });
});
