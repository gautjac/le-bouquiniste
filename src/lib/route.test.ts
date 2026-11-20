import { describe, expect, it } from "vitest";
import { formatHash, parseHash, type Route } from "./route";

describe("hash routes", () => {
  it.each<[string, Route | null]>([
    ["#/etal", { name: "discover" }],
    ["#/biblio", { name: "library" }],
    ["#/reglages", { name: "settings" }],
    ["#/lire/abc-123", { name: "read", id: "abc-123" }],
    ["#lire/abc", { name: "read", id: "abc" }],
    ["#/biblio?x=1", { name: "library" }],
    ["#/lire/", null],
    ["#/lire", null],
    ["#/nope", null],
    ["", null],
    ["#", null],
  ])("parses %s", (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });

  it("round-trips every route, including ids with odd characters", () => {
    const routes: Route[] = [
      { name: "discover" },
      { name: "library" },
      { name: "settings" },
      { name: "read", id: "plain" },
      { name: "read", id: "we ird/id#?" },
    ];
    for (const route of routes) expect(parseHash(formatHash(route))).toEqual(route);
  });
});
