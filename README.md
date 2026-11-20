# Le Bouquiniste

**Search, download, manage and read DRM-free books.** Named for the green boxes of the
*bouquinistes* along the Seine: free, secondhand-feeling literature, laid out on a stall.

Everything lives on your device. There is no account and no server-side database — the
library is IndexedDB in your browser, and the only server code is a tiny allow-listed proxy.

French first (Québécois register), English included. Light/dark follows your system.

## What it does

| | |
|---|---|
| **L'étal** (discover) | One search box across **Standard Ebooks**, **Project Gutenberg** and the **Internet Archive**. Language filter, per-source toggles, "most popular" when you haven't typed anything, live progress, cancel/retry, large-file confirmation. Each source loads independently — one being down never blocks the others. |
| **Ma bibliothèque** | Covers / list / **spines-on-a-shelf** views, "continue reading" card, filter by status (reading / to read / finished / favourites), language, format; sort; custom **shelves**; multi-select bulk actions; edit metadata; download the original file back out. |
| **Reader** (EPUB) | Paginated or scrolling; paper / sepia / night; 4 typefaces; text size, line spacing, margins; table of contents; **full-text search** across the whole book; **highlights** (4 colours) with notes; bookmarks; copy notes as Markdown; reading-time estimate; position saved automatically; keyboard, swipe and tap-zone navigation. |
| **Reader** (PDF) | Opens in the browser's own viewer (it knows PDFs better than we could). Progress is manual. |
| **Import** | Drag EPUB/PDF files anywhere on the window, or use *Importer*. Duplicates are detected by file hash. |
| **Backup** | One ZIP with every book, shelf, highlight and position. Restore **merges** — it never overwrites or deletes. |

## DRM: the line this app draws

Le Bouquiniste reads **only DRM-free books**, and it enforces that rather than just hoping:

- It only talks to sources whose books are public domain / freely licensed.
- The Internet Archive search excludes access-restricted items, and download selection refuses
  any file whose format mentions *Encrypted*, *ACS* or *LCP*.
- Every EPUB is inspected on the way in. Adobe ADEPT (`rights.xml`), Readium LCP
  (`license.lcpl`) and any `encryption.xml` that uses a real cipher are **rejected with an
  explanation** and nothing is stored. (Font obfuscation, which many ordinary books use, is
  correctly *not* treated as DRM.)
- Kindle formats (AZW/MOBI/KFX) are refused with an explanation.
- **It does not and will not strip DRM.** Purchased Kindle or Apple Books titles stay
  encrypted. That is a deliberate scope decision: circumventing DRM breaches the platforms'
  terms and is illegal in many jurisdictions (e.g. DMCA §1201 in the US).

Public-domain status varies by country. Project Gutenberg's catalogue is public domain **in the
US**; the UI says so, and asks you to check your own jurisdiction.

## Sources

