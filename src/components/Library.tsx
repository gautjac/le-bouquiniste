import { useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { coverPalette } from "../lib/cover";
import { formatPercent } from "../lib/format";
import {
  EMPTY_FILTER, filterBooks, isFiltered, languagesIn, sortBooks, statusOf, type LibraryFilter, type SortKey, type StatusFilter,
} from "../lib/library";
import { useImporter } from "../lib/import-ui";
import { usePersistentState } from "../lib/usePersistentState";
import { addBooksToShelf, createShelf, deleteShelf, removeBooks, renameShelf } from "../lib/ops";
import { confirmDialog } from "../store/confirm";
import { useBooks, useShelves } from "../store/library";
import type { Book, Shelf } from "../types";
import { BookDetail } from "./BookDetail";
import { Cover, Dialog, EmptyState, Icon, ProgressBar } from "./ui";

type View = "grid" | "list" | "spines";
const VIEWS = ["grid", "list", "spines"] as const;
const SORTS: SortKey[] = ["recent", "added", "title", "author", "progress"];
const STATUSES: StatusFilter[] = ["all", "reading", "unread", "finished", "favorite"];

interface Props {
  onOpenBook: (id: string) => void;
  onGoDiscover: () => void;
}

export function Library({ onOpenBook, onGoDiscover }: Props) {
  const { t, tp, lang } = useT();
  const books = useBooks();
  const shelves = useShelves();
  const importFiles = useImporter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [view, setView] = usePersistentState<View>("view", "grid", VIEWS);
  const [sort, setSort] = usePersistentState<SortKey>("sort", "recent", SORTS);
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shelfDialog, setShelfDialog] = useState(false);

  const visible = useMemo(() => (books ? sortBooks(filterBooks(books, filter), sort) : []), [books, filter, sort]);
  const languages = useMemo(() => (books ? languagesIn(books) : []), [books]);
  const hasPdf = useMemo(() => !!books?.some((b) => b.format === "pdf") && !!books?.some((b) => b.format === "epub"), [books]);
  const resume = useMemo(
    () => (books ?? []).filter((b) => b.progress > 0 && !b.finishedAt && b.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0],
    [books],
  );

  const languageName = useMemo(() => {
    const names = new Intl.DisplayNames([lang], { type: "language" });
    return (code: string) => names.of(code) ?? code;
  }, [lang]);

  if (!books) return <div className="mx-auto max-w-6xl px-4 py-10 text-soft sm:px-6">{t("common.loading")}</div>;

  const activeShelf = shelves.find((s) => s.id === filter.shelfId);
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const endSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const activate = (book: Book) => (selecting ? toggleSelected(book.id) : onOpenBook(book.id));

  const removeSelected = async () => {
    const ids = [...selected];
    const ok = await confirmDialog({
      message: tp("select.deleteConfirm", ids.length),
      confirmLabel: t("select.delete"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!ok) return;
    await removeBooks(ids);
    endSelecting();
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6">
      <input
        ref={fileInput}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          void importFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-extrabold leading-none sm:text-5xl">{t("library.title")}</h1>
          <p className="mt-1 font-serif text-xl italic text-soft">{tp("library.count", books.length)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {books.length > 0 ? (
            <button type="button" className="btn-plain" aria-pressed={selecting} onClick={() => (selecting ? endSelecting() : setSelecting(true))}>
              <Icon name={selecting ? "x" : "check"} className="h-4 w-4" />
              {selecting ? t("select.done") : t("select.mode")}
            </button>
          ) : null}
          <button type="button" className="btn-green" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" className="h-4 w-4" />
            {t("library.import")}
          </button>
        </div>
      </header>

      {books.length === 0 ? (
        <EmptyState icon="shelves" title={t("library.emptyTitle")} text={t("library.emptyText")}>
          <button type="button" className="btn-primary mt-2" onClick={onGoDiscover}>
            <Icon name="search" className="h-4 w-4" />
            {t("library.emptyCta")}
          </button>
        </EmptyState>
      ) : (
        <>
          {resume && !isFiltered(filter) && !selecting ? <ResumeCard book={resume} onOpen={() => onOpenBook(resume.id)} /> : null}

          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[12rem] flex-1">
                <span className="sr-only">{t("library.search")}</span>
                <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
                <input
                  type="search"
                  className="field !py-2 !pl-10"
                  placeholder={t("library.search")}
                  value={filter.text}
                  onChange={(e) => setFilter({ ...filter, text: e.target.value })}
                />
              </label>

              <label className="flex items-center gap-2 text-sm font-semibold">
                <span className="sr-only sm:not-sr-only">{t("sort.label")}</span>
                <select className="field !w-auto !py-2" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORTS.map((s) => (
                    <option key={s} value={s}>
                      {t(`sort.${s}` as const)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex overflow-hidden rounded-full border-2 border-ink bg-surface" role="group" aria-label={t("view.label")}>
                {VIEWS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="px-3 py-2 transition hover:bg-mustard/30 aria-pressed:bg-ink aria-pressed:text-bg"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    title={t(`view.${v}` as const)}
                  >
                    <Icon name={v === "grid" ? "grid" : v === "list" ? "list" : "spines"} className="h-4 w-4" />
                    <span className="sr-only">{t(`view.${v}` as const)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {STATUSES.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={filter.status === s} onClick={() => setFilter({ ...filter, status: s })}>
                  {s === "favorite" ? <Icon name="star" className="h-3.5 w-3.5" filled={filter.status === s} /> : null}
                  {t(`status.${s}` as const)}
                </button>
              ))}
              {languages.length > 1 ? (
                <select
                  className="field !w-auto !rounded-full !py-1 text-sm font-semibold"
                  value={filter.language ?? ""}
                  onChange={(e) => setFilter({ ...filter, language: e.target.value || undefined })}
                  aria-label={t("detail.language")}
                >
                  <option value="">{t("discover.anyLang")}</option>
                  {languages.map((code) => (
                    <option key={code} value={code}>
                      {languageName(code)}
                    </option>
                  ))}
                </select>
              ) : null}
              {hasPdf ? (
                <select
                  className="field !w-auto !rounded-full !py-1 text-sm font-semibold"
                  value={filter.format ?? ""}
                  onChange={(e) => setFilter({ ...filter, format: (e.target.value || undefined) as Book["format"] | undefined })}
                  aria-label={t("detail.format")}
                >
                  <option value="">{t("detail.format")}</option>
                  <option value="epub">EPUB</option>
                  <option value="pdf">PDF</option>
                </select>
              ) : null}
            </div>

            <ShelfBar shelves={shelves} activeId={filter.shelfId} onPick={(id) => setFilter({ ...filter, shelfId: id })} activeShelf={activeShelf} />
          </div>

          {visible.length === 0 && filter.shelfId && !filter.text.trim() && filter.status === "all" && !filter.format && !filter.language ? (
            <EmptyState icon="shelves" title={t("library.shelfEmpty")} text={t("library.shelfEmptyHint")} />
          ) : visible.length === 0 ? (
            <EmptyState icon="search" title={t("library.noMatch")}>
              <button type="button" className="btn-plain" onClick={() => setFilter(EMPTY_FILTER)}>
                {t("library.clearFilters")}
              </button>
            </EmptyState>
          ) : view === "grid" ? (
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {visible.map((book) => (
                <li key={book.id}>
                  <GridCard book={book} selecting={selecting} selected={selected.has(book.id)} onActivate={() => activate(book)} onDetail={() => setDetailId(book.id)} />
                </li>
              ))}
            </ul>
          ) : view === "list" ? (
            <ul className="mt-6 divide-y-2 divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-surface shadow-stamp">
              {visible.map((book) => (
                <li key={book.id}>
                  <ListRow book={book} shelves={shelves} selecting={selecting} selected={selected.has(book.id)} onActivate={() => activate(book)} onDetail={() => setDetailId(book.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <Spines books={visible} selecting={selecting} selected={selected} onActivate={activate} />
          )}
        </>
      )}

      {selecting ? (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
          <div className="flex flex-wrap items-center gap-2 rounded-full border-2 border-ink bg-surface px-4 py-2 shadow-stamp-lg">
            <span className="text-sm font-bold">{tp("select.count", selected.size)}</span>
            <button type="button" className="btn-ghost !py-1" onClick={() => setSelected(new Set(visible.map((b) => b.id)))}>
              {t("select.all")}
            </button>
            <button type="button" className="btn-ghost !py-1" disabled={!selected.size} onClick={() => setShelfDialog(true)}>
              <Icon name="shelves" className="h-4 w-4" />
              {t("select.toShelf")}
            </button>
            <button type="button" className="btn-ghost !py-1 text-tomato" disabled={!selected.size} onClick={removeSelected}>
              <Icon name="trash" className="h-4 w-4" />
              {t("select.delete")}
            </button>
          </div>
        </div>
      ) : null}

      <ShelfPicker open={shelfDialog} shelves={shelves} onClose={() => setShelfDialog(false)} onPick={async (shelfId) => {
        await addBooksToShelf([...selected], shelfId);
        setShelfDialog(false);
        endSelecting();
      }} />

      <BookDetail bookId={detailId} onClose={() => setDetailId(null)} onOpenBook={(id) => (setDetailId(null), onOpenBook(id))} />
    </div>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

function ResumeCard({ book, onOpen }: { book: Book; onOpen: () => void }) {
  const { t } = useT();
  return (
    <section className="mt-6 overflow-hidden rounded-3xl border-2 border-ink bg-mustard shadow-stamp-lg" aria-label={t("library.continue")}>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-white/20 sm:gap-6 sm:p-5">
        <div className="w-20 shrink-0 overflow-hidden rounded-md border-2 border-ink shadow-stamp-sm sm:w-24">
          <Cover title={book.title} author={book.author} src={book.cover} eager />
        </div>
        <div className="min-w-0 flex-1 text-ink">
          <p className="text-xs font-extrabold uppercase tracking-widest">{t("library.continue")}</p>
          <p className="mt-1 line-clamp-2 font-display text-xl font-extrabold leading-tight sm:text-2xl">{book.title}</p>
          <p className="line-clamp-1 font-serif text-lg italic">{book.author}</p>
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar value={book.progress} className="max-w-xs flex-1 !bg-ink/25" />
            <span className="text-sm font-bold">{formatPercent(book.progress)}</span>
          </div>
        </div>
        <span className="btn-primary hidden shrink-0 sm:inline-flex">
          <Icon name="book" className="h-4 w-4" />
          {t("card.continue")}
        </span>
      </button>
    </section>
  );
}

function ShelfBar({ shelves, activeId, activeShelf, onPick }: { shelves: Shelf[]; activeId?: string; activeShelf?: Shelf; onPick: (id: string | undefined) => void }) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const submitNew = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setAdding(false);
    const shelf = await createShelf(name);
    setName("");
    setAdding(false);
    onPick(shelf.id);
  };

  const submitRename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (activeShelf) await renameShelf(activeShelf.id, name);
    setRenaming(false);
  };

  const removeShelf = async () => {
    if (!activeShelf) return;
    const ok = await confirmDialog({
      message: t("shelf.deleteConfirm", { name: activeShelf.name }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!ok) return;
    onPick(undefined);
    await deleteShelf(activeShelf.id);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("detail.shelves")}>
      <button type="button" className="chip" aria-pressed={!activeId} onClick={() => onPick(undefined)}>
        <Icon name="shelves" className="h-3.5 w-3.5" />
        {t("shelf.all")}
      </button>
      {shelves.map((shelf) => (
        <button key={shelf.id} type="button" className="chip" aria-pressed={activeId === shelf.id} onClick={() => onPick(activeId === shelf.id ? undefined : shelf.id)}>
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/60" style={{ background: shelf.color }} />
          {shelf.name}
        </button>
      ))}

      {adding ? (
        <form onSubmit={submitNew} className="flex gap-1.5">
          <input autoFocus className="field !w-44 !py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("shelf.namePlaceholder")} maxLength={40} onBlur={() => !name && setAdding(false)} />
          <button type="submit" className="btn-green !px-3 !py-1 text-xs">
            {t("shelf.create")}
          </button>
        </form>
      ) : renaming && activeShelf ? (
        <form onSubmit={submitRename} className="flex gap-1.5">
          <input autoFocus className="field !w-44 !py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <button type="submit" className="btn-green !px-3 !py-1 text-xs">
            {t("common.save")}
          </button>
        </form>
      ) : (
        <button type="button" className="chip !border-dashed" onClick={() => (setName(""), setAdding(true))}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          {t("shelf.new")}
        </button>
      )}

      {activeShelf && !renaming && !adding ? (
        <span className="ml-1 flex gap-1">
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => (setName(activeShelf.name), setRenaming(true))} title={t("shelf.rename")}>
            <Icon name="edit" className="h-4 w-4" />
            <span className="sr-only">{t("shelf.rename")}</span>
          </button>
          <button type="button" className="btn-ghost !px-2 !py-1 text-tomato" onClick={removeShelf} title={t("shelf.delete")}>
            <Icon name="trash" className="h-4 w-4" />
            <span className="sr-only">{t("shelf.delete")}</span>
          </button>
        </span>
      ) : null}
    </div>
  );
}

function ShelfPicker({ open, shelves, onClose, onPick }: { open: boolean; shelves: Shelf[]; onClose: () => void; onPick: (id: string) => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onClose={onClose} title={t("shelf.add")}>
      <div className="space-y-4 p-5">
        {shelves.length === 0 ? <p className="text-soft">{t("shelf.none")}</p> : null}
        <div className="flex flex-wrap gap-2">
          {shelves.map((shelf) => (
            <button key={shelf.id} type="button" className="chip" onClick={() => onPick(shelf.id)}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: shelf.color }} />
              {shelf.name}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const shelf = await createShelf(name);
            setName("");
            onPick(shelf.id);
          }}
        >
          <input className="field !py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("shelf.namePlaceholder")} maxLength={40} data-autofocus />
          <button type="submit" className="btn-green" disabled={!name.trim()}>
            {t("shelf.create")}
          </button>
        </form>
      </div>
    </Dialog>
  );
}

interface CardProps {
  book: Book;
  selecting: boolean;
  selected: boolean;
  onActivate: () => void;
  onDetail: () => void;
}

function GridCard({ book, selecting, selected, onActivate, onDetail }: CardProps) {
  const { t } = useT();
  const status = statusOf(book);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onActivate}
        className={`relative block w-full overflow-hidden rounded-md border-2 text-left shadow-stamp transition group-hover:-translate-y-1 group-hover:shadow-stamp-lg ${selected ? "border-tomato ring-4 ring-tomato/40" : "border-ink"}`}
        aria-label={selecting ? t("card.select", { title: book.title }) : book.title}
        aria-pressed={selecting ? selected : undefined}
      >
        <Cover title={book.title} author={book.author} src={book.cover} />
        {book.progress > 0 && status !== "finished" ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6">
            <ProgressBar value={book.progress} className="!bg-white/40" />
          </div>
        ) : null}
      </button>

      {selecting ? (
        <span className={`pointer-events-none absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink ${selected ? "bg-tomato text-white" : "bg-surface"}`}>
          {selected ? <Icon name="check" className="h-4 w-4" /> : null}
        </span>
      ) : null}

      <div className="pointer-events-none absolute -right-1.5 -top-1.5 flex flex-col gap-1">
        {book.favorite ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-mustard shadow-stamp-sm" title={t("status.favorite")}>
            <Icon name="star" className="h-4 w-4" filled />
          </span>
        ) : null}
        {status === "finished" ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-stall text-white shadow-stamp-sm" title={t("card.finished")}>
            <Icon name="check" className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      {book.format === "pdf" ? <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-bg">PDF</span> : null}

      <div className="mt-2.5 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-display text-[0.95rem] font-bold leading-snug" title={book.title}>
            {book.title}
          </p>
          <p className="line-clamp-1 font-serif text-base italic text-soft">{book.author || t("book.unknownAuthor")}</p>
        </div>
        <button type="button" className="-mr-1.5 shrink-0 rounded-full p-1.5 text-soft hover:bg-ink/10 hover:text-ink" onClick={onDetail} aria-label={t("common.more")}>
          <Icon name="more" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function ListRow({ book, shelves, selecting, selected, onActivate, onDetail }: CardProps & { shelves: Shelf[] }) {
  const { t } = useT();
  const status = statusOf(book);
  const bookShelves = shelves.filter((s) => book.shelfIds.includes(s.id));
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 transition hover:bg-mustard/15 ${selected ? "bg-tomato/10" : ""}`}>
      {selecting ? (
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink ${selected ? "bg-tomato text-white" : "bg-surface"}`}>
          {selected ? <Icon name="check" className="h-4 w-4" /> : null}
        </span>
      ) : null}
      <button type="button" onClick={onActivate} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-pressed={selecting ? selected : undefined}>
        <div className="w-10 shrink-0 overflow-hidden rounded border-2 border-ink">
          <Cover title={book.title} author={book.author} src={book.cover} />
        </div>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 font-display font-bold">{book.title}</span>
          <span className="line-clamp-1 font-serif italic text-soft">{book.author || t("book.unknownAuthor")}</span>
        </span>
        <span className="hidden w-32 shrink-0 sm:block">
          {status === "finished" ? (
            <span className="text-xs font-bold uppercase tracking-wide text-stall">{t("card.finished")}</span>
          ) : book.progress > 0 ? (
            <>
              <ProgressBar value={book.progress} />
              <span className="text-xs text-soft">{formatPercent(book.progress)}</span>
            </>
          ) : null}
        </span>
        <span className="hidden gap-1 md:flex">
          {bookShelves.map((s) => (
            <span key={s.id} className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} title={s.name} />
          ))}
        </span>
        {book.favorite ? <Icon name="star" className="h-4 w-4 shrink-0 text-mustard" filled /> : null}
      </button>
      <button type="button" className="shrink-0 rounded-full p-2 text-soft hover:bg-ink/10 hover:text-ink" onClick={onDetail} aria-label={t("common.more")}>
        <Icon name="more" className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Books standing on a plank. Height follows file size, a ribbon at the foot shows progress. */
function Spines({ books, selecting, selected, onActivate }: { books: Book[]; selecting: boolean; selected: Set<string>; onActivate: (book: Book) => void }) {
  const { t } = useT();
  const sizes = books.map((b) => b.size);
  const max = Math.max(...sizes, 1);
  const min = Math.min(...sizes, max);
  return (
    <div className="mt-8 rounded-2xl border-2 border-ink bg-stall-deep/95 px-3 pb-3 pt-6 shadow-stamp" role="list">
      <div className="flex flex-wrap items-end gap-y-4">
        {books.map((book) => {
          const palette = coverPalette(`${book.title}|${book.author}`);
          const spread = max === min ? 0.5 : (Math.log(book.size) - Math.log(min)) / (Math.log(max) - Math.log(min));
          const height = 150 + Math.round(spread * 90);
          const width = Math.min(64, Math.max(34, 26 + Math.round(book.title.length * 0.7)));
          const isSelected = selected.has(book.id);
          return (
            <button
              key={book.id}
              type="button"
              role="listitem"
              onClick={() => onActivate(book)}
              title={`${book.title} — ${book.author}`}
              aria-label={selecting ? t("card.select", { title: book.title }) : book.title}
              aria-pressed={selecting ? isSelected : undefined}
              className={`group relative -mb-px flex shrink-0 flex-col items-center justify-between overflow-hidden rounded-t-[3px] border-x border-t border-black/50 px-1 py-2 text-center transition-transform hover:-translate-y-2 focus-visible:-translate-y-2 ${isSelected ? "-translate-y-3 ring-4 ring-tomato" : ""}`}
              style={{ width, height, background: palette.bg, color: palette.fg, boxShadow: "inset -4px 0 6px rgba(0,0,0,.18), inset 3px 0 4px rgba(255,255,255,.12)" }}
            >
              <span className="h-1 w-5/6 rounded-full" style={{ background: palette.accent }} />
              <span className="line-clamp-none max-h-[78%] overflow-hidden font-display text-[13px] font-bold leading-tight" style={{ writingMode: "vertical-rl" }}>
                {book.title}
              </span>
              <span className="block w-full" style={{ height: 10 }}>
                {book.progress > 0 ? <span className="block h-full rounded-sm" style={{ background: palette.accent, width: `${Math.max(book.progress, 0.12) * 100}%`, marginInline: "auto" }} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="h-3 rounded-sm bg-[#6b4b2a] shadow-[0_6px_0_#3d2a15,0_10px_14px_rgba(0,0,0,.4)]" aria-hidden="true" />
    </div>
  );
}
