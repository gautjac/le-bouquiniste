/** A filename that is safe on every OS: no path separators or reserved characters. */
export function safeFilename(name: string, extension: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\.{2,}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120)
    .trim();
  return `${cleaned || "livre"}.${extension}`;
}