| Source | Search | Download | Notes |
|---|---|---|---|
| **Standard Ebooks** | Public HTML search page, parsed (their OPDS feed requires a login). Sorted by popularity when browsing. | Direct from `standardebooks.org` (sends CORS headers). | English only; the best-produced editions. |
| **Project Gutenberg** | [Gutendex](https://gutendex.com) JSON API; falls back to Gutenberg's own OPDS feed if Gutendex fails. | `gutenberg.org` EPUB (no CORS → proxy). | Gutendex can take 25 s+ to answer; the UI shows a "slow source" hint. Gutenberg has maintenance windows. |
| **Internet Archive** | `advancedsearch`, restricted to public-domain scan collections, unrestricted items, EPUB or OCR'd PDF. Only searched when you type a query (an empty query would just be 3.9 M random scans). | File chosen via the item's `metadata` API (EPUB first). Neither redirect hop sends CORS headers → proxy. | Quality varies; many scans are French/European. |

### The proxy (`/api/proxy`)

The browser always tries a source directly first. Only if that fails with a CORS/network error
does it retry through `netlify/functions/lib/proxy.ts`. Because proxied bytes are served from
*your* origin, it is a security boundary and is written (and tested) as one: https-only, strict
host allowlist, no credentials/odd ports, **redirects followed by hand with every hop
re-checked**, GET/HEAD only, 200 MB cap, and `Content-Security-Policy: sandbox` + `nosniff` on
every response so nothing served through it can ever execute script on your origin.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — includes the same /api/proxy as production
npm test             # 244 unit tests
npm run build        # tsc -b && vite build
npm run probe        # live smoke test against the real sources (needs network)
```

`npm run dev` serves `/api/proxy` through a Vite middleware that loads the **same handler**
Netlify runs, so there is one code path to trust. `npm run dev:netlify` runs the full Netlify
dev stack instead.

### Deploy (Netlify)

`netlify.toml` is ready: static `dist/` plus the `proxy` function, with `/api/*` redirected to
functions and an SPA fallback. No environment variables are needed — the app has no AI calls
and no secrets.

**Known limit:** Netlify caps streamed function responses at roughly 20 MB. Most EPUBs are far
smaller, but a few Internet Archive scans are larger (one common edition of *Moby-Dick* is
31 MB). Those fail with a clear error when deployed there and work locally. If that matters,
the same handler can be mounted as a Netlify **Edge Function** (streaming, no size cap) — it is
written with web-standard APIs only, so `netlify/edge-functions/proxy.ts` would be a three-line
file that imports `handleProxy` and exports `config = { path: "/api/proxy" }`.

## Data & durability

IndexedDB (Dexie), database `le-bouquiniste`:

| Table | Holds |
|---|---|
| `books` | Metadata, progress, reading location (EPUB CFI), cover (small data URL), shelf ids |
| `files` | The book bytes — separate so listing the library never loads them |
| `annotations` | Highlights and bookmarks |
| `shelves`, `settings` | Shelves; app settings; cached reader page-locations per book |

Because this is the **only copy** of the library:

- The app requests **persistent storage** at boot, and *Réglages → Stockage* shows whether it
  was granted (with a retry button) so the user is never falsely reassured.
- Schema migrations must never clear or drop user data (additive indexes only; see `db.ts`).
- *Réglages → Sauvegarde* exports/restores everything as a ZIP.

## Code map

```
src/
  providers/      standardebooks · gutenberg · archive  (+ types, registry, fixtures, live probe)
  lib/            net (direct→proxy fallback, streaming downloads) · ingest (the single door into
                  the library) · epub-meta (metadata, covers, DRM detection) · ops (all DB writes)
                  · backup · library (filter/sort) · names (author/language normalisation)
  store/          download manager (queue, cancel, retry) · settings · toasts · confirm
  components/     Discover · Library · BookDetail · SettingsView · Onboarding · ui
    reader/       EpubReader (epub.js) · panels · themes · search · toc · notes · PdfReader
  i18n.ts         fr/en dictionaries — `Key` is derived from French, English must satisfy it
netlify/functions/ proxy handler (pure, unit-tested) + the Netlify entry point
```

### Adding a source

Implement `Provider` (`src/providers/types.ts`): `search()` returning normalised `Hit`s and
`resolveDownload()` returning a real file URL. Register it in `src/providers/index.ts`, add its
host to `ALLOWED_HOSTS` in the proxy, add a fixture + parser tests, and run `npm run probe`.
Set `browsable: false` if an empty query isn't meaningful for it. If the source can't offer
DRM-free files, don't add it.

## Testing notes

244 tests cover: all three parsers against **real captured responses** (Standard Ebooks HTML,
Internet Archive JSON) plus schema-faithful Gutendex/OPDS fixtures (the real Gutendex response
was later checked against the fixture and matched); provider request building and the
Gutenberg fallback chain; the proxy's SSRF/redirect/size/CSP behaviour; EPUB metadata, cover
discovery and **every DRM variant**; ingest validation (HTML error pages masquerading as EPUBs
are refused); dedupe, cascades and progress rules; backup round-trips including merge and
tamper cases; the download manager's concurrency, cancel and retry; i18n parity, plural
rules and a scan proving every `t("…")` key used in the source exists.

Three bugs found during live testing now have regression tests: epub.js sizing chapters from
off-screen hidden headings (phantom blank pages — `epub-patch.ts`), `resize()` racing the first
page display (blank book — `layout.ts`), and a rebuilt reader jumping back to where the session
began (`resumeTarget` in `toc.ts`).

## Known limits

- Reading position is saved when epub.js reports a new location; closing the tab in the same
  frame as a page turn can lose that last turn.
- PDFs have no in-app progress (the browser's viewer doesn't expose it).
- Offline: books already in the library read offline; the app shell itself is not yet a
  service-worker PWA, and reader fonts (Literata, Atkinson) fall back to system fonts offline.
- Covers for Internet Archive scans are often just photographs of the binding.
