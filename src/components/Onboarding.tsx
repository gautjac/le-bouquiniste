import { useState } from "react";
import { useT } from "../i18n";
import { useSettings } from "../store/settings";
import { Icon, type IconName } from "./ui";

const STEPS: { icon: IconName; title: "onb.1.title" | "onb.2.title" | "onb.3.title"; text: "onb.1.text" | "onb.2.text" | "onb.3.text"; bg: string }[] = [
  { icon: "book", title: "onb.1.title", text: "onb.1.text", bg: "bg-stall text-white" },
  { icon: "download", title: "onb.2.title", text: "onb.2.text", bg: "bg-tomato text-white" },
  { icon: "lock", title: "onb.3.title", text: "onb.3.text", bg: "bg-mustard text-ink" },
];

/** Three light cards, skippable at any point. */
export function Onboarding() {
  const { t } = useT();
  const { update } = useSettings();
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const finish = () => void update({ onboarded: true });

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("app.name")}>
      <div className="w-full max-w-md overflow-hidden rounded-t-3xl border-2 border-ink bg-surface shadow-stamp-lg animate-rise sm:rounded-3xl">
        <div className={`flex h-44 items-center justify-center border-b-2 border-ink ${current.bg} transition-colors`}>
          <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-ink bg-surface text-ink shadow-stamp">
            <Icon name={current.icon} className="h-12 w-12" />
          </div>
        </div>
        <div className="space-y-2 p-6">
          <h2 className="font-display text-3xl font-extrabold leading-tight">{t(current.title)}</h2>
          <p className="font-serif text-xl leading-snug text-ink/85">{t(current.text)}</p>
        </div>
        <div className="flex items-center justify-between gap-3 px-6 pb-6">
          <div className="flex gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-2.5 rounded-full transition-all ${i === step ? "w-7 bg-ink" : "w-2.5 bg-ink/25"}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!last ? (
              <button type="button" className="btn-ghost" onClick={finish}>
                {t("onb.skip")}
              </button>
            ) : null}
            <button type="button" className="btn-primary" onClick={() => (last ? finish() : setStep(step + 1))} data-autofocus autoFocus>
              {last ? t("onb.start") : t("onb.next")}
              <Icon name="chevronRight" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
