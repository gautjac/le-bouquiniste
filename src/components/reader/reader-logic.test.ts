import { describe, expect, it } from "vitest";
import type { Annotation } from "../../types";
import { decideResize } from "./layout";
import { formatNotesMarkdown } from "./notes";
import { buildThemeRules, clampFontSize, FONT_STACKS, themeName, THEME_COLORS } from "./themes";
import { chapterFor, flattenToc, resumeTarget, stripFragment } from "./toc";

describe("flattenToc", () => {
  it("flattens depth-first, keeps depth, drops blank labels and tidies whitespace", () => {
    const toc = flattenToc([
      { id: "a", href: "ch1.xhtml", label: "  Chapitre\n 1 ", subitems: [{ id: "a1", href: "ch1.xhtml#s1", label: "Section 1.1" }] },
      { id: "b", href: "ch2.xhtml", label: "" },
      { id: "", href: "ch3.xhtml", label: "Chapitre 3" },
    ]);
    expect(toc).toEqual([
      { id: "a", label: "Chapitre 1", href: "ch1.xhtml", depth: 0 },
      { id: "a1", label: "Section 1.1", href: "ch1.xhtml#s1", depth: 1 },
      { id: "ch3.xhtml", label: "Chapitre 3", href: "ch3.xhtml", depth: 0 },
    ]);
    expect(flattenToc(undefined)).toEqual([]);
  });
});

describe("chapterFor", () => {
  const toc = flattenToc([
    { id: "1", href: "text/c1.xhtml", label: "One" },
    { id: "2", href: "text/c2.xhtml#top", label: "Two" },
    { id: "3", href: "text/c4.xhtml", label: "Four" },
    { id: "x", href: "missing.xhtml", label: "Ghost" },
  ]);
  const spine: Record<string, number> = { "text/c1.xhtml": 0, "text/c2.xhtml": 1, "text/c4.xhtml": 3 };
  const lookup = (href: string) => spine[href];

  it("picks the last entry at or before the current spine position", () => {
    expect(chapterFor(toc, lookup, 0)?.label).toBe("One");
    expect(chapterFor(toc, lookup, 1)?.label).toBe("Two");
    expect(chapterFor(toc, lookup, 2)?.label).toBe("Two"); // a section with no TOC entry belongs to the previous chapter
    expect(chapterFor(toc, lookup, 9)?.label).toBe("Four");
  });
  it("returns undefined before the first entry or with no usable TOC", () => {
    expect(chapterFor(toc, (h) => (h === "text/c1.xhtml" ? 2 : undefined), 0)).toBeUndefined();
    expect(chapterFor([], lookup, 3)).toBeUndefined();
  });
  it("strips fragments", () => expect(stripFragment("a.xhtml#x")).toBe("a.xhtml"));
});

describe("resumeTarget", () => {
  it("prefers the live position over the one stored at the start of the session", () => {
    expect(resumeTarget("epubcfi(/6/16)", "epubcfi(/6/2)")).toBe("epubcfi(/6/16)");
  });
  it("falls back to the stored position, then to the start of the book", () => {
    expect(resumeTarget(undefined, "epubcfi(/6/2)")).toBe("epubcfi(/6/2)");
    expect(resumeTarget(null, "")).toBeUndefined();
    expect(resumeTarget("", undefined)).toBeUndefined();
  });
});

describe("theme rules", () => {
  it("applies the chosen colours, font and line height to the body", () => {
    const rules = buildThemeRules({ theme: "night", font: "sans", lineHeight: 1.8 });
    expect(rules.body.background).toContain(THEME_COLORS.night.bg);
    expect(rules.body.color).toContain(THEME_COLORS.night.fg);
    expect(rules.body["font-family"]).toContain(FONT_STACKS.sans);
    expect(rules.body["line-height"]).toContain("1.8");
    expect(rules.a.color).toContain(THEME_COLORS.night.link);
  });
  it("gives each combination its own theme name", () => {
    const a = themeName({ theme: "paper", font: "serif", lineHeight: 1.65 });
    expect(a).toBe("bq-paper-serif-1_65");
    expect(themeName({ theme: "paper", font: "serif", lineHeight: 1.7 })).not.toBe(a);
    expect(themeName({ theme: "sepia", font: "serif", lineHeight: 1.65 })).not.toBe(a);
  });
  it("keeps the font size inside its range, on a 10% grid", () => {
    expect(clampFontSize(10)).toBe(80);
    expect(clampFontSize(999)).toBe(220);
    expect(clampFontSize(114)).toBe(110);
    expect(clampFontSize(116)).toBe(120);
  });
});

describe("formatNotesMarkdown", () => {
  const note = (over: Partial<Annotation>): Annotation => ({ id: "1", bookId: "b", kind: "highlight", cfi: "c", color: "yellow", createdAt: 1, ...over });
  const labels = { highlights: "Surlignages", bookmarks: "Signets" };

  it("renders title, author, highlights with notes, and bookmarks", () => {
    const md = formatNotesMarkdown({ title: "Emma", author: "Jane Austen" }, [
      note({ text: "It is a truth\nuniversally acknowledged", chapter: "Chapitre 1", note: "Famous line" }),
      note({ id: "2", kind: "bookmark", text: "Mr. Woodhouse", chapter: "Chapitre 2" }),
    ], labels);
    expect(md).toBe(
      ["# Emma", "*Jane Austen*", "", "## Surlignages", "", "**Chapitre 1**", "> It is a truth universally acknowledged", "", "Famous line", "", "## Signets", "- Chapitre 2 — « Mr. Woodhouse »", ""].join("\n"),
    );
  });
  it("omits empty sections and a missing author", () => {
    expect(formatNotesMarkdown({ title: "T", author: "" }, [], labels)).toBe("# T\n");
  });
});

describe("decideResize (regression: blank page after opening a book)", () => {
  const a = { width: 800, height: 670 };

  it("only records the size on the first report — never resizes a page that hasn't located itself", () => {
    expect(decideResize(null, a, false)).toEqual({ resize: false, remember: a });
    expect(decideResize(null, a, true)).toEqual({ resize: false, remember: a });
  });
  it("ignores identical and sub-pixel reports", () => {
    expect(decideResize(a, { ...a }, true)).toEqual({ resize: false, remember: null });
    expect(decideResize(a, { width: 800.4, height: 670.3 }, true)).toEqual({ resize: false, remember: null });
  });
  it("resizes on a real change once a location exists", () => {
    const b = { width: 600, height: 670 };
    expect(decideResize(a, b, true)).toEqual({ resize: true, remember: b });
  });
  it("defers a real change until there is a location, but still remembers it", () => {
    const b = { width: 600, height: 670 };
    expect(decideResize(a, b, false)).toEqual({ resize: false, remember: b });
  });
  it("ignores collapsed (hidden) containers", () => {
    expect(decideResize(a, { width: 0, height: 0 }, true)).toEqual({ resize: false, remember: null });
  });
});
