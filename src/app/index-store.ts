import { createStore } from "./store";
import { platform } from "./platform";
import { recencyBoost, scoreEntry, toEntry, type Entry } from "./search";
import { usageBoost } from "./usage";
import type { ResultItem } from "../sources/types";

/**
 * Index locaux (titres + métadonnées) gardés en mémoire et enregistrés sur le PC.
 * Les contenus (pages, fichiers, mails) ne sont jamais stockés.
 */
export interface LocalIndex {
  items: ResultItem[];
  entries: Entry[];
  byId: Map<string, ResultItem>;
  meta: Record<string, any>;
}

const indexes = new Map<string, LocalIndex>();

/** Compteur incrémenté à chaque changement d'index (pour rafraîchir l'interface). */
export const indexVersion = createStore({ v: 0 });

function build(items: ResultItem[], meta: Record<string, any>): LocalIndex {
  return {
    items,
    entries: items.map(toEntry),
    byId: new Map(items.map((i) => [i.id, i])),
    meta,
  };
}

export function getIndex(name: string): LocalIndex {
  let idx = indexes.get(name);
  if (!idx) {
    idx = build([], {});
    indexes.set(name, idx);
  }
  return idx;
}

const saveTimers = new Map<string, number>();

function scheduleSave(name: string) {
  window.clearTimeout(saveTimers.get(name));
  saveTimers.set(
    name,
    window.setTimeout(() => {
      const idx = getIndex(name);
      const data = JSON.stringify({ v: 1, meta: idx.meta, items: idx.items });
      void platform.indexSave(name, data).catch(() => {});
    }, 1500),
  );
}

export function setIndex(name: string, items: ResultItem[], meta: Record<string, any>, persist = true): void {
  indexes.set(name, build(items, meta));
  indexVersion.set((s) => ({ v: s.v + 1 }));
  if (persist) scheduleSave(name);
}

export function setIndexMeta(name: string, patch: Record<string, any>): void {
  const idx = getIndex(name);
  idx.meta = { ...idx.meta, ...patch };
  scheduleSave(name);
}

/** Ajoute / met à jour des éléments (résultats en direct) sans tout reconstruire. */
export function upsertItems(name: string, items: ResultItem[]): void {
  if (!items.length) return;
  const idx = getIndex(name);
  let changed = false;
  for (const it of items) {
    const clean: ResultItem = { ...it, live: undefined, score: undefined };
    const prev = idx.byId.get(clean.id);
    if (prev && prev.title === clean.title && prev.t === clean.t) continue;
    changed = true;
    idx.byId.set(clean.id, clean);
    if (prev) {
      const pos = idx.items.indexOf(prev);
      if (pos >= 0) {
        idx.items[pos] = clean;
        idx.entries[pos] = toEntry(clean);
      }
    } else {
      idx.items.push(clean);
      idx.entries.push(toEntry(clean));
    }
  }
  if (changed) scheduleSave(name);
}

export async function loadIndex(name: string): Promise<void> {
  try {
    const raw = await platform.indexLoad(name);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data?.v === 1 && Array.isArray(data.items)) setIndex(name, data.items, data.meta ?? {}, false);
  } catch {
    /* index illisible : il sera reconstruit */
  }
}

export async function clearAllIndexes(): Promise<void> {
  indexes.clear();
  await platform.indexClear();
  indexVersion.set((s) => ({ v: s.v + 1 }));
}

/**
 * Recherche dans un index : score de pertinence + fraîcheur + usage.
 * Sans mots, renvoie les éléments les plus récents.
 */
export function searchIndex(
  name: string,
  tokens: string[],
  filter: ((it: ResultItem) => boolean) | null,
  limit: number,
  sortRecent = false,
): ResultItem[] {
  const idx = getIndex(name);
  const scored: Array<{ it: ResultItem; s: number }> = [];
  if (!tokens.length || sortRecent) {
    for (const e of idx.entries) {
      if (filter && !filter(e.item)) continue;
      if (tokens.length && scoreEntry(e, tokens) < 0) continue;
      scored.push({ it: e.item, s: e.item.t ?? 0 });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map(({ it }) => ({ ...it, score: 10 + recencyBoost(it.t) }));
  }
  for (const e of idx.entries) {
    const s = scoreEntry(e, tokens);
    if (s < 0) continue;
    if (filter && !filter(e.item)) continue;
    scored.push({ it: e.item, s: s + recencyBoost(e.item.t) + usageBoost(`${name}:${e.item.id}`) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(({ it, s }) => ({ ...it, score: s }));
}
