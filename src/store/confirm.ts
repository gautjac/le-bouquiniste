import { useSyncExternalStore } from "react";

export interface ConfirmRequest {
  id: number;
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

let current: ConfirmRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Promise-based replacement for window.confirm, rendered by <ConfirmHost/>. */
export function confirmDialog(options: {
  message: string;
  title?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    // A newer request supersedes (declines) one that is still open.
    current?.resolve(false);
    current = { id: nextId++, danger: false, ...options, resolve };
    emit();
  });
}

export function settleConfirm(ok: boolean): void {
  const request = current;
  current = null;
  emit();
  request?.resolve(ok);
}

export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
