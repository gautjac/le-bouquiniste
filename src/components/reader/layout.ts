export interface Size {
  width: number;
  height: number;
}

export interface ResizeDecision {
  /** Whether to call rendition.resize(). */
  resize: boolean;
  /** The size to remember for next time (null = keep what we had). */
  remember: Size | null;
}

/**
 * Decides what to do when the reader's container reports a size.
 *
 * epub.js's `resize()` tears down the visible views and re-displays "the current location" —
 * but only if one has been reported. A ResizeObserver always fires once on mount, so calling
 * `resize()` on that first report wipes a page that hasn't located itself yet, and nothing
 * redraws it: a permanently blank book. So:
 *   - the first report only records the size (the rendition was already created at it);
 *   - later reports resize only when the size really changed, and only once a location exists.
 */
export function decideResize(previous: Size | null, current: Size, hasLocation: boolean): ResizeDecision {
  if (current.width <= 0 || current.height <= 0) return { resize: false, remember: null };
  if (!previous) return { resize: false, remember: current };
  const changed = Math.abs(previous.width - current.width) >= 1 || Math.abs(previous.height - current.height) >= 1;
  if (!changed) return { resize: false, remember: null };
  // Remember the new size even when we can't act yet, so it isn't "changed" forever after.
  return { resize: hasLocation, remember: current };
}
