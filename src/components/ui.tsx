import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { coverPalette } from "../lib/cover";
import { useT } from "../i18n";
import { settleConfirm, useConfirmRequest } from "../store/confirm";
import { dismissToast, useToasts } from "../store/toast";

/* ───────────────────────── icons ───────────────────────── */

const ICONS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  book: <><path d="M4 19.5V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 21h14" /></>,
  shelves: <><path d="M5 4v15M10 6v13M15.2 6.2l4.1 12.6" /><path d="M3 21h18" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  download: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />,
  upload: <path d="M12 16V4m0 0L8 8m4-4 4 4M5 20h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.2" /><rect x="13" y="4" width="7" height="7" rx="1.2" /><rect x="4" y="13" width="7" height="7" rx="1.2" /><rect x="13" y="13" width="7" height="7" rx="1.2" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  spines: <><rect x="4" y="5" width="4" height="15" rx="1" /><rect x="10" y="3" width="4" height="17" rx="1" /><path d="m16.2 6.3 3.6-.9 3.2 13-3.6.9z" /></>,
  bookmark: <path d="M7 4h10v16l-5-3.5L7 20z" />,
  pen: <path d="m4 20 1-4L16 5l3 3L8 19zM14 7l3 3" />,
  type: <path d="M3.5 19 8.5 6l5 13M5.5 14.5H11.5M15 19l2.5-6.5L20 19M16 17h3" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  arrowLeft: <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  refresh: <path d="M20 5v5h-5M4 19v-5h5M19 10a7 7 0 0 0-12-3L4 10M5 14a7 7 0 0 0 12 3l3-3" />,
  alert: <path d="M12 4 2.5 20h19zM12 10v4M12 17h.01" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  hardDrive: <><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M3 13l2.5-7a2 2 0 0 1 1.9-1.3h9.2A2 2 0 0 1 18.5 6L21 13M7 16.5h.01M11 16.5h.01" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

const FILLED: IconName[] = ["more"];

