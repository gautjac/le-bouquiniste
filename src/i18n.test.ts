import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARIES, makeTranslator, translate, translatePlural, type Key } from "./i18n";

describe("dictionaries", () => {
  it("French and English define exactly the same keys", () => {
    expect(Object.keys(DICTIONARIES.en).sort()).toEqual(Object.keys(DICTIONARIES.fr).sort());
  });

  it("every translation is non-empty and uses the same {placeholders} in both languages", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(DICTIONARIES.fr) as Key[]) {
      expect(DICTIONARIES.fr[key].trim(), key).not.toBe("");
      expect(DICTIONARIES.en[key].trim(), key).not.toBe("");
      expect(placeholders(DICTIONARIES.en[key]), `placeholders of ${key}`).toEqual(placeholders(DICTIONARIES.fr[key]));
    }
  });

  it("every plural base has both .one and .other", () => {
    const keys = Object.keys(DICTIONARIES.fr);
    for (const key of keys.filter((k) => k.endsWith(".one"))) {
      expect(keys, key).toContain(key.replace(/\.one$/, ".other"));
    }
  });

  it("every t(\"…\") / tp(\"…\") used in the source exists", () => {
    const known = new Set(Object.keys(DICTIONARIES.fr));
    const root = join(__dirname);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && name !== "i18n.ts") files.push(full);
      }
    };
    walk(root);
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/\bt\(\s*["'`]([a-z0-9.]+)["'`]/gi)) if (!known.has(m[1])) missing.push(`${file}: ${m[1]}`);
      for (const m of source.matchAll(/\btp\(\s*["'`]([a-z0-9.]+)["'`]/gi)) {
        if (!known.has(`${m[1]}.one`) || !known.has(`${m[1]}.other`)) missing.push(`${file}: ${m[1]} (plural)`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("translate", () => {
  it("interpolates and leaves unknown placeholders visible", () => {
    expect(translate("fr", "discover.sourceDown", { source: "Gutenberg" })).toBe("Gutenberg ne répond pas pour l’instant.");
    expect(translate("en", "dl.added", { title: "Emma" })).toBe("“Emma” is in your library.");
    expect(translate("en", "dl.added")).toContain("{title}");
    expect(translate("en", "dl.added", { other: 1 })).toContain("{title}");
  });

  it("handles plurals per language (French: 0 and 1 are singular)", () => {
    expect(translatePlural("fr", "library.count", 0)).toBe("0 livre");
    expect(translatePlural("fr", "library.count", 1)).toBe("1 livre");
    expect(translatePlural("fr", "library.count", 2)).toBe("2 livres");
    expect(translatePlural("en", "library.count", 0)).toBe("0 books");
    expect(translatePlural("en", "library.count", 1)).toBe("1 book");
  });

  it("makeTranslator binds the language", () => {
    const { t, tp, lang } = makeTranslator("en");
    expect(lang).toBe("en");
    expect(t("nav.library")).toBe("My library");
    expect(tp("select.count", 3)).toBe("3 selected");
  });
});
