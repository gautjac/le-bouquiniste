import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { loadSettings, patchSettings } from "../lib/ops";
import type { Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

type Patch = Parameters<typeof patchSettings>[0];

interface SettingsValue {
  settings: Settings;
  /** False only until IndexedDB has answered the first time. */
  ready: boolean;
  update: (patch: Patch) => Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

/** One live query for the whole app; components read it through useSettings(). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const stored = useLiveQuery(() => loadSettings(), []);
  const update = useCallback(async (patch: Patch) => {
    await patchSettings(patch);
  }, []);
  const value = useMemo<SettingsValue>(
    () => ({ settings: stored ?? DEFAULT_SETTINGS, ready: stored !== undefined, update }),
    [stored, update],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside <SettingsProvider>");
  return value;
}