export function Icon({ name, className = "h-5 w-5", filled = false }: { name: IconName; className?: string; filled?: boolean }) {
  const solid = filled || FILLED.includes(name);
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={solid ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={solid && name === "more" ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin motion-reduce:animate-none`} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────────────────── covers ───────────────────────── */

interface CoverProps {
  title: string;
  author?: string;
  src?: string;
  eager?: boolean;
  className?: string;
}

/** A book cover: the real image when we have one, otherwise a typographic cover that's stable per book. */
export function Cover({ title, author, src, eager, className = "" }: CoverProps) {
  const [failed, setFailed] = useState(false);
  const [lastSrc, setLastSrc] = useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setFailed(false);
  }
  const palette = coverPalette(`${title}|${author ?? ""}`);

  return (
    <div className={`relative aspect-[2/3] overflow-hidden bg-line ${className}`} style={{ containerType: "inline-size" }}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col justify-between p-[9cqw]" style={{ background: palette.bg, color: palette.fg }}>
          <div className="h-[2.2cqw] w-[22cqw] rounded-full" style={{ background: palette.accent }} />
          <div>
            <p className="line-clamp-5 font-display font-extrabold leading-[1.05]" style={{ fontSize: "clamp(0.7rem, 12cqw, 1.7rem)" }}>
              {title}
            </p>
            {author ? (
              <p className="mt-[4cqw] line-clamp-2 font-serif italic opacity-85" style={{ fontSize: "clamp(0.65rem, 8.5cqw, 1.1rem)" }}>
                {author}
              </p>
            ) : null}
          </div>
          <div className="flex gap-[2cqw]" aria-hidden="true">
            <span className="h-[2.2cqw] w-[2.2cqw] rounded-full" style={{ background: palette.accent }} />
            <span className="h-[2.2cqw] w-[2.2cqw] rounded-full opacity-60" style={{ background: palette.accent }} />
            <span className="h-[2.2cqw] w-[2.2cqw] rounded-full opacity-30" style={{ background: palette.accent }} />
          </div>
        </div>
      )}
      {/* spine shading, for a bit of object-ness */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[5cqw] bg-gradient-to-r from-black/25 to-transparent" aria-hidden="true" />
    </div>
  );
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-ink/15 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <div className="h-full rounded-full bg-tomato transition-[width] duration-300" style={{ width: `${Math.min(Math.max(value, 0), 1) * 100}%` }} />
    </div>
  );
}

/* ───────────────────────── dialog ───────────────────────── */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** `drawer` slides in from the right on wide screens and rises from the bottom on phones. */
  variant?: "modal" | "drawer";
  hideTitle?: boolean;
}

export function Dialog({ open, onClose, title, children, variant = "modal", hideTitle }: DialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const t = useT().t;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const scrollY = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = scrollY;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const drawer = variant === "drawer";
  return (
    <div className={`fixed inset-0 z-50 flex ${drawer ? "items-end justify-end sm:items-stretch" : "items-end justify-center p-0 sm:items-center sm:p-4"}`}>
      <div className="absolute inset-0 bg-ink/55 backdrop-blur-[2px] animate-pop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden border-2 border-ink bg-surface shadow-stamp-lg animate-rise ${
          drawer ? "rounded-t-3xl sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-3xl" : "max-w-lg rounded-t-3xl sm:rounded-3xl"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b-2 border-ink/10 px-5 py-3">
          <h2 id={titleId} className={`font-display text-lg font-bold ${hideTitle ? "sr-only" : ""}`}>
            {title}
          </h2>
          <button type="button" className="btn-ghost -mr-2 ml-auto" onClick={onClose} aria-label={t("common.close")}>
            <Icon name="x" />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── confirm + toasts ───────────────────────── */

export function ConfirmHost() {
  const request = useConfirmRequest();
  const messageId = useId();
  if (!request) return null;
  return (
    <ConfirmDialogBody
      key={request.id}
      messageId={messageId}
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      danger={request.danger}
    />
  );
}

function ConfirmDialogBody(props: {
  messageId: string;
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}) {
  return (
    <Dialog open onClose={() => settleConfirm(false)} title={props.title ?? props.message} hideTitle={!props.title}>
      <div className="space-y-5 p-5">
        <p id={props.messageId} className="text-base leading-relaxed">
          {props.message}
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className="btn-plain" data-autofocus onClick={() => settleConfirm(false)}>
            {props.cancelLabel}
          </button>
          <button type="button" className={props.danger ? "btn-primary" : "btn-green"} onClick={() => settleConfirm(true)}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function Toaster() {
  const toasts = useToasts();
  const t = useT().t;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border-2 border-ink px-4 py-3 text-sm font-semibold shadow-stamp animate-rise ${
            item.kind === "error" ? "bg-tomato text-white" : item.kind === "success" ? "bg-stall text-white" : "bg-surface text-ink"
          }`}
        >
          <span className="min-w-0 flex-1">{item.text}</span>
          {item.action ? (
            <button
              type="button"
              className="shrink-0 rounded-full border-2 border-current px-3 py-1 text-xs font-bold hover:bg-white/20"
              onClick={() => {
                item.action?.run();
                dismissToast(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button type="button" className="shrink-0 opacity-70 hover:opacity-100" onClick={() => dismissToast(item.id)} aria-label={t("common.close")}>
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Centered message with an icon: empty lists, errors, first-run hints. */
export function EmptyState({ icon, title, text, children }: { icon: IconName; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-14 text-center animate-rise">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-ink bg-mustard shadow-stamp-sm">
        <Icon name={icon} className="h-8 w-8 text-ink" />
      </div>
      <h2 className="font-display text-2xl font-extrabold">{title}</h2>
      {text ? <p className="text-soft">{text}</p> : null}
      {children}
    </div>
  );
}
