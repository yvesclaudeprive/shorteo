import type { KeyboardEvent } from "react";
import { createStore } from "./store";
import { platform } from "./platform";
import { loadSettings, settings, settingsStore, updateSettings } from "./settings";
import { getIndex, loadIndex } from "./index-store";
import { loadUsage, recordUsage, recentItems } from "./usage";
import { NotConfiguredError } from "./http";
import {
  applyCompletion,
  carryQuery,
  computeCompletions,
  parseQuery,
  removeOperator,
  toggleOperator,
  type CompletionState,
} from "./query";
import { norm, recencyBoost, scoreEntry, toEntry } from "./search";
import { ALL_ORDER, BAR_ORDER, SOURCES, sourceDef, sourceLabel } from "../sources/registry";
import { loadDemoData } from "../sources/demo";
import type { Chip, ContactInfo, NativeTarget, ResultItem, SourceDef, SourceId, SourceKey } from "../sources/types";

export interface Group {
  key: string;
  title?: string;
  source?: SourceKey;
  items: ResultItem[];
  loading?: boolean;
  error?: string;
  /** Explication + lien vers un onglet des paramètres */
  hint?: string;
  hintTab?: string;
}

export interface UIState {
  mode: "home" | "search" | "settings";
  source: SourceId;
  query: string;
  caret: number;
  groups: Group[];
  selectedKey: string | null;
  /** La sélection a été choisie par l'utilisateur (sinon elle suit le meilleur résultat) */
  userSelected: boolean;
  homeFocus: number;
  comp: CompletionState & { index: number; open: boolean; touched: boolean };
  liveLoading: boolean;
  liveMs: number | null;
  toast: { text: string; tone: "info" | "error" | "success"; id: number } | null;
  sync: { running: boolean; label?: string; last?: number; errors: string[] };
  settingsTab: string;
  hiddenAt: number;
  apps: Record<string, { running: boolean; installed: boolean }>;
}

const NO_COMP = { items: [], ghost: "", start: 0, end: 0, index: 0, open: false, touched: false };

export const ui = createStore<UIState>({
  mode: "home",
  source: "all",
  query: "",
  caret: 0,
  groups: [],
  selectedKey: null,
  userSelected: false,
  homeFocus: 0,
  comp: NO_COMP,
  liveLoading: false,
  liveMs: null,
  toast: null,
  sync: { running: false, errors: [] },
  settingsTab: "general",
  hiddenAt: 0,
  apps: {},
});

export const itemKey = (it: ResultItem) => `${it.source}:${it.id}`;

export function flatItems(groups = ui.get().groups): ResultItem[] {
  return groups.flatMap((g) => g.items);
}

