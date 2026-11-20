import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { removeAnnotation, updateAnnotation } from "../../lib/ops";
import type { Annotation, HighlightColor, ReaderFont, ReaderPrefs, ReaderTheme } from "../../types";
import { Dialog, Icon, Spinner } from "../ui";
import type { SearchHit } from "./epub-search";
import { clampFontSize, FONT_SIZE_RANGE, HIGHLIGHT_COLORS, LINE_HEIGHT_RANGE, THEME_COLORS } from "./themes";
import type { FlatTocItem } from "./toc";

export type PanelTab = "toc" | "search" | "notes";

/* ───────────────────────── contents / search / notes drawer ───────────────────────── */

interface ContentsPanelProps {
  tab: PanelTab | null;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  toc: FlatTocItem[];
  currentChapterId?: string;
  onGoto: (target: string) => void;
  search: { query: string; hits: SearchHit[]; searching: boolean; truncated: boolean; chapterOf: (hit: SearchHit) => string | undefined };
  onSearch: (query: string) => void;
  annotations: Annotation[];
  onDeleteAnnotation: (id: string) => void;
  onExport: () => void;
}

const TABS: { id: PanelTab; icon: "list" | "search" | "bookmark"; label: "reader.toc" | "reader.search" | "reader.notes" }[] = [
  { id: "toc", icon: "list", label: "reader.toc" },
  { id: "search", icon: "search", label: "reader.search" },
  { id: "notes", icon: "bookmark", label: "reader.notes" },
];

