import { notionSource } from "./notion";
import { driveSource } from "./drive";
import { pipedriveSource } from "./pipedrive";
import { mailSource } from "./mail";
import { chatgptSource, claudeSource } from "./ai";
import type { SourceDef, SourceId, SourceKey } from "./types";

export const SOURCES: Record<SourceKey, SourceDef> = {
  notion: notionSource,
  drive: driveSource,
  pipedrive: pipedriveSource,
  mail: mailSource,
  chatgpt: chatgptSource,
  claude: claudeSource,
};

/** Ordre des barres (Alt+1 … Alt+7). */
export const BAR_ORDER: SourceId[] = ["all", "notion", "drive", "pipedrive", "mail", "chatgpt", "claude"];

/** Ordre des groupes dans « Partout ». */
export const ALL_ORDER: SourceKey[] = ["pipedrive", "notion", "drive", "mail", "claude", "chatgpt"];

export function sourceLabel(id: SourceId): string {
  return id === "all" ? "Partout" : SOURCES[id].label;
}

export function sourceDef(id: SourceId): SourceDef | null {
  return id === "all" ? null : SOURCES[id];
}
