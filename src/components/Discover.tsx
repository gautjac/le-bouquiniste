import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useT } from "../i18n";
import { formatBytes, formatCount, formatPercent } from "../lib/format";
import { isAbort } from "../lib/net";
import { joinAuthors } from "../lib/names";
import { PROVIDERS, SOURCE_META, type Hit, type Provider, type SearchPage, type SourceId } from "../providers";
import { confirmDialog } from "../store/confirm";
import { cancelDownload, dismissDownload, startDownload, useDownload } from "../store/downloads";
import { useLibraryIndex } from "../store/library";
import { Cover, EmptyState, Icon, ProgressBar, Spinner } from "./ui";

const LANGUAGES = ["fr", "en", "es", "de", "it", "pt", "la"];

type SourceStatus = "idle" | "loading" | "ok" | "error";

interface SourceState {
  status: SourceStatus;
  hits: Hit[];
  page: number;
  nextPage: number | null;
  total: number | null;
  loadingMore: boolean;
}

const blankState = (): SourceState => ({ status: "loading", hits: [], page: 0, nextPage: null, total: null, loadingMore: false });

interface Props {
  onOpenBook: (bookId: string) => void;
}

export function Discover({ onOpenBook }: Props) {
  const { t, tp, lang } = useT();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<string | undefined>(undefined);
  const [enabled, setEnabled] = useState<Record<SourceId, boolean>>({ standardebooks: true, gutenberg: true, archive: true });
  const [results, setResults] = useState<Partial<Record<SourceId, SourceState>>>({});
  const aborts = useRef<Partial<Record<SourceId, AbortController>>>({});
  const libraryIndex = useLibraryIndex();

  const languageName = useMemo(() => {
    const names = new Intl.DisplayNames([lang], { type: "language" });
    return (code: string) => {
      const label = names.of(code) ?? code;
      return label.charAt(0).toUpperCase() + label.slice(1);
    };
  }, [lang]);

  const runSearch = useCallback((provider: Provider, q: string, lng: string | undefined, page: number) => {
    aborts.current[provider.id]?.abort();
    const controller = new AbortController();
    aborts.current[provider.id] = controller;

    provider
      .search({ query: q, language: lng, page, signal: controller.signal })
      .then((result: SearchPage) => {
        if (controller.signal.aborted) return;
        setResults((prev) => {
          const before = prev[provider.id];
          const merged = page > 1 && before ? dedupe([...before.hits, ...result.hits]) : result.hits;
          return {
            ...prev,
            [provider.id]: { status: "ok", hits: merged, page, nextPage: result.nextPage, total: result.total, loadingMore: false },
          };
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setResults((prev) => {
          const before = prev[provider.id];
          // A failed "load more" keeps what we already have on screen.
          if (page > 1 && before) return { ...prev, [provider.id]: { ...before, loadingMore: false } };
          return { ...prev, [provider.id]: { ...blankState(), status: "error" } };
        });
      });
  }, []);

  // New query / language / source selection → fresh searches, all sources in parallel.
  useEffect(() => {
    const active = PROVIDERS.filter((p) => enabled[p.id]);
    // A source that's only useful when searched stays idle while browsing.
    const searchable = active.filter((p) => query || p.browsable);
    setResults(
      Object.fromEntries(active.map((p) => [p.id, searchable.includes(p) ? blankState() : { ...blankState(), status: "idle" as const }])) as Partial<
        Record<SourceId, SourceState>
      >,
    );
    for (const provider of searchable) runSearch(provider, query, language, 1);
    const controllers = aborts.current;
    return () => Object.values(controllers).forEach((c) => c?.abort());
  }, [query, language, enabled, runSearch]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };

  const loadMore = (provider: Provider) => {
    const state = results[provider.id];
    if (!state?.nextPage || state.loadingMore) return;
    setResults((prev) => ({ ...prev, [provider.id]: { ...state, loadingMore: true } }));
    runSearch(provider, query, language, state.nextPage);
  };

  const toggleSource = (id: SourceId) => {
    setEnabled((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      return Object.values(next).some(Boolean) ? next : prev; // never switch every source off
    });
  };

  const activeProviders = PROVIDERS.filter((p) => enabled[p.id]);
  const everyoneDone = activeProviders.every((p) => results[p.id]?.status !== "loading");
  const settled = activeProviders.filter((p) => results[p.id]?.status !== "idle");
  const totalHits = activeProviders.reduce((n, p) => n + (results[p.id]?.hits.length ?? 0), 0);

  return (
    <div className="pb-8">
      <section className="relative overflow-hidden border-b-2 border-ink bg-stall text-white">
        <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-mustard/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-60 w-60 rounded-full bg-tomato/25 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 pb-7 pt-8 sm:px-6 sm:pt-12">
          <h1 className="font-display text-4xl font-extrabold leading-none sm:text-6xl">
            {t("discover.title")}
            <span className="ml-2 inline-block -rotate-6 rounded-full bg-tomato px-3 py-1 align-middle font-sans text-xs font-extrabold uppercase tracking-widest text-white sm:text-sm">
              {t("book.free")}
            </span>
          </h1>
          <p className="mt-3 max-w-xl font-serif text-xl italic text-white/85 sm:text-2xl">{t("discover.subtitle")}</p>

          <form onSubmit={submit} className="mt-6 flex max-w-2xl gap-2" role="search">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t("discover.search")}</span>
              <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-soft" />
              <input
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("discover.placeholder")}
                className="field !rounded-2xl !py-3.5 !pl-12 text-ink shadow-stamp"
                autoComplete="off"
                enterKeyHint="search"
              />
            </label>
            <button type="submit" className="btn-primary !rounded-2xl !px-5">
              {t("discover.search")}
            </button>
          </form>

          <div className="scroll-thin -mx-4 mt-5 flex items-center gap-2 overflow-x-auto px-4 pb-1.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label={t("discover.anyLang")}>
            <button type="button" className="chip shrink-0 !border-white/70 !bg-white/10 !text-white hover:!bg-white/25 aria-pressed:!bg-white aria-pressed:!text-stall" aria-pressed={!language} onClick={() => setLanguage(undefined)}>
              <Icon name="globe" className="h-4 w-4" />
              {t("discover.anyLang")}
            </button>
            {LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                className="chip shrink-0 !border-white/70 !bg-white/10 !text-white hover:!bg-white/25 aria-pressed:!bg-white aria-pressed:!text-stall"
                aria-pressed={language === code}
                onClick={() => setLanguage(language === code ? undefined : code)}
              >
                {languageName(code)}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("settings.sources")}>
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                aria-pressed={enabled[provider.id]}
                onClick={() => toggleSource(provider.id)}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-white/40 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white/70 transition hover:border-white aria-pressed:border-mustard aria-pressed:bg-mustard aria-pressed:text-ink"
              >
                <Icon name={enabled[provider.id] ? "check" : "plus"} className="h-3.5 w-3.5" />
                {SOURCE_META[provider.id].short}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 pt-6">
          <h2 className="font-display text-2xl font-extrabold">
            {query ? t("discover.resultsFor", { q: query }) : t("discover.popular")}
          </h2>
          <p className="text-sm text-soft">
            <Icon name="info" className="mr-1 inline h-4 w-4 -translate-y-px" />
            {t("discover.note")}
          </p>
        </div>

        {everyoneDone && totalHits === 0 && settled.length > 0 && settled.every((p) => results[p.id]?.status === "ok") ? (
          <EmptyState icon="search" title={t("discover.allEmpty")} />
        ) : null}

        {activeProviders.map((provider) => {
          const state = results[provider.id];
          return (
            <SourceSection
              key={provider.id}
              provider={provider}
              state={state}
              onMore={() => loadMore(provider)}
              onRetry={() => {
                setResults((prev) => ({ ...prev, [provider.id]: blankState() }));
                runSearch(provider, query, language, 1);
              }}
              libraryIndex={libraryIndex}
              onOpenBook={onOpenBook}
              totalLabel={(n) => tp("discover.total", n, { n: formatCount(n, lang) })}
              hideWhenEmpty={everyoneDone && totalHits === 0}
            />
          );
        })}
      </div>
    </div>
  );
}

