import { useEffect, useState } from "react";
import { db } from "../db";
import { useT } from "../i18n";
import { getFile, touchOpened } from "../lib/ops";
import type { Book } from "../types";
import { EmptyState, Spinner } from "./ui";
import { EpubReader } from "./reader/EpubReader";
import { PdfReader } from "./reader/PdfReader";

type Loaded = { book: Book; data: ArrayBuffer } | "missing" | null;

/** Loads a book and its bytes once, then hands a frozen snapshot to the right reader. */
export function Reader({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const { t } = useT();
  const [loaded, setLoaded] = useState<Loaded>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(null);
    (async () => {
      const [book, file] = await Promise.all([db.books.get(bookId), getFile(bookId)]);
      if (!alive) return;
      if (!book || !file) return setLoaded("missing");
      void touchOpened(bookId);
      setLoaded({ book, data: file.data });
    })().catch(() => alive && setLoaded("missing"));
    return () => {
      alive = false;
    };
  }, [bookId]);

  if (loaded === null) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-bg" role="status">
        <Spinner className="h-8 w-8" />
        <p className="font-serif text-xl italic text-soft">{t("reader.loading")}</p>
      </div>
    );
  }

  if (loaded === "missing") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-bg">
        <EmptyState icon="alert" title={t("reader.error")} text={t("reader.errorHint")}>
          <button type="button" className="btn-plain" onClick={onClose}>
            {t("reader.back")}
          </button>
        </EmptyState>
      </div>
    );
  }

  return loaded.book.format === "pdf" ? (
    <PdfReader book={loaded.book} data={loaded.data} onClose={onClose} />
  ) : (
    <EpubReader book={loaded.book} data={loaded.data} onClose={onClose} />
  );
}
