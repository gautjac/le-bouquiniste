import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { exportLibrary, restoreLibrary } from "../lib/backup";
import { formatBytes } from "../lib/format";
import { SourceError } from "../lib/net";
import { librarySummary } from "../lib/ops";
import { PROVIDERS, SOURCE_META } from "../providers";
import { useSettings } from "../store/settings";
import { toast } from "../store/toast";
import type { Lang, Settings } from "../types";
import { Icon, Spinner } from "./ui";

export function SettingsView() {
  const { t, tp, lang } = useT();
  const { settings, update } = useSettings();
  const summary = useLiveQuery(() => librarySummary(), []);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number }>({});
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<{ kind: "export" | "restore"; done: number; total: number } | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void navigator.storage?.estimate?.().then(setEstimate).catch(() => undefined);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, [summary?.count]);

  const askPersistence = async () => {
    try {
      const granted = (await navigator.storage?.persist?.()) ?? false;
      setPersisted(granted);
      if (!granted) toast("info", t("settings.persistDenied"), undefined, 9000);
    } catch {
      toast("info", t("settings.persistDenied"), undefined, 9000);
    }
  };

  const doExport = async () => {
    if (!summary?.count) return toast("info", t("settings.backupEmpty"));
    setBusy({ kind: "export", done: 0, total: summary.count });
    try {
      const blob = await exportLibrary((done, total) => setBusy({ kind: "export", done, total }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `le-bouquiniste-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast("success", t("settings.backupDone"));
    } catch {
      toast("error", t("dl.error.unknown"));
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async (file: File) => {
    setBusy({ kind: "restore", done: 0, total: 1 });
    try {
      const result = await restoreLibrary(file, (done, total) => setBusy({ kind: "restore", done, total }));
      toast("success", t("settings.backupRestored", { added: result.added, skipped: result.skipped }), undefined, 8000);
    } catch (error) {
      toast("error", error instanceof SourceError ? t("settings.backupInvalid") : t("dl.error.unknown"));
    } finally {
      setBusy(null);
    }
  };

  const patch = (p: Partial<Pick<Settings, "lang" | "ui">>) => void update(p);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-12 pt-6 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold leading-none sm:text-5xl">{t("settings.title")}</h1>

      <Section title={t("settings.language")} icon="globe">
        <Segmented<Lang> value={settings.lang} onChange={(lang) => patch({ lang })} options={[["fr", "Français"], ["en", "English"]]} />
      </Section>

      <Section title={t("settings.appearance")} icon="sun">
        <Segmented<Settings["ui"]>
          value={settings.ui}
          onChange={(ui) => patch({ ui })}
          options={[["auto", t("ui.auto")], ["light", t("ui.light")], ["dark", t("ui.dark")]]}
        />
      </Section>

      <Section title={t("settings.storage")} icon="hardDrive">
        <p className="font-display text-xl font-bold">{summary ? tp("settings.storageBooks", summary.count, { size: formatBytes(summary.bytes, lang) }) : t("common.loading")}</p>
        {estimate.quota ? <p className="mt-1 text-sm text-soft">{t("settings.storageQuota", { quota: formatBytes(estimate.quota, lang), used: formatBytes(estimate.usage ?? 0, lang) })}</p> : null}
        <div className={`mt-3 flex items-start gap-3 rounded-2xl border-2 p-3 text-sm ${persisted ? "border-stall/60 bg-stall/10" : "border-mustard bg-mustard/20"}`}>
          <Icon name={persisted ? "lock" : "alert"} className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <p>{persisted ? t("settings.persistYes") : t("settings.persistNo")}</p>
            {persisted === false ? (
              <button type="button" className="btn-plain mt-2 !py-1 text-xs" onClick={askPersistence}>
                {t("settings.persistAsk")}
              </button>
            ) : null}
          </div>
        </div>
      </Section>

      <Section title={t("settings.backup")} icon="download">
        <p className="text-sm text-soft">{t("settings.backupText")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-green" onClick={doExport} disabled={!!busy}>
            <Icon name="download" className="h-4 w-4" />
            {t("settings.backupExport")}
          </button>
          <button type="button" className="btn-plain" onClick={() => restoreInput.current?.click()} disabled={!!busy}>
            <Icon name="upload" className="h-4 w-4" />
            {t("settings.backupImport")}
          </button>
          <input
            ref={restoreInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void doRestore(file);
            }}
          />
          {busy ? (
            <span className="flex items-center gap-2 text-sm font-semibold" role="status">
              <Spinner className="h-4 w-4" />
              {t(busy.kind === "export" ? "settings.backupExporting" : "settings.backupRestoring", { done: busy.done, total: busy.total })}
            </span>
          ) : null}
        </div>
      </Section>

      <Section title={t("settings.sources")} icon="book">
        <ul className="space-y-3">
          {PROVIDERS.map((p) => (
            <li key={p.id} className="flex gap-3">
              <span className={`mt-0.5 h-fit shrink-0 rounded-full border-2 px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide ${SOURCE_META[p.id].badge}`}>{p.label}</span>
              <span className="text-sm text-ink/85">{t(`source.${p.id}` as const)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("settings.about")} icon="info">
        <p className="text-sm leading-relaxed text-ink/90">{t("settings.aboutText")}</p>
        <button type="button" className="btn-ghost mt-3 !px-0" onClick={() => void update({ onboarded: false })}>
          <Icon name="refresh" className="h-4 w-4" />
          {t("settings.replay")}
        </button>
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: "globe" | "sun" | "hardDrive" | "download" | "book" | "info"; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold">
        <Icon name={icon} className="h-5 w-5 text-tomato" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border-2 border-ink bg-bg" role="group">
      {options.map(([id, label]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className="px-4 py-2 text-sm font-semibold transition hover:bg-mustard/30 aria-pressed:bg-ink aria-pressed:text-bg">
          {label}
        </button>
      ))}
    </div>
  );
}