export function ContentsPanel({ tab, onTab, onClose, toc, currentChapterId, onGoto, search, onSearch, annotations, onDeleteAnnotation, onExport }: ContentsPanelProps) {
  const { t, tp } = useT();
  const [draft, setDraft] = useState(search.query);
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (tab === "toc") currentRef.current?.scrollIntoView({ block: "center" });
  }, [tab]);

  if (!tab) return null;
  const bookmarks = annotations.filter((a) => a.kind === "bookmark");
  const highlights = annotations.filter((a) => a.kind === "highlight");

  return (
    <Dialog open onClose={onClose} title={t(TABS.find((x) => x.id === tab)?.label ?? "reader.toc")} variant="drawer">
      <div className="flex border-b-2 border-ink/10" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => onTab(item.id)}
            className="flex flex-1 items-center justify-center gap-2 border-b-4 border-transparent px-3 py-3 text-sm font-bold transition hover:bg-mustard/20 aria-selected:border-tomato"
          >
            <Icon name={item.icon} className="h-4 w-4" />
            <span>{t(`reader.tab.${item.id}` as const)}</span>
          </button>
        ))}
      </div>

      {tab === "toc" ? (
        toc.length ? (
          <ul className="py-2">
            {toc.map((item) => {
              const current = item.id === currentChapterId;
              return (
                <li key={`${item.id}-${item.href}`}>
                  <button
                    ref={current ? currentRef : undefined}
                    type="button"
                    onClick={() => onGoto(item.href)}
                    aria-current={current ? "true" : undefined}
                    className="flex w-full items-baseline gap-2 px-5 py-2 text-left transition hover:bg-mustard/20 aria-[current=true]:bg-mustard/30 aria-[current=true]:font-bold"
                    style={{ paddingLeft: `${1.25 + item.depth * 1.1}rem` }}
                  >
                    <span className={item.depth ? "text-sm text-ink/80" : "font-display font-semibold"}>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-5 text-soft">{t("reader.noToc")}</p>
        )
      ) : null}

      {tab === "search" ? (
        <div className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSearch(draft);
            }}
            className="flex gap-2"
          >
            <input
              data-autofocus
              type="search"
              className="field !py-2"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("reader.searchPlaceholder")}
            />
            <button type="submit" className="btn-green" aria-label={t("reader.search")}>
              <Icon name="search" className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-3 text-sm text-soft" aria-live="polite">
            {search.searching ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="h-4 w-4" />
                {t("reader.searching")}
              </span>
            ) : search.query && search.hits.length === 0 ? (
              t("reader.noHits")
            ) : search.hits.length ? (
              tp("reader.hits", search.hits.length)
            ) : null}
          </div>

          <ul className="mt-2 space-y-1">
            {search.hits.map((hit) => (
              <li key={hit.cfi}>
                <button type="button" className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-mustard/25" onClick={() => onGoto(hit.cfi)}>
                  <span className="block text-xs font-bold uppercase tracking-wide text-soft">{search.chapterOf(hit) ?? ""}</span>
                  <span className="block text-sm leading-snug">
                    <Highlighted text={hit.excerpt} query={search.query} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {search.truncated ? <p className="mt-3 text-sm text-soft">{t("reader.hitsMore", { n: search.hits.length })}</p> : null}
        </div>
      ) : null}

      {tab === "notes" ? (
        annotations.length === 0 ? (
          <p className="p-5 text-soft">{t("reader.notesEmpty")}</p>
        ) : (
          <div className="p-4">
            <button type="button" className="btn-plain !py-1.5 text-xs" onClick={onExport}>
              <Icon name="copy" className="h-4 w-4" />
              {t("reader.exportNotes")}
            </button>
            {highlights.length ? <NoteGroup title={t("reader.highlights")} items={highlights} onGoto={onGoto} onDelete={onDeleteAnnotation} /> : null}
            {bookmarks.length ? <NoteGroup title={t("reader.bookmarks")} items={bookmarks} onGoto={onGoto} onDelete={onDeleteAnnotation} /> : null}
          </div>
        )
      ) : null}
    </Dialog>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const needle = query.trim();
    if (!needle) return [{ text, hit: false }];
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.split(new RegExp(`(${escaped})`, "ig")).map((part) => ({ text: part, hit: part.toLowerCase() === needle.toLowerCase() }));
  }, [text, query]);
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i} className="rounded bg-mustard/60 px-0.5 text-ink">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function NoteGroup({ title, items, onGoto, onDelete }: { title: string; items: Annotation[]; onGoto: (cfi: string) => void; onDelete: (id: string) => void }) {
  const { t } = useT();
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-soft">{title}</h3>
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="group flex gap-2 rounded-xl border-2 border-ink/15 p-3">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: a.kind === "bookmark" ? "#d64026" : HIGHLIGHT_COLORS[a.color] }} />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onGoto(a.cfi)}>
              {a.chapter ? <span className="block text-xs font-bold uppercase tracking-wide text-soft">{a.chapter}</span> : null}
              {a.text ? <span className="line-clamp-4 font-serif text-base italic leading-snug">« {a.text} »</span> : null}
              {a.note ? <span className="mt-1 block text-sm">{a.note}</span> : null}
            </button>
            <button type="button" className="shrink-0 self-start rounded-full p-1.5 text-soft hover:bg-tomato/10 hover:text-tomato" onClick={() => onDelete(a.id)} aria-label={t("reader.deleteHighlight")}>
              <Icon name="trash" className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────────────────────── reading settings popover ───────────────────────── */

const THEMES: ReaderTheme[] = ["paper", "sepia", "night"];
const FONTS: ReaderFont[] = ["literata", "serif", "sans", "atkinson"];
const MARGINS: ReaderPrefs["margin"][] = ["narrow", "normal", "wide"];
const FLOWS: ReaderPrefs["flow"][] = ["paginated", "scrolled"];