export function selectedItem(): ResultItem | null {
  const s = ui.get();
  const items = flatItems(s.groups);
  return items.find((i) => itemKey(i) === s.selectedKey) ?? items[0] ?? null;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

let toastTimer: number | undefined;
export function toast(text: string, tone: "info" | "error" | "success" = "info", ms = 3200): void {
  window.clearTimeout(toastTimer);
  ui.set({ toast: { text, tone, id: Date.now() } });
  toastTimer = window.setTimeout(() => ui.set({ toast: null }), ms);
}

export function errorText(e: unknown): string {
  if (e instanceof NotConfiguredError) return `${e.message} n'est pas connecté (Paramètres)`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function focusInput(): void {
  window.dispatchEvent(new Event("ys-focus"));
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

let seq = 0;
let liveTimer: number | undefined;

function setGroups(groups: Group[], extra: Partial<UIState> = {}): void {
  const s = ui.get();
  const items = flatItems(groups);
  const keep = s.userSelected && s.selectedKey && items.some((i) => itemKey(i) === s.selectedKey);
  ui.set({ groups, selectedKey: keep ? s.selectedKey : items[0] ? itemKey(items[0]) : null, ...extra });
}

function nativeRow(src: SourceDef, target: NativeTarget, query: string): ResultItem {
  return {
    id: "native",
    source: src.key,
    kind: "native",
    action: "native",
    title: `${target.label} : « ${query.trim()} »`,
    url: target.url,
    app: target.app,
    snippet: target.hint,
  };
}

/** Explication quand Notion ne renvoie rien (connexion incomplète). */
function emptyHint(src: SourceDef, items: ResultItem[]): Partial<Group> {
  if (src.key !== "notion" || items.length) return {};
  const c = settings().connected;
  if (!c.notionMcp)
    return {
      hint: "Aucun résultat dans les pages partagées avec Shorteo. Pour chercher dans tout Notion (contenu compris), connectez la « Recherche complète ».",
      hintTab: "notion",
    };
  return {};
}

function switchRow(key: SourceKey, count?: number): ResultItem {
  return {
    id: `switch-${key}`,
    source: key,
    kind: "switch",
    action: "switch",
    target: key,
    title: `Voir tous les résultats ${SOURCES[key].label}${count ? ` (${count}+)` : ""}`,
    url: "",
  };
}

/** Fusionne résultats locaux et en direct sans doublon. */
function merge(src: SourceDef, local: ResultItem[], live: ResultItem[], tokens: string[]): ResultItem[] {
  if (!local.length && src.key === "mail") return live.map((l) => ({ ...l, live: true }));
  const byId = new Map<string, ResultItem>(local.map((i) => [i.id, { ...i }]));
  live.forEach((v, rank) => {
    const prev = byId.get(v.id);
    if (prev) {
      byId.set(v.id, { ...prev, ...v, live: true, score: (prev.score ?? 0) + 6 });
    } else {
      const s = scoreEntry(toEntry(v), tokens);
      byId.set(v.id, { ...v, live: true, score: (s >= 0 ? s : 14) + recencyBoost(v.t) - rank * 0.4 });
    }
  });
  return [...byId.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 60);
}

export function runSearch(): void {
  const s = ui.get();
  const id = ++seq;
  window.clearTimeout(liveTimer);
  if (s.mode !== "search") return;
  if (s.source === "all") searchAll(id, s.query);
  else searchOne(id, s.source, s.query);
}

function searchOne(id: number, key: SourceKey, query: string): void {
  const src = SOURCES[key];
  if (!src.configured()) {
    setGroups([{ key, source: key, items: [], error: "notconfigured" }], { liveLoading: false });
    return;
  }
  const q = parseQuery(query, src);
  const empty = !query.trim();
  const actions = src.actions?.(q) ?? [];

  if (empty) {
    const er = src.emptyResults?.() ?? [];
    if (er instanceof Promise) {
      setGroups([{ key, source: key, items: actions, loading: true }], { liveLoading: true });
      er.then((items) => {
        if (id === seq) setGroups([{ key, source: key, items: [...actions, ...items] }], { liveLoading: false });
      }).catch((e) => {
        if (id === seq) setGroups([{ key, source: key, items: actions, error: errorText(e) }], { liveLoading: false });
      });
    } else {
      setGroups([{ key, source: key, items: [...(src.actions ? [] : actions), ...er] }], { liveLoading: false });
    }
    return;
  }

  const local = src.localSearch?.(q, 40) ?? [];
  const native = src.actions ? null : nativeRow(src, src.nativeSearch(q), query);
  const willLive = !!src.liveSearch && (src.wantsLive?.(q) ?? true);
  const wrap = (list: ResultItem[]): ResultItem[] =>
    !native ? [...actions, ...list] : src.nativeFirst ? [native, ...actions, ...list] : [...actions, ...list, native];
  setGroups([{ key, source: key, items: wrap(local), loading: willLive }], {
    liveLoading: willLive,
  });
  if (!willLive) return;

  liveTimer = window.setTimeout(async () => {
    const t0 = performance.now();
    try {
      const live = await src.liveSearch!(q, 25);
      if (id !== seq) return;
      const merged = merge(src, local, live, q.tokens);
      setGroups([{ key, source: key, items: wrap(merged), ...emptyHint(src, merged) }], {
        liveLoading: false,
        liveMs: Math.round(performance.now() - t0),
      });
    } catch (e) {
      if (id !== seq) return;
      setGroups([{ key, source: key, items: wrap(local), error: errorText(e) }], { liveLoading: false });
    }
  }, src.liveDelay?.() ?? 220);
}

function searchAll(id: number, query: string): void {
  const text = query.trim();
  if (!text) {
    const recents = recentItems(8);
    setGroups(recents.length ? [{ key: "recent", title: "Ouverts récemment", items: recents }] : [], {
      liveLoading: false,
    });
    return;
  }
  const q = parseQuery(text, null);
  const enabled = ALL_ORDER.filter((k) => SOURCES[k].configured());
  const perSource = new Map<SourceKey, ResultItem[]>();
  for (const k of enabled) {
    const src = SOURCES[k];
    if (!src.localSearch) continue;
    perSource.set(k, src.localSearch(q, 6));
  }

  const build = (loadingKeys: Set<SourceKey>, errors: Map<SourceKey, string>): Group[] => {
    const groups: Group[] = [];
    // Meilleur résultat toutes sources confondues
    let best: ResultItem | null = null;
    for (const [k, items] of perSource) {
      if (k === "chatgpt" || k === "claude") continue;
      const top = items[0];
      if (top && (top.score ?? 0) >= 30 && (!best || (top.score ?? 0) > (best.score ?? 0))) best = top;
    }
    if (best) groups.push({ key: "best", title: "Meilleur résultat", items: [best] });
    for (const k of enabled) {
      if (k === "chatgpt" || k === "claude") continue;
      const items = (perSource.get(k) ?? []).filter((i) => !best || itemKey(i) !== itemKey(best));
      const shown = items.slice(0, 4);
      if (!shown.length && !loadingKeys.has(k) && !errors.has(k)) continue;
      groups.push({
        key: k,
        title: SOURCES[k].label,
        source: k,
        items: shown.length ? [...shown, switchRow(k, items.length > 4 ? 4 : undefined)] : [],
        loading: loadingKeys.has(k),
        error: errors.get(k),
      });
    }
    const ai: ResultItem[] = [...SOURCES.claude.actions!(q).slice(0, 1), ...SOURCES.chatgpt.actions!(q).slice(0, 1)];
    for (const k of ["claude", "chatgpt"] as SourceKey[]) ai.push(...(perSource.get(k) ?? []).slice(0, 2));
    groups.push({ key: "ai", title: "Intelligence artificielle", items: ai });
    return groups;
  };

  const liveKeys = enabled.filter((k) => {
    const src = SOURCES[k];
    return !!src.liveSearch && k !== "chatgpt" && k !== "claude" && (src.wantsLive?.(q) ?? true);
  });
  const loading = new Set<SourceKey>(liveKeys);
  const errors = new Map<SourceKey, string>();
  setGroups(build(loading, errors), { liveLoading: loading.size > 0 });
  if (!liveKeys.length) return;

  liveTimer = window.setTimeout(() => {
    const t0 = performance.now();
    for (const k of liveKeys) {
      const src = SOURCES[k];
      const sq = parseQuery(text, src);
      src
        .liveSearch!(sq, 8)
        .then((live) => {
          if (id !== seq) return;
          perSource.set(k, merge(src, perSource.get(k) ?? [], live, q.tokens));
        })
        .catch((e) => {
          if (id !== seq) return;
          errors.set(k, errorText(e));
        })
        .finally(() => {
          if (id !== seq) return;
          loading.delete(k);
          setGroups(build(loading, errors), {
            liveLoading: loading.size > 0,
            liveMs: loading.size ? null : Math.round(performance.now() - t0),
          });
        });
    }
  }, 260);
}

// ---------------------------------------------------------------------------
// Saisie, outils, autocomplétion
// ---------------------------------------------------------------------------

export function setQuery(value: string, caret: number): void {
  const s = ui.get();
  const src = sourceDef(s.source);
  const c = computeCompletions(value, caret, src);
  ui.set({
    query: value,
    caret,
    selectedKey: value === s.query ? s.selectedKey : null,
    userSelected: value === s.query ? s.userSelected : false,
    mode: s.mode === "home" && value ? "search" : s.mode,
    comp: { ...c, index: 0, open: c.items.length > 0, touched: false },
  });
  runSearch();
}

export function setCaret(caret: number): void {
  const s = ui.get();
  if (caret === s.caret) return;
  const c = computeCompletions(s.query, caret, sourceDef(s.source));
  ui.set({ caret, comp: { ...c, index: 0, open: c.items.length > 0, touched: false } });
}

export function setSource(id: SourceId, opts: { keepQuery?: boolean; query?: string } = {}): void {
  const s = ui.get();
  const target = sourceDef(id);
  const query = opts.query ?? (opts.keepQuery === false ? "" : carryQuery(s.query, target));
  ui.set({ source: id, mode: "search", query, caret: query.length, comp: NO_COMP, selectedKey: null, userSelected: false });
  updateSettings({ lastSource: id });
  runSearch();
  focusInput();
}

export function cycleSource(delta: number): void {
  const s = ui.get();
  const i = BAR_ORDER.indexOf(s.source);
  setSource(BAR_ORDER[(i + delta + BAR_ORDER.length) % BAR_ORDER.length]);
}

export function goHome(): void {
  ui.set({ mode: "home", query: "", caret: 0, comp: NO_COMP, groups: [], selectedKey: null, userSelected: false });
  focusInput();
}

export function moveSelection(delta: number): void {
  const s = ui.get();
  const items = flatItems(s.groups);
  if (!items.length) return;
  const i = Math.max(0, items.findIndex((x) => itemKey(x) === s.selectedKey));
  const next = Math.min(items.length - 1, Math.max(0, i + delta));
  ui.set({ selectedKey: itemKey(items[next]), userSelected: true });
}

export function selectKey(key: string): void {
  if (ui.get().selectedKey !== key) ui.set({ selectedKey: key, userSelected: true });
}

export function moveCompletion(delta: number): void {
  const s = ui.get();
  const n = s.comp.items.length;
  if (!n) return;
  ui.set({ comp: { ...s.comp, index: (s.comp.index + delta + n) % n, touched: true } });
}

export function closeCompletion(): void {
  ui.set({ comp: { ...ui.get().comp, open: false, items: [], ghost: "" } });
}

export function acceptCompletion(index?: number): void {
  const s = ui.get();
  const c = s.comp.items[index ?? s.comp.index];
  if (!c) return;
  const { value, caret } = applyCompletion(s.query, s.comp, c);
  setQuery(value, caret);
  focusInput();
}

interface Ghost {
  text: string;
  /** complétion d'un mot (on ajoute une espace après acceptation) */
  word: boolean;
}

/**
 * Complétion grisée dans la barre :
 * 1. la fin du titre d'un résultat qui commence par ce qui est tapé ;
 * 2. sinon, la fin du mot en cours, prise dans les titres des résultats.
 */
function ghostInfo(s: UIState): Ghost | null {
  if (!s.query || s.caret !== s.query.length || s.comp.open) return null;
  if (/\s$/.test(s.query)) return null;
  const items = flatItems(s.groups)
    .filter((i) => !i.action || i.action === "open")
    .slice(0, 15);
  if (!items.length) return null;
  if (!s.query.includes(":")) {
    for (const it of items) {
      if (it.title.length <= s.query.length) continue;
      if (norm(it.title.slice(0, s.query.length)) === norm(s.query)) return { text: it.title.slice(s.query.length), word: false };
    }
  }
  const m = /(\S+)$/.exec(s.query);
  const last = m?.[1] ?? "";
  if (last.length < 2 || last.includes(":")) return null;
  const nl = norm(last);
  const counts = new Map<string, number>();
  for (const it of items) {
    for (const w of it.title.split(/[\s,.;:!?()«»"'’/|–—-]+/)) {
      if (w.length <= last.length) continue;
      if (norm(w.slice(0, last.length)) !== nl) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const [w, n] of counts) {
    if (!best || n > (counts.get(best) ?? 0) || (n === counts.get(best) && w.length < best.length)) best = w;
  }
  return best ? { text: best.slice(last.length), word: true } : null;
}

/** Texte grisé affiché à droite de la saisie. */
export function titleGhost(s: UIState): string {
  return ghostInfo(s)?.text ?? "";
}

export function acceptGhost(): boolean {
  const s = ui.get();
  if (s.comp.open && s.comp.ghost) {
    acceptCompletion(0);
    return true;
  }
  const g = ghostInfo(s);
  if (!g) return false;
  const v = s.query + g.text + (g.word ? " " : "");
  setQuery(v, v.length);
  return true;
}

export function applyFilter(opKey: string, value: string): void {
  const s = ui.get();
  const src = sourceDef(s.source);
  if (!src) return;
  const v = toggleOperator(s.query, src, opKey, value);
  ui.set({ mode: "search" });
  setQuery(v, v.length);
  focusInput();
}

export function clearFilter(opKey: string): void {
  const s = ui.get();
  const src = sourceDef(s.source);
  if (!src) return;
  const v = removeOperator(s.query, src, opKey);
  setQuery(v, v.length);
  focusInput();
}

/** Ajoute « clé: » en fin de barre : les valeurs possibles s'affichent aussitôt. */
export function insertOperator(alias: string): void {
  const s = ui.get();
  const base = s.query && !/\s$/.test(s.query) ? s.query + " " : s.query;
  const v = `${base}${alias}:`;
  setQuery(v, v.length);
  focusInput();
}

export function toggleChip(chip: Chip): void {
  const s = ui.get();
  const src = sourceDef(s.source);
  if (!src) return;
  const v = toggleOperator(s.query, src, chip.op, chip.value);
  ui.set({ mode: "search" });
  setQuery(v, v.length);
  focusInput();
}

// ---------------------------------------------------------------------------
// Ouverture (application si disponible, sinon site web)
// ---------------------------------------------------------------------------

export async function refreshApps(): Promise<void> {
  const targets = Object.values(SOURCES)
    .map((s) => s.appTarget)
    .filter((t): t is NonNullable<SourceDef["appTarget"]> => !!t);
  try {
    const st = await platform.appsStatus(
      targets.map((t) => t.process),
      targets.map((t) => t.scheme),
    );
    const apps: UIState["apps"] = {};
    for (const t of targets) {
      const running = !!st.running[t.process];
      apps[t.scheme] = { running, installed: running || !!st.installed[t.scheme] };
    }
    ui.set({ apps });
  } catch {
    /* ignoré */
  }
}

/** Indique si un lien s'ouvrira dans l'application (selon l'état connu). */
export function willOpenInApp(item: { source: SourceKey; app?: string }): boolean {
  const src = SOURCES[item.source];
  const at = src.appTarget;
  if (!item.app || !at) return false;
  const mode = at.mode();
  const st = ui.get().apps[at.scheme];
  if (mode === "browser" || !st) return false;
  return mode === "app-if-running" ? st.running : st.installed;
}

async function resolveUrl(source: SourceKey, web: string, app?: string, forceWeb = false): Promise<string> {
  const at = SOURCES[source].appTarget;
  if (forceWeb || !app || !at) return web;
  const mode = at.mode();
  if (mode === "browser") return web;
  const st = await platform.appsStatus([at.process], [at.scheme]);
  const running = !!st.running[at.process];
  const installed = running || !!st.installed[at.scheme];
  return (mode === "app-if-running" ? running : installed) ? app : web;
}

export async function hideWindow(): Promise<void> {
  ui.set({ hiddenAt: Date.now() });
  await platform.hide();
}

async function afterOpen(): Promise<void> {
  await hideWindow();
}

export async function runNative(source?: SourceKey, extra?: NativeTarget): Promise<void> {
  const s = ui.get();
  const key = source ?? (s.source === "all" ? null : s.source);
  if (!key) return;
  const src = SOURCES[key];
  const target = extra ?? src.nativeSearch(parseQuery(s.query, src));
  try {
    if (target.copy) await platform.copy(target.copy);
    const url = await resolveUrl(key, target.url, target.app);
    await platform.openUrl(url);
    await afterOpen();
    // Dans l'application : Shorteo tape le raccourci de recherche et colle la requête
    if (target.recipe && target.app && url === target.app) void platform.nativeSearchKeys(target.recipe);
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export async function openItem(item: ResultItem, opts: { web?: boolean } = {}): Promise<void> {
  if (item.action === "switch" && item.target) {
    setSource(item.target);
    return;
  }
  if (item.action === "native") {
    await runNative(item.source);
    return;
  }
  try {
    const url = await resolveUrl(item.source, item.url, item.app, opts.web);
    await platform.openUrl(url);
    recordUsage(item);
    await afterOpen();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export async function openSelected(opts: { web?: boolean } = {}): Promise<void> {
  const it = selectedItem();
  if (it) await openItem(it, opts);
}

/** Appeler (tel:) ou écrire (mailto:) : ouvre l'application par défaut de Windows. */
export async function openContact(c: ContactInfo): Promise<void> {
  const url = c.kind === "phone" ? `tel:${c.value.replace(/[^\d+]/g, "")}` : `mailto:${c.value}`;
  try {
    await platform.openUrl(url);
    await afterOpen();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export async function copyText(text: string, what: string): Promise<void> {
  await platform.copy(text);
  toast(`${what} copié`, "success", 1600);
}

export async function copyLink(item: ResultItem | null = selectedItem()): Promise<void> {
  if (!item?.url) return;
  await platform.copy(item.url);
  toast("Lien copié", "success", 1600);
}

// ---------------------------------------------------------------------------
// Clavier dans la barre de recherche
// ---------------------------------------------------------------------------

export function handleSearchKey(e: KeyboardEvent<HTMLInputElement>): void {
  const s = ui.get();
  if ((e.altKey || e.ctrlKey) && /^[1-7]$/.test(e.key)) {
    e.preventDefault();
    setSource(BAR_ORDER[Number(e.key) - 1]);
    return;
  }
  if (e.ctrlKey && e.key === "Tab") {
    e.preventDefault();
    cycleSource(e.shiftKey ? -1 : 1);
    return;
  }
  if (s.comp.open && s.comp.items.length) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveCompletion(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveCompletion(-1);
      return;
    }
    if (e.key === "Tab" || (e.key === "Enter" && s.comp.touched && !e.ctrlKey && !e.shiftKey)) {
      e.preventDefault();
      acceptCompletion();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeCompletion();
      return;
    }
  }
  if (e.key === "Tab") {
    e.preventDefault();
    acceptGhost();
    return;
  }
  if (e.key === "ArrowRight" && s.caret === s.query.length && !e.shiftKey) {
    if (acceptGhost()) e.preventDefault();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveSelection(1);
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    moveSelection(-1);
    return;
  }
  if (e.key === "PageDown") {
    e.preventDefault();
    moveSelection(8);
    return;
  }
  if (e.key === "PageUp") {
    e.preventDefault();
    moveSelection(-8);
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) void runNative();
    else void openSelected({ web: e.ctrlKey });
    return;
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
    e.preventDefault();
    void copyLink();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    if (s.query) setQuery("", 0);
    else goHome();
  }
}

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

export function openSettings(tab?: string): void {
  ui.set({ mode: "settings", settingsTab: tab ?? ui.get().settingsTab });
  void platform.suspendBlur(true);
}

export function closeSettings(): void {
  void platform.suspendBlur(false);
  goHome();
}

// ---------------------------------------------------------------------------
// Synchronisation des index
// ---------------------------------------------------------------------------

let syncing = false;

export async function syncAll(full = false): Promise<void> {
  if (syncing || platform.demo) return;
  syncing = true;
  const errors: string[] = [];
  const labels = new Map<string, string>();
  const report = () =>
    ui.set({
      sync: { ...ui.get().sync, running: true, label: [...labels.values()].join(" · ") || "Synchronisation…" },
    });
  report();
  const tasks = (["notion", "pipedrive", "drive", "mail"] as SourceKey[])
    .map((k) => SOURCES[k])
    .filter((s) => s.configured() && s.sync);
  await Promise.allSettled(
    tasks.map(async (src) => {
      const meta = getIndex(src.key === "mail" ? "contacts" : src.key).meta;
      const needFull = full || !meta.lastFull || Date.now() - meta.lastFull > 24 * 3600000;
      try {
        await src.sync!({
          full: needFull,
          progress: (m) => {
            labels.set(src.key, m);
            report();
          },
        });
      } catch (e) {
        if (!(e instanceof NotConfiguredError)) errors.push(`${src.label} : ${errorText(e)}`);
      } finally {
        labels.delete(src.key);
        report();
      }
    }),
  );
  ui.set({ sync: { running: false, last: Date.now(), errors } });
  syncing = false;
  if (ui.get().mode === "search" && !ui.get().query) runSearch();
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

function onShown(): void {
  const s = ui.get();
  if (s.mode !== "settings" && Date.now() - s.hiddenAt > 90000) goHome();
  else if (s.mode === "search") runSearch();
  focusInput();
  void refreshApps();
  if (Date.now() - (s.sync.last ?? 0) > 60000) void syncAll(false);
}

export async function init(): Promise<void> {
  const existed = await loadSettings();
  await loadUsage();
  if (platform.demo) loadDemoData();
  else await Promise.all(["notion", "drive", "pipedrive", "contacts", "chatgpt", "claude"].map(loadIndex));

  const last = settings().lastSource as SourceId;
  ui.set({ source: BAR_ORDER.includes(last) ? last : "all", homeFocus: Math.max(0, BAR_ORDER.indexOf(last)) });
  if (!existed && !platform.demo) openSettings("welcome");

  await platform.on("window-shown", onShown);
  await platform.on("window-hidden", () => ui.set({ hiddenAt: Date.now() }));
  await platform.on("open-settings", () => openSettings());
  await platform.on("sync-now", () => void syncAll(false));

  const err = await platform.shortcutError();
  if (err) toast(err, "error", 8000);

  void refreshApps();
  window.setTimeout(() => void syncAll(false), 1500);
  window.setInterval(() => {
    const st = ui.get().sync;
    if (!st.running && Date.now() - (st.last ?? 0) > settingsStore.get().syncMinutes * 60000) void syncAll(false);
  }, 30000);
}

export { sourceLabel };
