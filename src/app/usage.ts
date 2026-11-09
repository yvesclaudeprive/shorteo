import { platform } from "./platform";
import type { ResultItem } from "../sources/types";

/** Mémorise ce que vous ouvrez : les éléments fréquents remontent en tête. */
interface UsageEntry {
  c: number;
  t: number;
  item: ResultItem;
}

let usage: Record<string, UsageEntry> = {};
let timer: number | undefined;

export async function loadUsage(): Promise<void> {
  try {
    const raw = await platform.indexLoad("usage");
    if (raw) usage = JSON.parse(raw) ?? {};
  } catch {
    usage = {};
  }
}

function save() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void platform.indexSave("usage", JSON.stringify(usage)).catch(() => {});
  }, 800);
}

export function recordUsage(item: ResultItem): void {
  if (item.action && item.action !== "open") return;
  const key = `${item.source}:${item.id}`;
  const prev = usage[key];
  const { score: _s, live: _l, text: _t, ...rest } = item;
  usage[key] = { c: (prev?.c ?? 0) + 1, t: Date.now(), item: rest };
  const keys = Object.keys(usage);
  if (keys.length > 400) {
    keys
      .sort((a, b) => usage[a].t - usage[b].t)
      .slice(0, keys.length - 400)
      .forEach((k) => delete usage[k]);
  }
  save();
}

export function usageBoost(key: string): number {
  const u = usage[key];
  if (!u) return 0;
  const recent = Date.now() - u.t < 7 * 86400000 ? 4 : 0;
  return 6 * Math.log2(1 + u.c) + recent;
}

export function recentItems(limit = 6): ResultItem[] {
  return Object.values(usage)
    .sort((a, b) => b.t - a.t)
    .slice(0, limit)
    .map((u) => u.item);
}

export function setDemoUsage(items: ResultItem[]): void {
  items.forEach((item, i) => {
    usage[`${item.source}:${item.id}`] = { c: 3, t: Date.now() - i * 3600000, item };
  });
}
