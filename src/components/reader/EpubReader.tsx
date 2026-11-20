import ePub, { type Book as EpubBook, type Contents, type Location, type Rendition } from "epubjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { formatMinutes, formatPercent } from "../../lib/format";
import { addAnnotation, loadLocations, removeAnnotation, saveLocation, saveLocations, saveProgress } from "../../lib/ops";
import { useAnnotations } from "../../store/library";
import { useSettings } from "../../store/settings";
import { toast } from "../../store/toast";
import type { Annotation, Book, HighlightColor, ReaderPrefs } from "../../types";
import { Icon, Spinner } from "../ui";
import { searchBook, type SearchHit } from "./epub-search";
import { patchEpubMeasurement } from "./epub-patch";
import { decideResize, type Size } from "./layout";
import { formatNotesMarkdown } from "./notes";
import { ContentsPanel, NoteEditor, SelectionPopover, SettingsPopover, type Anchor, type PanelTab } from "./ReaderPanels";
import { buildThemeRules, HIGHLIGHT_COLORS, MARGIN_WIDTHS, READER_FONTS_URL, THEME_COLORS, themeName } from "./themes";
import { chapterFor, flattenToc, resumeTarget, type FlatTocItem } from "./toc";

patchEpubMeasurement();

const CHARS_PER_LOCATION = 1600;
/** A comfortable adult reading speed, in characters per minute (~240 words). */
const CHARS_PER_MINUTE = 1400;
const SAVE_DELAY_MS = 700;

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function applyPrefs(rendition: Rendition, prefs: ReaderPrefs): void {
  const name = themeName(prefs);
  rendition.themes.register(name, buildThemeRules(prefs));
  rendition.themes.select(name);
  rendition.themes.fontSize(`${prefs.fontSize}%`);
}

function fractionFor(epub: EpubBook, loc: Location): number {
  if (loc.atEnd) return 1;
  if (epub.locations.length() > 0) {
    const p = epub.locations.percentageFromCfi(loc.start.cfi);
    if (Number.isFinite(p)) return Math.min(Math.max(p, 0), 1);
  }
  const total = (epub.spine as unknown as { length: number }).length || 1;
  const within = loc.start.displayed?.total ? (loc.start.displayed.page - 1) / loc.start.displayed.total : 0;
  return Math.min((loc.start.index + within) / total, 1);
}

function frameOffset(win: Window | null | undefined): { left: number; top: number } {
  const frame = win?.frameElement as HTMLElement | null | undefined;
  const rect = frame?.getBoundingClientRect();
  return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
}

interface Props {
  book: Book;
  data: ArrayBuffer;
  onClose: () => void;
}

interface PendingSelection {
  cfi: string;
  text: string;
  anchor: Anchor;
  contents: Contents;
}