export function SettingsPopover({ prefs, onChange, onClose }: { prefs: ReaderPrefs; onChange: (patch: Partial<ReaderPrefs>) => void; onClose: () => void }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (ref.current && target && !ref.current.contains(target) && !target.closest("[data-settings-toggle]")) onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("reader.settings")}
      className="absolute right-2 top-full z-50 mt-2 max-h-[75dvh] w-[min(22rem,calc(100vw-1rem))] space-y-5 overflow-y-auto rounded-2xl border-2 border-ink bg-surface p-4 text-ink shadow-stamp-lg animate-pop scroll-thin"
    >
      <Group label={t("rs.theme")}>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={prefs.theme === theme}
              onClick={() => onChange({ theme })}
              className="flex flex-col items-center gap-1 rounded-xl border-2 border-ink/30 p-2 text-xs font-bold aria-pressed:border-tomato aria-pressed:ring-2 aria-pressed:ring-tomato/40"
            >
              <span className="flex h-9 w-full items-center justify-center rounded-lg border border-black/10 font-read text-lg" style={{ background: THEME_COLORS[theme].bg, color: THEME_COLORS[theme].fg }}>
                Aa
              </span>
              {t(`theme.${theme}` as const)}
            </button>
          ))}
        </div>
      </Group>

      <Group label={t("rs.size")} value={`${prefs.fontSize} %`}>
        <div className="flex items-center gap-3">
          <button type="button" className="btn-plain !px-3 !py-1" onClick={() => onChange({ fontSize: clampFontSize(prefs.fontSize - FONT_SIZE_RANGE.step) })} disabled={prefs.fontSize <= FONT_SIZE_RANGE.min} aria-label="−">
            <span className="text-xs font-extrabold">A</span>
          </button>
          <input type="range" className="h-2 flex-1 accent-tomato" min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} step={FONT_SIZE_RANGE.step} value={prefs.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} aria-label={t("rs.size")} />
          <button type="button" className="btn-plain !px-3 !py-1" onClick={() => onChange({ fontSize: clampFontSize(prefs.fontSize + FONT_SIZE_RANGE.step) })} disabled={prefs.fontSize >= FONT_SIZE_RANGE.max} aria-label="+">
            <span className="text-lg font-extrabold leading-none">A</span>
          </button>
        </div>
      </Group>

      <Group label={t("rs.font")}>
        <div className="grid grid-cols-2 gap-2">
          {FONTS.map((font) => (
            <button key={font} type="button" aria-pressed={prefs.font === font} onClick={() => onChange({ font })} className="chip justify-center" style={{ fontFamily: font === "sans" ? "system-ui" : font === "atkinson" ? '"Atkinson Hyperlegible"' : font === "literata" ? "Literata" : "Georgia" }}>
              {t(`font.${font}` as const)}
            </button>
          ))}
        </div>
      </Group>

      <Group label={t("rs.spacing")} value={prefs.lineHeight.toFixed(2)}>
        <input type="range" className="h-2 w-full accent-tomato" min={LINE_HEIGHT_RANGE.min} max={LINE_HEIGHT_RANGE.max} step={LINE_HEIGHT_RANGE.step} value={prefs.lineHeight} onChange={(e) => onChange({ lineHeight: Number(e.target.value) })} aria-label={t("rs.spacing")} />
      </Group>

      <Group label={t("rs.margins")}>
        <Segmented options={MARGINS} value={prefs.margin} label={(m) => t(`margin.${m}` as const)} onChange={(margin) => onChange({ margin })} />
      </Group>

      <Group label={t("rs.flow")}>
        <Segmented options={FLOWS} value={prefs.flow} label={(f) => t(`flow.${f}` as const)} onChange={(flow) => onChange({ flow })} />
      </Group>
    </div>
  );
}

