import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, type FormEvent } from "react";
import { db } from "../db";
import { useT } from "../i18n";
import { formatBytes, formatPercent, relativeTime } from "../lib/format";
import { safeFilename } from "../lib/filename";
import { statusOf } from "../lib/library";
import { getFile, removeBooks, resetProgress, setBookShelf, setFinished, toggleFavorite, updateBookMeta } from "../lib/ops";
import { SOURCE_META } from "../providers";
import { confirmDialog } from "../store/confirm";
import { useShelves } from "../store/library";
import { toast } from "../store/toast";
import { Cover, Dialog, Icon, ProgressBar } from "./ui";

interface Props {
  bookId: string | null;
  onClose: () => void;
  onOpenBook: (id: string) => void;
}

export function BookDetail({ bookId, onClose, onOpenBook }: Props) {
  const { t, tp, lang } = useT();
  const book = useLiveQuery(() => (bookId ? db.books.get(bookId) : undefined), [bookId]);
  const noteCount = useLiveQuery(() => (bookId ? db.annotations.where("bookId").equals(bookId).count() : 0), [bookId]) ?? 0;
  const shelves = useShelves();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", author: "", language: "", description: "" });

  useEffect(() => {
    setEditing(false);
  }, [bookId]);

  useEffect(() => {
    if (book) setDraft({ title: book.title, author: book.author, language: book.language ?? "", description: book.description ?? "" });
  }, [book, editing]);

  if (!bookId) return null;

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    await updateBookMeta(bookId, draft);
    setEditing(false);
  };

  const remove = async () => {
    if (!book) return;
    const ok = await confirmDialog({
      message: t("detail.removeConfirm", { title: book.title }),
      confirmLabel: t("detail.remove"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!ok) return;
    onClose();
    await removeBooks([book.id]);
  };

  const saveFile = async () => {
    if (!book) return;
    const file = await getFile(book.id);
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.data], { type: file.type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFilename(book.author ? `${book.title} – ${book.author}` : book.title, book.format);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const status = book ? statusOf(book) : "unread";
  const languageName = book?.language ? new Intl.DisplayNames([lang], { type: "language" }).of(book.language) : undefined;

  return (
    <Dialog open onClose={onClose} title={book?.title ?? t("common.loading")} variant="drawer">
      {!book ? (
        <p className="p-5 text-soft">{t("common.loading")}</p>
      ) : (
        <div className="space-y-5 p-5">
          <div className="flex gap-4">
            <div className="w-28 shrink-0 overflow-hidden rounded-md border-2 border-ink shadow-stamp sm:w-32">
              <Cover title={book.title} author={book.author} src={book.cover} eager />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-xl font-extrabold leading-tight">{book.title}</h3>
              <p className="font-serif text-lg italic text-soft">{book.author || t("book.unknownAuthor")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-bold uppercase tracking-wide">
                <span className="rounded-full border-2 border-ink/60 px-2 py-0.5">{book.format}</span>
                {languageName ? <span className="rounded-full border-2 border-ink/60 px-2 py-0.5">{languageName}</span> : null}
                {status === "finished" ? <span className="rounded-full bg-stall px-2 py-0.5 text-white">{t("card.finished")}</span> : null}
              </div>
              {book.progress > 0 ? (
                <div className="mt-3 space-y-1">
                  <ProgressBar value={book.progress} />
                  <p className="text-xs text-soft">
                    {t("detail.progress")} · {formatPercent(book.progress)}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary flex-1" onClick={() => onOpenBook(book.id)}>
              <Icon name="book" className="h-4 w-4" />
              {book.progress > 0 && status !== "finished" ? t("detail.resume") : t("detail.read")}
            </button>
            <button type="button" className="btn-plain" onClick={() => toggleFavorite(book.id)} aria-pressed={!!book.favorite} title={book.favorite ? t("detail.unfavorite") : t("detail.favorite")}>
              <Icon name="star" className="h-4 w-4" filled={!!book.favorite} />
              <span className="sr-only">{book.favorite ? t("detail.unfavorite") : t("detail.favorite")}</span>
            </button>
          </div>

          {shelves.length ? (
            <section aria-labelledby="detail-shelves">
              <h4 id="detail-shelves" className="mb-2 text-xs font-extrabold uppercase tracking-wider text-soft">
                {t("detail.shelves")}
              </h4>
              <div className="flex flex-wrap gap-2">
                {shelves.map((shelf) => {
                  const on = book.shelfIds.includes(shelf.id);
                  return (
                    <button key={shelf.id} type="button" className="chip" aria-pressed={on} onClick={() => setBookShelf(book.id, shelf.id, !on)}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: shelf.color }} />
                      {shelf.name}
                      {on ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {editing ? (
            <form onSubmit={saveEdit} className="space-y-3 rounded-2xl border-2 border-ink/30 p-4">
              <Field label={t("detail.title")} value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} autoFocus />
              <Field label={t("detail.author")} value={draft.author} onChange={(v) => setDraft({ ...draft, author: v })} />
              <Field label={t("detail.language")} value={draft.language} onChange={(v) => setDraft({ ...draft, language: v })} placeholder="fr, en…" />
              <label className="block text-sm font-semibold">
                {t("detail.description")}
                <textarea
                  className="field mt-1 !rounded-2xl"
                  rows={4}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-plain" onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn-green">
                  {t("common.save")}
                </button>
              </div>
            </form>
          ) : (
            <>
              {book.description ? <p className="text-sm leading-relaxed text-ink/85">{book.description}</p> : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {book.source !== "import" ? (
                  <>
                    <dt className="text-soft">{t("detail.source")}</dt>
                    <dd>
                      {book.detailUrl ? (
                        <a className="inline-flex items-center gap-1 font-semibold text-seine underline-offset-2 hover:underline" href={book.detailUrl} target="_blank" rel="noopener noreferrer">
                          {SOURCE_META[book.source].short}
                          <Icon name="external" className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        SOURCE_META[book.source].short
                      )}
                    </dd>
                  </>
                ) : null}
                {book.rights ? (
                  <>
                    <dt className="text-soft">{t("detail.rights")}</dt>
                    <dd>{book.rights}</dd>
                  </>
                ) : null}
                <dt className="text-soft">{t("detail.size")}</dt>
                <dd>{formatBytes(book.size, lang)}</dd>
                <dt className="text-soft">{t("detail.added")}</dt>
                <dd>{relativeTime(book.addedAt, lang)}</dd>
                {noteCount ? (
                  <>
                    <dt className="text-soft">{t("reader.notes")}</dt>
                    <dd>{tp("detail.notes", noteCount)}</dd>
                  </>
                ) : null}
              </dl>
            </>
          )}

          <div className="flex flex-wrap gap-2 border-t-2 border-ink/10 pt-4">
            <button type="button" className="btn-ghost" onClick={() => setEditing((e) => !e)}>
              <Icon name="edit" className="h-4 w-4" />
              {t("detail.edit")}
            </button>
            {status === "finished" ? (
              <button type="button" className="btn-ghost" onClick={() => setFinished(book.id, false)}>
                <Icon name="refresh" className="h-4 w-4" />
                {t("detail.markUnread")}
              </button>
            ) : (
              <button type="button" className="btn-ghost" onClick={() => setFinished(book.id, true)}>
                <Icon name="check" className="h-4 w-4" />
                {t("detail.markFinished")}
              </button>
            )}
            {book.progress > 0 ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  await resetProgress(book.id);
                  toast("info", t("detail.reset"));
                }}
              >
                <Icon name="refresh" className="h-4 w-4" />
                {t("detail.reset")}
              </button>
            ) : null}
            <button type="button" className="btn-ghost" onClick={saveFile}>
              <Icon name="download" className="h-4 w-4" />
              {t("detail.saveFile")}
            </button>
            <button type="button" className="btn-ghost text-tomato" onClick={remove}>
              <Icon name="trash" className="h-4 w-4" />
              {t("detail.remove")}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Field({ label, value, onChange, placeholder, autoFocus }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input className="field mt-1" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-autofocus={autoFocus ? "" : undefined} />
    </label>
  );
}
