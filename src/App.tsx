import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Discover } from "./components/Discover";
import { Library } from "./components/Library";
import { Onboarding } from "./components/Onboarding";
import { SettingsView } from "./components/SettingsView";
import { ConfirmHost, Icon, Spinner, Toaster, type IconName } from "./components/ui";
import { useT } from "./i18n";
import { useImporter } from "./lib/import-ui";
import { formatHash, parseHash, type Route } from "./lib/route";
import { onDownloadSettled, useActiveDownloads } from "./store/downloads";
import { useBooks } from "./store/library";
import { useSettings } from "./store/settings";
import { toast } from "./store/toast";

function useRoute(): [Route | null, (route: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route | null>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Route, replace = false) => {
    const hash = formatHash(next);
    if (replace) {
      window.history.replaceState(null, "", hash);
      setRoute(next);
    } else {
      window.location.hash = hash;
    }
  }, []);
  return [route, navigate];
}

// epub.js is the heaviest dependency and only the reader needs it: load it on first open.
const Reader = lazy(() => import("./components/Reader").then((m) => ({ default: m.Reader })));

const TABS: { name: "discover" | "library" | "settings"; icon: IconName; label: "nav.discover" | "nav.library" | "nav.settings" }[] = [
  { name: "discover", icon: "search", label: "nav.discover" },
  { name: "library", icon: "shelves", label: "nav.library" },
  { name: "settings", icon: "settings", label: "nav.settings" },
];

export function App() {
  const { t, tp, lang } = useT();
  const { settings, ready } = useSettings();
  const books = useBooks();
  const importFiles = useImporter();
  const active = useActiveDownloads();
  const [route, navigate] = useRoute();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const openBook = useCallback((id: string) => navigate({ name: "read", id }), [navigate]);

  // First visit with no hash: the shelf if there are books, otherwise the stall.
  useEffect(() => {
    if (route || !books) return;
    navigate({ name: books.length ? "library" : "discover" }, true);
  }, [route, books, navigate]);

  // Language and light/dark preference on <html>.
  useEffect(() => {
    document.documentElement.lang = lang;
    if (settings.ui === "auto") delete document.documentElement.dataset.ui;
    else document.documentElement.dataset.ui = settings.ui;
  }, [lang, settings.ui]);

  // Tab title follows the screen.
  useEffect(() => {
    const names = { discover: t("nav.discover"), library: t("nav.library"), settings: t("nav.settings"), read: "" } as const;
    const name = route ? names[route.name] : "";
    document.title = name ? `${name} — ${t("app.name")}` : `${t("app.name")} — ${t("app.tagline")}`;
  }, [route, t]);

  useEffect(() => {
    if (route && route.name !== "read") window.scrollTo({ top: 0 });
  }, [route]);

  // A finished download tells you, wherever you are in the app.
  const translator = useRef({ t, tp });
  translator.current = { t, tp };
  useEffect(
    () =>
      onDownloadSettled((hit, state) => {
        if (state.phase !== "done" || !state.bookId) return;
        const bookId = state.bookId;
        toast(
          state.duplicate ? "info" : "success",
          translator.current.t(state.duplicate ? "dl.alreadyThere" : "dl.added", { title: hit.title }),
          { label: translator.current.t("book.read"), run: () => openBook(bookId) },
          7000,
        );
      }),
    [openBook],
  );

  // Drop books anywhere in the window.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void importFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [importFiles]);

  const reading = route?.name === "read" ? route.id : null;
  const current = route?.name === "read" ? undefined : route?.name;

  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-bg">
        {t("a11y.skip")}
      </a>

      <header className="sticky top-0 z-30 border-b-2 border-ink bg-stall-deep text-white pt-safe">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5 sm:px-6">
          <a href={formatHash({ name: "discover" })} className="flex items-center gap-2.5" aria-label={t("app.name")}>
            <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-lg border-2 border-white/80" />
            <span className="leading-none">
              <span className="block font-display text-xl font-extrabold tracking-tight">{t("app.name")}</span>
              <span className="hidden font-serif text-sm italic text-white/70 sm:block">{t("app.tagline")}</span>
            </span>
          </a>

          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label={t("nav.label")}>
            {TABS.map((tab) => (
              <a
                key={tab.name}
                href={formatHash({ name: tab.name })}
                aria-current={current === tab.name ? "page" : undefined}
                className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white/80 transition hover:bg-white/10 hover:text-white aria-[current=page]:bg-white aria-[current=page]:text-stall-deep"
              >
                <Icon name={tab.icon} className="h-4 w-4" />
                {t(tab.label)}
                {tab.name === "library" && books?.length ? <span className="rounded-full bg-mustard px-1.5 text-xs text-ink">{books.length}</span> : null}
              </a>
            ))}
          </nav>

          {active.length ? (
            <a href={formatHash({ name: "discover" })} className="ml-auto flex items-center gap-2 rounded-full bg-mustard px-3 py-1.5 text-xs font-extrabold text-ink md:ml-0" title={t("dl.active", { n: active.length })} aria-label={t("dl.active", { n: active.length })}>
              <Spinner className="h-3.5 w-3.5" />
              {active.length}
            </a>
          ) : null}
        </div>
      </header>

      <main id="main" className="flex-1 pb-24 md:pb-0">
        {!route || !ready ? null : route.name === "discover" ? (
          <Discover onOpenBook={openBook} />
        ) : route.name === "library" ? (
          <Library onOpenBook={openBook} onGoDiscover={() => navigate({ name: "discover" })} />
        ) : route.name === "settings" ? (
          <SettingsView />
        ) : null}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-stall-deep pb-safe md:hidden" aria-label={t("nav.label")}>
        <ul className="mx-auto grid max-w-md grid-cols-3">
          {TABS.map((tab) => (
            <li key={tab.name}>
              <a
                href={formatHash({ name: tab.name })}
                aria-current={current === tab.name ? "page" : undefined}
                className="flex flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-bold text-white/70 aria-[current=page]:text-mustard"
              >
                <Icon name={tab.icon} className="h-6 w-6" />
                {t(tab.label)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {reading ? (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg" role="status">
              <Spinner className="h-8 w-8" />
            </div>
          }
        >
          <Reader key={reading} bookId={reading} onClose={() => (window.history.length > 1 ? window.history.back() : navigate({ name: "library" }))} />
        </Suspense>
      ) : null}

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center bg-stall/90 p-6 backdrop-blur-sm" role="status">
          <div className="rounded-3xl border-4 border-dashed border-white px-10 py-12 text-center text-white">
            <Icon name="upload" className="mx-auto h-14 w-14" />
            <p className="mt-3 font-display text-3xl font-extrabold">{t("drop.title")}</p>
            <p className="font-serif text-xl italic text-white/85">{t("drop.sub")}</p>
          </div>
        </div>
      ) : null}

      {ready && !settings.onboarded ? <Onboarding /> : null}
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