function dedupe(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.key) ? false : (seen.add(h.key), true)));
}

interface SectionProps {
  provider: Provider;
  state: SourceState | undefined;
  onMore: () => void;
  onRetry: () => void;
  libraryIndex: Map<string, string>;
  onOpenBook: (id: string) => void;
  totalLabel: (n: number) => string;
  hideWhenEmpty: boolean;
}

/** True once `active` has been continuously true for `ms`. */
function useElapsed(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    setElapsed(false);
    if (!active) return;
    const timer = window.setTimeout(() => setElapsed(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return elapsed;
}

function SourceSection({ provider, state, onMore, onRetry, libraryIndex, onOpenBook, totalLabel, hideWhenEmpty }: SectionProps) {
  const { t } = useT();
  const slow = useElapsed(state?.status === "loading" && state.hits.length === 0, 6000);
  const meta = SOURCE_META[provider.id];
  if (!state) return null;
  if (state.status === "idle") {
    return (
      <section className="mt-6" aria-labelledby={`src-${provider.id}`}>
        <h3 id={`src-${provider.id}`} className={`mb-3 w-fit rounded-full border-2 px-3 py-1 font-sans text-xs font-extrabold uppercase tracking-wider ${meta.badge}`}>
          {provider.label}
        </h3>
        <p className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-ink/30 bg-surface/50 px-4 py-3 text-sm text-soft">
          <Icon name="search" className="h-5 w-5 shrink-0" />
          {t("discover.searchToBrowse", { source: provider.label })}
        </p>
      </section>
    );
  }
  if (hideWhenEmpty && state.status === "ok" && state.hits.length === 0) return null;

  return (
    <section className="mt-6" aria-labelledby={`src-${provider.id}`}>
      <div className="mb-3 flex items-center gap-3">
        <h3 id={`src-${provider.id}`} className={`rounded-full border-2 px-3 py-1 font-sans text-xs font-extrabold uppercase tracking-wider ${meta.badge}`}>
          {provider.label}
        </h3>
        {state.status === "ok" && state.total !== null ? <span className="text-sm text-soft">{totalLabel(state.total)}</span> : null}
        {state.status === "loading" ? <Spinner className="h-4 w-4 text-soft" /> : null}
        {state.status === "loading" && slow ? <span className="text-sm italic text-soft">{t("discover.slow")}</span> : null}
      </div>

      {state.status === "loading" && state.hits.length === 0 ? <CardSkeletons /> : null}

      {state.status === "error" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-ink/40 bg-surface/60 px-4 py-3 text-sm" role="alert">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-tomato" />
          <span className="min-w-0 flex-1">{t("discover.sourceDown", { source: provider.label })}</span>
          <button type="button" className="btn-plain !px-3 !py-1.5" onClick={onRetry}>
            <Icon name="refresh" className="h-4 w-4" />
            {t("common.retry")}
          </button>
        </div>
      ) : null}

      {state.status === "ok" && state.hits.length === 0 ? <p className="text-sm text-soft">{t("discover.noResults")}</p> : null}

      {state.hits.length > 0 ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {state.hits.map((hit, i) => (
            <li key={hit.key} className="animate-rise" style={{ animationDelay: `${Math.min(i, 11) * 30}ms` }}>
              <ResultCard hit={hit} bookId={libraryIndex.get(hit.key)} onOpenBook={onOpenBook} />
            </li>
          ))}
        </ul>
      ) : null}

      {state.nextPage ? (
        <div className="mt-6 flex justify-center">
          <button type="button" className="btn-plain" onClick={onMore} disabled={state.loadingMore}>
            {state.loadingMore ? <Spinner className="h-4 w-4" /> : <Icon name="chevronDown" className="h-4 w-4" />}
            {t("discover.loadMore")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CardSkeletons() {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="space-y-2">
          <div className="skeleton aspect-[2/3]" />
          <div className="skeleton h-4 w-4/5" />
          <div className="skeleton h-3 w-2/5" />
        </li>
      ))}
    </ul>
  );
}

/** One book at the stall. Owns the add / progress / read button state machine. */
function ResultCard({ hit, bookId, onOpenBook }: { hit: Hit; bookId: string | undefined; onOpenBook: (id: string) => void }) {
  const { t, lang } = useT();
  const download = useDownload(hit.key);
  const author = joinAuthors(hit.authors) || t("book.unknownAuthor");
  const meta = SOURCE_META[hit.source];
  const inLibrary = bookId ?? (download?.phase === "done" ? download.bookId : undefined);
  const busy = download && ["queued", "resolving", "downloading", "saving"].includes(download.phase);

  const add = () =>
    startDownload(hit, {
      confirmLarge: (bytes) =>
        confirmDialog({
          message: t("dl.confirmLarge", { size: formatBytes(bytes, lang) }),
          confirmLabel: t("book.add"),
          cancelLabel: t("common.cancel"),
        }),
    });

  return (
    <article className="group flex h-full flex-col">
      <div className="relative">
        <a
          href={hit.detailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-md border-2 border-ink shadow-stamp transition group-hover:-translate-y-1 group-hover:shadow-stamp-lg"
          aria-label={t("book.viewOnSource", { source: meta.short })}
          title={t("book.viewOnSource", { source: meta.short })}
        >
          <Cover title={hit.title} author={author} src={hit.coverUrl} />
        </a>
        {!inLibrary ? <span className="sticker absolute -right-2 -top-2 h-11 w-11 shadow-stamp-sm">{t("book.free")}</span> : null}
        {inLibrary ? (
          <span className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-stall text-white shadow-stamp-sm" title={t("book.inLibrary")}>
            <Icon name="check" className="h-5 w-5" />
          </span>
        ) : null}
      </div>

      <h4 className="mt-3 line-clamp-2 font-display text-[0.95rem] font-bold leading-snug" title={hit.title}>
        {hit.title}
      </h4>
      <p className="line-clamp-1 font-serif text-base italic text-soft">{author}</p>
      <p className="mt-0.5 line-clamp-1 text-xs text-soft/80">
        {[hit.year, hit.languages[0]?.toUpperCase(), hit.downloads[0]?.format.toUpperCase()].filter(Boolean).join(" · ")}
      </p>

      <div className="mt-auto pt-3">
        {inLibrary ? (
          <button type="button" className="btn-green w-full !py-1.5" onClick={() => onOpenBook(inLibrary)}>
            <Icon name="book" className="h-4 w-4" />
            {t("book.read")}
          </button>
        ) : busy ? (
          <ProgressRow downloadKey={hit.key} />
        ) : download?.phase === "error" ? (
          <div className="space-y-1.5" role="alert">
            <p className="text-xs font-semibold text-tomato">{errorMessage(download.errorKind, download.errorDetail, t)}</p>
            <div className="flex gap-2">
              <button type="button" className="btn-plain flex-1 !py-1.5" onClick={add}>
                <Icon name="refresh" className="h-4 w-4" />
                {t("common.retry")}
              </button>
              <button type="button" className="btn-ghost !px-2" onClick={() => dismissDownload(hit.key)} aria-label={t("common.close")}>
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-primary w-full !py-1.5" onClick={add}>
            <Icon name="download" className="h-4 w-4" />
            {t("book.add")}
          </button>
        )}
      </div>
    </article>
  );
}

function ProgressRow({ downloadKey }: { downloadKey: string }) {
  const { t } = useT();
  const state = useDownload(downloadKey);
  if (!state) return null;
  const known = state.total ? state.loaded / state.total : null;
  const label =
    state.phase === "queued"
      ? t("book.queued")
      : state.phase === "resolving"
        ? t("book.resolving")
        : state.phase === "saving"
          ? t("book.saving")
          : known !== null
            ? t("book.downloading", { pct: formatPercent(known) })
            : t("book.downloadingUnknown");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <span className="flex min-w-0 items-center gap-1.5">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        {state.phase !== "saving" ? (
          <button type="button" className="shrink-0 rounded-full p-1 hover:bg-ink/10" onClick={() => cancelDownload(downloadKey)} aria-label={t("book.cancel")}>
            <Icon name="x" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <ProgressBar value={known ?? (state.phase === "saving" ? 1 : 0.08)} />
    </div>
  );
}

export function errorMessage(kind: string | undefined, detail: string | undefined, t: ReturnType<typeof useT>["t"]): string {
  switch (kind) {
    case "drm":
      return t("dl.error.drm");
    case "network":
      return t("dl.error.network");
    case "http":
      return t("dl.error.http");
    case "parse":
      return t("dl.error.parse");
    case "invalid":
      return t("dl.error.invalid");
    case "too-large":
      return t("dl.error.tooLarge");
    default:
      return detail && detail.length < 140 ? detail : t("dl.error.unknown");
  }
}
