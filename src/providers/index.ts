import { archive } from "./archive";
import { gutenberg } from "./gutenberg";
import { standardEbooks } from "./standardebooks";
import type { Provider, SourceId } from "./types";

export * from "./types";

/** Display order: highest-quality editions first. */
export const PROVIDERS: Provider[] = [standardEbooks, gutenberg, archive];

export const PROVIDER_BY_ID: Record<SourceId, Provider> = {
  standardebooks: standardEbooks,
  gutenberg,
  archive,
};

export interface SourceMeta {
  short: string;
  /** Tailwind classes for the little source badge. */
  badge: string;
}

export const SOURCE_META: Record<SourceId, SourceMeta> = {
  standardebooks: { short: "Standard Ebooks", badge: "bg-seine/15 text-seine border-seine/50" },
  gutenberg: { short: "Gutenberg", badge: "bg-stall/15 text-stall border-stall/50" },
  archive: { short: "Internet Archive", badge: "bg-mustard/30 text-ink border-mustard" },
};
