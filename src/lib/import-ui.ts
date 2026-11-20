import { useCallback } from "react";
import { useT, type Translator } from "../i18n";
import { toast } from "../store/toast";
import { importFiles, type ImportOutcome } from "./ingest";

/** Turns import outcomes into the toasts the user sees (one summary + at most 3 problems). */
export function reportImport(outcomes: ImportOutcome[], { t, tp }: Translator): void {
  const added = outcomes.filter((o) => o.ok && !o.duplicate).length;
  const dupes = outcomes.filter((o) => o.ok && o.duplicate).length;
  if (added) toast("success", tp("import.added", added) + (dupes ? ` ${tp("import.dupes", dupes)}` : ""));
  else if (dupes) toast("info", tp("import.dupes", dupes));

  const problems = outcomes.filter((o): o is Extract<ImportOutcome, { ok: false }> => !o.ok);
  for (const problem of problems.slice(0, 3)) {
    const key =
      problem.kind === "drm" ? "import.drm" : problem.kind === "unsupported" ? "import.unsupported" : problem.kind === "invalid" ? "import.invalid" : "import.failed";
    toast("error", t(key, { name: problem.name }), undefined, 8000);
  }
  if (problems.length > 3) toast("error", `+${problems.length - 3}`, undefined, 8000);
}

export function useImporter(): (files: File[]) => Promise<void> {
  const translator = useT();
  return useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      reportImport(await importFiles(files), translator);
    },
    [translator],
  );
}
