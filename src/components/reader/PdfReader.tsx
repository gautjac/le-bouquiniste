import { useEffect, useMemo } from "react";
import { useT } from "../../i18n";
import { setFinished } from "../../lib/ops";
import type { Book } from "../../types";
import { Icon } from "../ui";

/**
 * PDFs are shown in the browser's own viewer: it knows the document's layout far better
 * than we could, and it's the part of a PDF reader nobody wants reinvented. We can't see
 * its page position, so progress is manual ("mark as finished").
 */
export function PdfReader({ book, data, onClose }: { book: Book; data: ArrayBuffer; onClose: () => void }) {
  const { t } = useT();
  const url = useMemo(() => URL.createObjectURL(new Blob([data], { type: "application/pdf" })), [data]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg text-ink" data-reader>
      <header className="flex items-center gap-1 border-b-2 border-ink bg-surface px-2 pt-safe">
        <button type="button" className="btn-ghost !px-2.5" onClick={onClose} aria-label={t("reader.back")}>
          <Icon name="arrowLeft" />
        </button>
        <div className="min-w-0 flex-1 px-1 py-2.5">
          <p className="truncate font-display text-sm font-bold leading-tight">{book.title}</p>
          <p className="truncate text-xs leading-tight text-soft">{t("reader.pdfNote")}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => void setFinished(book.id, !book.finishedAt)}>
          <Icon name="check" className="h-4 w-4" />
          <span className="max-sm:sr-only">{book.finishedAt ? t("detail.markUnread") : t("detail.markFinished")}</span>
        </button>
        <a className="btn-plain !py-1.5" href={url} target="_blank" rel="noopener">
          <Icon name="external" className="h-4 w-4" />
          <span className="max-sm:sr-only">{t("reader.pdfOpen")}</span>
        </a>
      </header>
      <iframe src={url} title={book.title} className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}
