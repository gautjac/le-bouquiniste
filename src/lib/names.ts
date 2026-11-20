/** Small text helpers shared by providers, import, search and UI. */

const LANG_ALIASES: Record<string, string> = {
  eng: "en", english: "en", en: "en",
  fre: "fr", fra: "fr", french: "fr", francais: "fr", "français": "fr", fr: "fr",
  spa: "es", spanish: "es", es: "es",
  ger: "de", deu: "de", german: "de", de: "de",
  ita: "it", italian: "it", it: "it",
  por: "pt", portuguese: "pt", pt: "pt",
  dut: "nl", nld: "nl", dutch: "nl", nl: "nl",
  lat: "la", latin: "la", la: "la",
  rus: "ru", russian: "ru", ru: "ru",
  chi: "zh", zho: "zh", chinese: "zh", zh: "zh",
  jpn: "ja", japanese: "ja", ja: "ja",
  gre: "el", ell: "el", greek: "el", el: "el",
  swe: "sv", swedish: "sv", sv: "sv",
  dan: "da", danish: "da", da: "da",
  nor: "no", norwegian: "no", no: "no",
  fin: "fi", finnish: "fi", fi: "fi",
  pol: "pl", polish: "pl", pl: "pl",
  cat: "ca", catalan: "ca", ca: "ca",
  heb: "he", hebrew: "he", he: "he",
  ara: "ar", arabic: "ar", ar: "ar",
  hun: "hu", hungarian: "hu", hu: "hu",
  cze: "cs", ces: "cs", czech: "cs", cs: "cs",
  epo: "eo", esperanto: "eo", eo: "eo",
};

/** Maps "eng", "English", "en-GB"… to "en". Returns undefined when we can't tell. */
export function normalizeLanguage(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (!cleaned) return undefined;
  return LANG_ALIASES[cleaned] ?? (cleaned.length === 2 ? cleaned : undefined);
}

/** Every spelling a source might use for a language, for building search filters. */
export function languageVariants(code: string): string[] {
  const out = new Set<string>([code]);
  for (const [alias, iso] of Object.entries(LANG_ALIASES)) {
    if (iso === code) out.add(alias);
  }
  return [...out];
}

const ERA = "(?:BCE|BC|CE|AD|B\\.C\\.|A\\.D\\.)";
const CIRCA = "(?:ca\\.?\\s*|c\\.\\s*)?";
const YEAR = `${CIRCA}\\d{1,4}\\??\\s*${ERA}?`;
// "1775-1817", "1819-", "-1849", "ca. 1850-1900", "428? BCE-348? BCE", optionally in brackets.
const DATE_RANGE_TAIL = new RegExp(
  `[,\\s]*\\(?\\s*(?:${YEAR}\\s*[-–]\\s*(?:${YEAR})?|[-–]\\s*${YEAR})\\s*\\)?\\.?\\s*$`,
  "i",
);
// "b. 1843?" / "d. 1940" — catalogue shorthand for born / died.
const BORN_DIED = /[,\s]*\b[bd]\.\s*(?:ca\.?\s*)?\d{3,4}\??/gi;
// Library of Congress authority numbers that leak into some catalogues: "n 80024516".
const AUTHORITY_ID = /\bn[a-z]?\s?\d{6,}\b/gi;

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|inc|ltd|esq|phd|md)\.?$/i;

/**
 * "Austen, Jane, 1775-1817" → "Jane Austen". Leaves corporate names, "Anonymous",
 * and anything that isn't clearly "Last, First" alone.
 */
export function normalizeAuthor(raw: string): string {
  let name = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(AUTHORITY_ID, " ")
    .replace(BORN_DIED, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(DATE_RANGE_TAIL, "")
    .trim();
  name = name.replace(/[,;\s]+$/, "");
  const parts = name.split(",").map((p) => p.trim());
  if (parts.length === 2 && parts[0] && parts[1] && !NAME_SUFFIX.test(parts[1]) && !/\band\b|;/.test(name)) {
    name = `${parts[1]} ${parts[0]}`;
  }
  return name.replace(/\s+/g, " ").trim();
}

export function joinAuthors(authors: string[]): string {
  const list = authors.filter(Boolean);
  if (list.length <= 2) return list.join(" & ");
  return `${list[0]} et al.`;
}

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case, accent-insensitive text for forgiving search. */
export function foldText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tidy "Moby Dick;" / "Title /" style catalogue punctuation. */
export function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/\s*[;/:,]\s*$/, "").trim();
}

export function firstOf<T>(value: T | T[] | undefined | null): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
