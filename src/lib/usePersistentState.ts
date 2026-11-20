import { useCallback, useState } from "react";

/** useState that survives reloads via localStorage — for per-viewer conveniences only. */
export function usePersistentState<T extends string | boolean>(key: string, initial: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`bouquiniste:${key}`);
      if (raw === null) return initial;
      const parsed = (typeof initial === "boolean" ? raw === "true" : raw) as T;
      return allowed && !allowed.includes(parsed) ? initial : parsed;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(`bouquiniste:${key}`, String(next));
      } catch {
        /* private mode: the choice just won't persist */
      }
    },
    [key],
  );
  return [value, set];
}
