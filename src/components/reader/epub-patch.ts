import { Contents } from "epubjs";

/**
 * epub.js sizes a chapter by asking a DOM Range how wide its text is. Standard Ebooks (and
 * many other publishers) hide accessibility-only headings with `position:absolute; left:-999em`.
 * A Range includes those, so its width balloons (we measured 27,941px for a page that is
 * really 1,567px wide) and the reader reports dozens of phantom, blank pages.
 *
 * The body's own scroll extent ignores off-screen elements, so it's the honest upper bound:
 * whenever the Range claims more than the body can scroll, trust the body.
 */
export function clampTextWidth(measured: number, bodyScrollWidth: number | undefined): number {
  if (!bodyScrollWidth || bodyScrollWidth <= 0) return measured;
  return measured > bodyScrollWidth ? Math.round(bodyScrollWidth) : measured;
}

let applied = false;

export function patchEpubMeasurement(): void {
  if (applied) return;
  applied = true;
  const proto = Contents.prototype as unknown as { textWidth: () => number; document?: Document };
  const original = proto.textWidth;
  proto.textWidth = function (this: { document?: Document }) {
    const measured = original.call(this as never);
    return clampTextWidth(measured, this.document?.body?.scrollWidth);
  };
}