export function EpubReader({ book, data, onClose }: Props) {
  const { t } = useT();
  const { settings, update } = useSettings();
  const prefs = settings.reader;
  const colors = THEME_COLORS[prefs.theme];
  const annotations = useAnnotations(book.id);

  const hostRef = useRef<HTMLDivElement>(null);
  const epubRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const lastLocation = useRef<Location | null>(null);
  const drawn = useRef(new Map<string, { cfi: string; color: HighlightColor }>());
  const pendingSave = useRef<{ progress: number | null; cfi: string } | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const searchAbort = useRef<AbortController | null>(null);
  const sizeRef = useRef<Size | null>(null);
  // Where to open. Captured once: later saves must never rebuild the rendition.
  const startLocation = useRef(book.location).current;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [toc, setToc] = useState<FlatTocItem[]>([]);
  const [progress, setProgress] = useState(book.progress);
  const [scrub, setScrub] = useState<number | null>(null);
  const [chapter, setChapter] = useState<FlatTocItem | undefined>();
  const [locationsReady, setLocationsReady] = useState(false);
  const [totalChars, setTotalChars] = useState(0);
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bars, setBars] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [editing, setEditing] = useState<{ id: string; anchor: Anchor } | null>(null);
  const [search, setSearch] = useState({ query: "", hits: [] as SearchHit[], searching: false, truncated: false });

  const prefsRef = useLatest(prefs);
  const tocRef = useLatest(toc);
  const annotationsRef = useLatest(annotations);
  const barsRef = useLatest(bars);
  const chapterRef = useLatest(chapter);
  const panelOpen = useLatest(panel !== null || !!editing);

  /* ───── progress persistence ───── */

  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const pending = pendingSave.current;
    if (!pending) return;
    pendingSave.current = null;
    void (pending.progress === null ? saveLocation(book.id, pending.cfi) : saveProgress(book.id, pending.progress, pending.cfi));
  }, [book.id]);

  const scheduleSave = useCallback(
    (progressValue: number | null, cfi: string) => {
      pendingSave.current = { progress: progressValue, cfi };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushSave, SAVE_DELAY_MS);
    },
    [flushSave],
  );

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flushSave();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushSave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushSave);
    };
  }, [flushSave]);

  /* ───── helpers that read the live rendition ───── */

  const compareCfi = useCallback((a: string, b: string): number => {
    try {
      return renditionRef.current?.epubcfi.compare(a, b) ?? 0;
    } catch {
      return 0;
    }
  }, []);

  const isBookmarkedAt = useCallback(
    (location: Location | null): boolean => {
      if (!location) return false;
      return annotationsRef.current.some((a) => a.kind === "bookmark" && compareCfi(a.cfi, location.start.cfi) >= 0 && compareCfi(a.cfi, location.end.cfi) <= 0);
    },
    [annotationsRef, compareCfi],
  );

  const spineIndexOf = useCallback((href: string): number | undefined => {
    try {
      return epubRef.current?.spine.get(href)?.index;
    } catch {
      return undefined;
    }
  }, []);

  const handleRelocated = useCallback(
    (location: Location) => {
      const epub = epubRef.current;
      if (!epub) return;
      lastLocation.current = location;
      const accurate = epub.locations.length() > 0;
      const p = fractionFor(epub, location);
      setProgress(p);
      setChapter(chapterFor(tocRef.current, spineIndexOf, location.start.index));
      setBookmarked(isBookmarkedAt(location));
      setSelection(null);
      scheduleSave(accurate ? p : null, location.start.cfi);
    },
    [isBookmarkedAt, scheduleSave, spineIndexOf, tocRef],
  );
  const relocatedRef = useLatest(handleRelocated);

  /* ───── navigation ───── */

  const next = useCallback(() => void renditionRef.current?.next(), []);
  const prev = useCallback(() => void renditionRef.current?.prev(), []);

  const goto = useCallback((target: string) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    setPanel(null);
    void rendition.display(target).then(() => {
      // Flash search hits so the eye can find them.
      if (/^epubcfi/.test(target)) {
        try {
          rendition.annotations.highlight(target, {}, undefined, "bq-flash", { fill: "#f4b93a", "fill-opacity": "0.55" });
          window.setTimeout(() => rendition.annotations.remove(target, "highlight"), 2600);
        } catch {
          /* decoration only */
        }
      }
    });
  }, []);

  const goToFraction = useCallback((fraction: number) => {
    const epub = epubRef.current;
    if (!epub || epub.locations.length() === 0) return;
    const cfi = epub.locations.cfiFromPercentage(Math.min(Math.max(fraction, 0), 1));
    if (cfi) void renditionRef.current?.display(cfi);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* ───── bookmarks, highlights ───── */

  const toggleBookmark = useCallback(async () => {
    const location = lastLocation.current;
    const rendition = renditionRef.current;
    if (!location || !rendition) return;
    const here = annotationsRef.current.filter(
      (a) => a.kind === "bookmark" && compareCfi(a.cfi, location.start.cfi) >= 0 && compareCfi(a.cfi, location.end.cfi) <= 0,
    );
    if (here.length) {
      await Promise.all(here.map((a) => removeAnnotation(a.id)));
      return;
    }
    let snippet = "";
    try {
      snippet = rendition.getRange(location.start.cfi)?.toString().replace(/\s+/g, " ").trim().slice(0, 110) ?? "";
    } catch {
      /* snippet is optional */
    }
    await addAnnotation({ bookId: book.id, kind: "bookmark", cfi: location.start.cfi, text: snippet, chapter: chapterRef.current?.label });
  }, [annotationsRef, book.id, chapterRef, compareCfi]);

  const anchorFromMouse = (event: MouseEvent): Anchor => {
    const off = frameOffset(event.view);
    return { x: off.left + event.clientX, y: off.top + event.clientY };
  };

  const openEditor = useCallback((id: string, event: MouseEvent) => {
    event.stopPropagation?.();
    setSelection(null);
    setEditing({ id, anchor: anchorFromMouse(event) });
  }, []);
  const openEditorRef = useLatest(openEditor);

  // Keep drawn highlights in step with the database.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || status !== "ready") return;
    const wanted = new Map(annotations.filter((a) => a.kind === "highlight").map((a) => [a.id, a]));
    for (const [id, entry] of drawn.current) {
      const w = wanted.get(id);
      if (!w || w.color !== entry.color || w.cfi !== entry.cfi) {
        try {
          rendition.annotations.remove(entry.cfi, "highlight");
        } catch {
          /* already gone */
        }
        drawn.current.delete(id);
      }
    }
    for (const a of wanted.values()) {
      if (drawn.current.has(a.id)) continue;
      try {
        rendition.annotations.add("highlight", a.cfi, { id: a.id }, (e: MouseEvent) => openEditorRef.current(a.id, e), `bq-hl-${a.color}`, {
          fill: HIGHLIGHT_COLORS[a.color],
          "fill-opacity": "0.38",
          "mix-blend-mode": prefsRef.current.theme === "night" ? "screen" : "multiply",
        });
        drawn.current.set(a.id, { cfi: a.cfi, color: a.color });
      } catch {
        /* a CFI that no longer resolves is skipped rather than breaking the page */
      }
    }
    setBookmarked(isBookmarkedAt(lastLocation.current));
  }, [annotations, status, isBookmarkedAt, openEditorRef, prefsRef]);

  const createHighlight = useCallback(
    async (color: HighlightColor, thenNote: boolean) => {
      if (!selection) return;
      const created = await addAnnotation({
        bookId: book.id,
        kind: "highlight",
        cfi: selection.cfi,
        text: selection.text.slice(0, 1200),
        color,
        chapter: chapterRef.current?.label,
      });
      try {
        selection.contents.window.getSelection()?.removeAllRanges();
      } catch {
        /* selection already cleared */
      }
      setSelection(null);
      if (thenNote) setEditing({ id: created.id, anchor: selection.anchor });
    },
    [book.id, chapterRef, selection],
  );

  const copySelection = useCallback(async () => {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      toast("info", t("common.copied"), undefined, 1800);
    } catch {
      /* clipboard may be unavailable; nothing else to do */
    }
    setSelection(null);
  }, [selection, t]);

  /* ───── keyboard ───── */

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const scrolled = prefsRef.current.flow === "scrolled";
      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          if (!scrolled || event.key === "ArrowRight") (event.preventDefault(), next());
          break;
        case " ":
          event.preventDefault();
          event.shiftKey ? prev() : next();
          break;
        case "ArrowLeft":
        case "PageUp":
          if (!scrolled || event.key === "ArrowLeft") (event.preventDefault(), prev());
          break;
        case "Escape":
          if (panelOpen.current) break;
          setSelection(null);
          setShowSettings(false);
          break;
        case "t":
          setPanel("toc");
          break;
        case "/":
          event.preventDefault();
          setPanel("search");
          break;
        case "b":
          void toggleBookmark();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "h":
          setBars((b) => !b);
          break;
      }
    },
    [next, panelOpen, prefsRef, prev, toggleBookmark, toggleFullscreen],
  );
  const onKeyRef = useLatest(onKey);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onKeyRef]);

  /* ───── the epub.js lifecycle ───── */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setStatus("loading");
    setLocationsReady(false);
    setSelection(null);
    drawn.current.clear();

    sizeRef.current = null; // the new rendition is created at whatever size the host has now
    const epub = ePub(data.slice(0));
    epubRef.current = epub;
    const scrolled = prefsRef.current.flow === "scrolled";
    const rendition = epub.renderTo(host, {
      width: "100%",
      height: "100%",
      flow: scrolled ? "scrolled" : "paginated",
      manager: scrolled ? "continuous" : "default",
      spread: "none",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    rendition.hooks.content.register((contents: Contents) => {
      void contents.addStylesheet(READER_FONTS_URL).catch(() => false);
    });
    applyPrefs(rendition, prefsRef.current);

    rendition.on("relocated", (location: Location) => relocatedRef.current(location));
    rendition.on("keydown", (event: KeyboardEvent) => onKeyRef.current(event));

    rendition.on("selected", (cfiRange: string, contents: Contents) => {
      let text = "";
      let rect: DOMRect | undefined;
      try {
        const range = contents.range(cfiRange);
        text = range.toString().replace(/\s+/g, " ").trim();
        rect = range.getBoundingClientRect();
      } catch {
        return;
      }
      if (!text || !rect) return;
      const off = frameOffset(contents.window);
      setEditing(null);
      setSelection({ cfi: cfiRange, text, contents, anchor: { x: off.left + rect.left + rect.width / 2, y: off.top + rect.top } });
    });

    let touchStart: { x: number; y: number } | null = null;
    rendition.on("touchstart", (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
    });
    rendition.on("touchend", (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touchStart || !touch || prefsRef.current.flow !== "paginated") return;
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) > 55 && Math.abs(dy) < 45) (dx < 0 ? next : prev)();
    });

    rendition.on("click", (event: MouseEvent) => {
      const view = event.view;
      if (view?.getSelection()?.toString()) return;
      setSelection(null);
      setEditing(null);
      if ((event.target as Element | null)?.closest?.("a")) return;
      const off = frameOffset(view);
      const rect = host.getBoundingClientRect();
      const x = (off.left + event.clientX - rect.left) / rect.width;
      if (prefsRef.current.flow === "paginated" && x < 0.2) prev();
      else if (prefsRef.current.flow === "paginated" && x > 0.8) next();
      else setBars(!barsRef.current);
    });

    const show = (cfi?: string) => rendition.display(cfi);
    show(resumeTarget(lastLocation.current?.start.cfi, startLocation))
      .catch(() => show()) // a CFI from an older edition of the file: start from the top
      .then(() => !cancelled && setStatus("ready"))
      .catch(() => !cancelled && setStatus("error"));

    epub.loaded.navigation
      .then((nav) => !cancelled && setToc(flattenToc(nav.toc)))
      .catch(() => undefined);

    epub.ready
      .then(async () => {
        const cached = await loadLocations(book.id);
        if (cached) {
          epub.locations.load(cached);
        } else {
          await epub.locations.generate(CHARS_PER_LOCATION);
          await saveLocations(book.id, epub.locations.save());
        }
        if (cancelled) return;
        setTotalChars(epub.locations.length() * CHARS_PER_LOCATION);
        setLocationsReady(true);
        if (lastLocation.current) relocatedRef.current(lastLocation.current);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      flushSave();
      searchAbort.current?.abort();
      try {
        rendition.destroy();
        epub.destroy();
      } catch {
        /* torn down mid-load */
      }
      if (renditionRef.current === rendition) renditionRef.current = null;
      if (epubRef.current === epub) epubRef.current = null;
    };
    // The book is re-created only when the book itself or the page/scroll mode changes;
    // everything else (theme, size…) is applied live below.
  }, [book.id, startLocation, data, prefs.flow, flushSave, next, prev, barsRef, onKeyRef, prefsRef, relocatedRef]);

  // Live theme / font / size.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition && status === "ready") applyPrefs(rendition, prefs);
  }, [prefs, status]);

  // The text column follows container size (margins setting, side panels, rotation).
  // See decideResize for why the first report must not call rendition.resize().
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "ready") return;
    const observer = new ResizeObserver(() => {
      const decision = decideResize(sizeRef.current, { width: host.clientWidth, height: host.clientHeight }, lastLocation.current !== null);
      if (decision.remember) sizeRef.current = decision.remember;
      if (!decision.resize) return;
      try {
        renditionRef.current?.resize(host.clientWidth, host.clientHeight);
      } catch {
        /* mid-teardown */
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [status]);

  /* ───── search & notes ───── */

  const runSearch = useCallback((query: string) => {
    searchAbort.current?.abort();
    const epub = epubRef.current;
    const q = query.trim();
    if (!epub || q.length < 2) {
      setSearch({ query: q, hits: [], searching: false, truncated: false });
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearch({ query: q, hits: [], searching: true, truncated: false });
    void searchBook(epub, q, {
      signal: controller.signal,
      onHits: (hits) => setSearch((prev) => (prev.query === q ? { ...prev, hits: [...prev.hits, ...hits] } : prev)),
    }).then(({ truncated }) => {
      if (!controller.signal.aborted) setSearch((prev) => (prev.query === q ? { ...prev, searching: false, truncated } : prev));
    });
  }, []);

  const sortedAnnotations = useMemo(
    () => [...annotations].sort((a, b) => compareCfi(a.cfi, b.cfi) || a.createdAt - b.createdAt),
    // `status` re-sorts once the rendition exists and CFIs can be compared.
    [annotations, compareCfi, status],
  );

  const exportNotes = useCallback(async () => {
    const markdown = formatNotesMarkdown(book, sortedAnnotations, { highlights: t("reader.highlights"), bookmarks: t("reader.bookmarks") });
    try {
      await navigator.clipboard.writeText(markdown);
      toast("success", t("reader.notesCopied"));
    } catch {
      toast("error", t("dl.error.unknown"));
    }
  }, [book, sortedAnnotations, t]);

  const chapterOfHit = useCallback((hit: SearchHit) => chapterFor(toc, spineIndexOf, hit.spineIndex)?.label, [toc, spineIndexOf]);

  const editingAnnotation: Annotation | undefined = editing ? annotations.find((a) => a.id === editing.id) : undefined;
  const shownProgress = scrub ?? progress;
  const minutesLeft = locationsReady && totalChars ? ((1 - shownProgress) * totalChars) / CHARS_PER_MINUTE : null;
  const surface = { background: colors.bar, color: colors.fg, borderColor: colors.line };

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: colors.bg, color: colors.fg }} data-reader>
      <header className={`relative z-10 flex items-center gap-1 border-b-2 px-2 pt-safe transition-all ${bars ? "" : "pointer-events-none -mb-14 -translate-y-full opacity-0"}`} style={surface}>
        <button type="button" className="btn-ghost !px-2.5" onClick={onClose} aria-label={t("reader.back")}>
          <Icon name="arrowLeft" />
        </button>
        <div className="min-w-0 flex-1 px-1 py-2.5">
          <p className="truncate font-display text-sm font-bold leading-tight">{book.title}</p>
          <p className="truncate text-xs leading-tight" style={{ color: colors.soft }}>
            {chapter?.label ?? (status === "ready" ? t("reader.locationFallback") : "")}
          </p>
        </div>
        <button type="button" className="btn-ghost !px-2.5" onClick={() => setPanel("toc")} aria-label={t("reader.toc")} title={`${t("reader.toc")} (t)`}>
          <Icon name="list" />
        </button>
        <button type="button" className="btn-ghost !px-2.5" onClick={() => setPanel("search")} aria-label={t("reader.search")} title={`${t("reader.search")} (/)`}>
          <Icon name="search" />
        </button>
        <button type="button" className="btn-ghost !px-2.5" onClick={toggleBookmark} aria-pressed={bookmarked} aria-label={bookmarked ? t("reader.bookmarkRemove") : t("reader.bookmarkAdd")} title={`${bookmarked ? t("reader.bookmarkRemove") : t("reader.bookmarkAdd")} (b)`}>
          <Icon name="bookmark" filled={bookmarked} className={`h-5 w-5 ${bookmarked ? "text-tomato" : ""}`} />
        </button>
        <button type="button" className="btn-ghost !px-2.5 max-md:hidden" onClick={() => setPanel("notes")} aria-label={t("reader.notes")} title={t("reader.notes")}>
          <Icon name="pen" />
        </button>
        <button type="button" className="btn-ghost !px-2.5 max-sm:hidden" onClick={toggleFullscreen} aria-label={t("reader.fullscreen")} aria-pressed={fullscreen} title={`${t("reader.fullscreen")} (f)`}>
          <Icon name="fullscreen" />
        </button>
        <button type="button" data-settings-toggle className="btn-ghost !px-2.5" onClick={() => setShowSettings((s) => !s)} aria-label={t("reader.settings")} aria-expanded={showSettings} title={t("reader.settings")}>
          <Icon name="type" />
        </button>
        {showSettings ? <SettingsPopover prefs={prefs} onChange={(patch) => void update({ reader: patch })} onClose={() => setShowSettings(false)} /> : null}
      </header>

      <main className="relative min-h-0 flex-1">
        <div ref={hostRef} className="mx-auto h-full w-full" style={{ maxWidth: MARGIN_WIDTHS[prefs.margin] }} aria-label={book.title} />

        {prefs.flow === "paginated" && status === "ready" ? (
          <>
            <button type="button" onClick={prev} aria-label={t("reader.prev")} className="absolute inset-y-0 left-0 hidden w-16 items-center justify-start pl-2 opacity-0 transition hover:opacity-100 focus-visible:opacity-100 md:flex">
              <span className="rounded-full border-2 p-2" style={surface}>
                <Icon name="chevronLeft" />
              </span>
            </button>
            <button type="button" onClick={next} aria-label={t("reader.next")} className="absolute inset-y-0 right-0 hidden w-16 items-center justify-end pr-2 opacity-0 transition hover:opacity-100 focus-visible:opacity-100 md:flex">
              <span className="rounded-full border-2 p-2" style={surface}>
                <Icon name="chevronRight" />
              </span>
            </button>
          </>
        ) : null}

        {status === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: colors.bg }} role="status">
            <Spinner className="h-8 w-8" />
            <p className="font-serif text-xl italic" style={{ color: colors.soft }}>
              {t("reader.loading")}
            </p>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ background: colors.bg }} role="alert">
            <Icon name="alert" className="h-10 w-10 text-tomato" />
            <h2 className="font-display text-2xl font-extrabold">{t("reader.error")}</h2>
            <p className="max-w-sm" style={{ color: colors.soft }}>
              {t("reader.errorHint")}
            </p>
            <button type="button" className="btn-plain" onClick={onClose}>
              <Icon name="arrowLeft" className="h-4 w-4" />
              {t("reader.back")}
            </button>
          </div>
        ) : null}
      </main>

      <footer className={`relative z-10 flex items-center gap-3 border-t-2 px-4 pb-safe pt-2 transition-all ${bars ? "" : "pointer-events-none -mt-14 translate-y-full opacity-0"}`} style={surface}>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(shownProgress * 1000)}
          disabled={!locationsReady}
          onChange={(e) => setScrub(Number(e.target.value) / 1000)}
          onPointerUp={() => scrub !== null && (goToFraction(scrub), setScrub(null))}
          onKeyUp={() => scrub !== null && (goToFraction(scrub), setScrub(null))}
          onBlur={() => scrub !== null && (goToFraction(scrub), setScrub(null))}
          aria-label={t("detail.progress")}
          aria-valuetext={formatPercent(shownProgress)}
          className="h-2 min-w-0 flex-1 accent-tomato disabled:opacity-40"
        />
        <p className="flex shrink-0 items-baseline gap-2 py-2 text-xs font-semibold tabular-nums" style={{ color: colors.soft }} aria-live="off">
          {locationsReady ? null : status === "ready" ? (
            <span className="flex items-center gap-1.5" title={t("reader.indexing")}>
              <Spinner className="h-3 w-3" />
              <span className="hidden sm:inline">{t("reader.indexing")}</span>
            </span>
          ) : null}
          <span style={{ color: colors.fg }}>{formatPercent(shownProgress)}</span>
          {minutesLeft !== null ? <span className="hidden sm:inline">· {t("reader.timeLeft", { time: formatMinutes(minutesLeft) })}</span> : null}
        </p>
      </footer>

      <ContentsPanel
        tab={panel}
        onTab={setPanel}
        onClose={() => setPanel(null)}
        toc={toc}
        currentChapterId={chapter?.id}
        onGoto={goto}
        search={{ ...search, chapterOf: chapterOfHit }}
        onSearch={runSearch}
        annotations={sortedAnnotations}
        onDeleteAnnotation={(id) => void removeAnnotation(id)}
        onExport={exportNotes}
      />

      {selection ? (
        <SelectionPopover
          anchor={selection.anchor}
          onHighlight={(color) => void createHighlight(color, false)}
          onNote={() => void createHighlight("yellow", true)}
          onCopy={() => void copySelection()}
          onDismiss={() => setSelection(null)}
        />
      ) : null}

      {editing && editingAnnotation ? <NoteEditor key={editingAnnotation.id} annotation={editingAnnotation} anchor={editing.anchor} onClose={() => setEditing(null)} /> : null}

      <span className="sr-only" aria-live="polite">
        {chapter?.label ? `${chapter.label} — ${formatPercent(progress)}` : ""}
      </span>
    </div>
  );
}
