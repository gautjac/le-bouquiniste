import { describe, expect, it } from "vitest";
import { safeFilename } from "./filename";

describe("safeFilename", () => {
  it.each([
    ["Pride and Prejudice – Jane Austen", "epub", "Pride and Prejudice – Jane Austen.epub"],
    ["a/b\\c:d*e?f\"g<h>i|j", "pdf", "a b c d e f g h i j.pdf"],
    ["../../etc/passwd", "epub", "etc passwd.epub"],
    ["   ", "epub", "livre.epub"],
    ["...hidden", "epub", "hidden.epub"],
    ["Les Misérables", "epub", "Les Misérables.epub"],
  ])("%s", (name, ext, expected) => {
    expect(safeFilename(name, ext)).toBe(expected);
  });

  it("caps very long titles", () => {
    expect(safeFilename("x".repeat(500), "epub").length).toBeLessThanOrEqual(125);
  });
});