function Group({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-soft">{label}</h3>
        {value ? <span className="text-xs font-bold text-soft">{value}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ options, value, label, onChange }: { options: T[]; value: T; label: (o: T) => string; onChange: (o: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded-full border-2 border-ink">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className="flex-1 px-3 py-1.5 text-sm font-semibold transition hover:bg-mustard/30 aria-pressed:bg-ink aria-pressed:text-bg">
          {label(o)}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── selection & highlight popovers ───────────────────────── */

export interface Anchor {
  x: number;
  y: number;
}

function place(anchor: Anchor, width: number, height: number) {
  const margin = 8;
  const left = Math.min(Math.max(anchor.x - width / 2, margin), window.innerWidth - width - margin);
  const above = anchor.y - height - 10;
  const top = above > 60 ? above : anchor.y + 34;
  return { left, top: Math.min(top, window.innerHeight - height - margin) };
}

interface SelectionPopoverProps {
  anchor: Anchor;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onDismiss: () => void;
}

export function SelectionPopover({ anchor, onHighlight, onNote, onCopy, onDismiss }: SelectionPopoverProps) {
  const { t } = useT();
  const pos = place(anchor, 270, 48);
  return (
    <div
      role="toolbar"
      aria-label={t("reader.highlight")}
      className="fixed z-50 flex items-center gap-1.5 rounded-full border-2 border-ink bg-surface px-2 py-1.5 text-ink shadow-stamp animate-pop"
      style={pos}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => (
        <button key={color} type="button" className="h-7 w-7 rounded-full border-2 border-ink/70 transition hover:scale-110" style={{ background: HIGHLIGHT_COLORS[color] }} onClick={() => onHighlight(color)} aria-label={`${t("reader.highlight")} (${color})`} />
      ))}
      <span className="mx-0.5 h-5 w-px bg-ink/20" aria-hidden="true" />
      <button type="button" className="rounded-full p-1.5 hover:bg-ink/10" onClick={onNote} aria-label={t("reader.addNote")} title={t("reader.addNote")}>
        <Icon name="pen" className="h-4 w-4" />
      </button>
      <button type="button" className="rounded-full p-1.5 hover:bg-ink/10" onClick={onCopy} aria-label={t("reader.copy")} title={t("reader.copy")}>
        <Icon name="copy" className="h-4 w-4" />
      </button>
      <button type="button" className="rounded-full p-1.5 hover:bg-ink/10" onClick={onDismiss} aria-label={t("common.close")}>
        <Icon name="x" className="h-4 w-4" />
      </button>
    </div>
  );
}

export function NoteEditor({ annotation, anchor, onClose }: { annotation: Annotation; anchor: Anchor; onClose: () => void }) {
  const { t } = useT();
  const [note, setNote] = useState(annotation.note ?? "");
  const pos = place(anchor, 300, 200);
  const save = async () => {
    await updateAnnotation(annotation.id, { note: note.trim() || undefined });
    onClose();
  };
  return (
    <div className="fixed z-50 w-[300px] space-y-2 rounded-2xl border-2 border-ink bg-surface p-3 text-ink shadow-stamp animate-pop" style={pos} role="dialog" aria-label={t("reader.addNote")} onPointerDown={(e) => e.stopPropagation()}>
      {annotation.text ? <p className="line-clamp-2 font-serif text-sm italic text-soft">« {annotation.text} »</p> : null}
      <textarea
        autoFocus
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("reader.notePlaceholder")}
        className="field !rounded-xl text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="flex items-center gap-2">
        {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => (
          <button key={color} type="button" aria-pressed={annotation.color === color} className="h-6 w-6 rounded-full border-2 border-ink/50 aria-pressed:border-ink aria-pressed:ring-2 aria-pressed:ring-ink/40" style={{ background: HIGHLIGHT_COLORS[color] }} onClick={() => updateAnnotation(annotation.id, { color })} aria-label={color} />
        ))}
        <button
          type="button"
          className="ml-auto rounded-full p-1.5 text-tomato hover:bg-tomato/10"
          onClick={async () => {
            await removeAnnotation(annotation.id);
            onClose();
          }}
          aria-label={t("reader.deleteHighlight")}
        >
          <Icon name="trash" className="h-4 w-4" />
        </button>
        <button type="button" className="btn-green !px-3 !py-1 text-xs" onClick={save}>
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
