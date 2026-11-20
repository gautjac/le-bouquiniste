import { describe, expect, it } from "vitest";
import { asArray, cleanTitle, foldText, joinAuthors, languageVariants, normalizeAuthor, normalizeLanguage, stripHtml } from "./names";

describe("normalizeAuthor", () => {
  it.each([
    ["Austen, Jane", "Jane Austen"],
    ["Austen, Jane, 1775-1817", "Jane Austen"],
    ["Melville, Herman, 1819-1891", "Herman Melville"],
    ["Hugo, Victor (1802-1885)", "Victor Hugo"],
    ["Twain, Mark, 1835-1910.", "Mark Twain"],
    ["Plato, 428? BCE-348? BCE", "Plato"],
    ["Hugo, Victor, 1802-", "Victor Hugo"],
    ["Thompson, J. T. (Joseph Thomas), -1849", "J. T. (Joseph Thomas) Thompson"],
    ["Crane, Thomas, b. 1843?", "Thomas Crane"],
    ["Shinn, Florence Scovel, d. 1940", "Florence Scovel Shinn"],
    ["n 80024516 Solomon", "Solomon"],
    ["Brontë, Charlotte, 1816-1855", "Charlotte Brontë"],
    ["Seneca, ca. 4 BC-65 AD", "Seneca"],
    ["Anonymous", "Anonymous"],
    ["Jane Austen", "Jane Austen"],
    ["Martin, George R. R.", "George R. R. Martin"],
    ["Smith, John, Jr.", "Smith, John, Jr."],
    ["Doe, Jr.", "Doe, Jr."],
    ["Project Gutenberg", "Project Gutenberg"],
    ["Tolstoy, Leo, graf, 1828-1910", "Tolstoy, Leo, graf"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeAuthor(input)).toBe(expected);
  });

  it("does not flip multi-author strings", () => {
    expect(normalizeAuthor("Marx, Karl and Engels, Friedrich")).toBe("Marx, Karl and Engels, Friedrich");
  });
});

describe("joinAuthors", () => {
  it("joins up to two and abbreviates beyond", () => {
    expect(joinAuthors([])).toBe("");
    expect(joinAuthors(["A"])).toBe("A");
    expect(joinAuthors(["A", "B"])).toBe("A & B");
    expect(joinAuthors(["A", "B", "C"])).toBe("A et al.");
  });
});

describe("normalizeLanguage", () => {
  it.each([
    ["eng", "en"],
    ["English", "en"],
    ["en-GB", "en"],
    ["FRE", "fr"],
    ["fra", "fr"],
    ["français", "fr"],
    ["xx", "xx"],
    ["klingon", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("%s → %s", (input, expected) => {
    expect(normalizeLanguage(input as string | undefined)).toBe(expected);
  });

  it("lists every spelling for a code", () => {
    const fr = languageVariants("fr");
    expect(fr).toEqual(expect.arrayContaining(["fr", "fre", "fra", "french"]));
  });
});

describe("text helpers", () => {
  it("folds accents and case", () => {
    expect(foldText("  Les MISÉRABLES  ")).toBe("les miserables");
    expect(foldText("l’été")).toBe("l'ete");
  });
  it("cleans catalogue punctuation", () => {
    expect(cleanTitle("Moby Dick;")).toBe("Moby Dick");
    expect(cleanTitle("Title /")).toBe("Title");
    expect(cleanTitle("Keep: the middle")).toBe("Keep: the middle");
  });
  it("strips html", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>world</b> &amp; co</p>")).toBe("Hello world & co");
  });
  it("wraps values in arrays", () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray("a")).toEqual(["a"]);
    expect(asArray(["a", "b"])).toEqual(["a", "b"]);
  });
});
