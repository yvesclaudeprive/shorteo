import { request, ApiError, NotConfiguredError } from "../app/http";
import { getSecret } from "../app/secrets";
import { settings, fillTemplate, updateSettings } from "../app/settings";
import { getIndex, indexVersion, searchIndex, setIndex, setIndexMeta, upsertItems } from "../app/index-store";
import { fullDate, inRange, periodRange, PERIOD_VALUES, relativeDate } from "../app/format";
import { norm } from "../app/search";
import { activeFilterLabels, opValues } from "../app/query";
import { platform } from "../app/platform";
import { demoLive } from "./demo";
import { mcpFavorites, mcpSearch, notionKey, type NotionFavorite } from "./notion-mcp";
import type { ParsedQuery, ResultItem, SourceDef } from "./types";

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";

async function notion<T = any>(path: string, body?: unknown): Promise<T> {
  const token = await getSecret("notion_token");
  if (!token) throw new NotConfiguredError("Notion");
  return request<T>(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
    json: body,
  });
}

/** Vérifie la clé et l'accès aux pages, avec un message clair en cas de problème. */
export async function testNotion(): Promise<{ ok: boolean; message: string }> {
  try {
    const me = await notion<any>("/users/me");
    const ws = me?.bot?.workspace_name ?? me?.name ?? "Notion";
    const res = await notion<any>("/search", { page_size: 5 });
    const n = (res?.results ?? []).length;
    if (!n) {
      return {
        ok: false,
        message: `Clé valide (espace « ${ws} »), mais aucune page n'est partagée avec l'intégration. Dans Notion, ouvrez vos pages principales → ••• → Connexions → ajoutez l'intégration.`,
      };
    }
    return { ok: true, message: `Connecté à l'espace « ${ws} » : synchronisation en cours` };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401)
      throw new Error("Clé refusée par Notion (401) : copiez le « secret d'intégration interne » en entier (il commence par ntn_).");
    if (e instanceof ApiError && e.status === 403)
      throw new Error("Notion refuse l'accès (403) : vérifiez la capacité « Lire le contenu » de l'intégration.");
    if (e instanceof ApiError && e.status === 400)
      throw new Error(`Notion a refusé la requête : ${e.message}`);
    throw e;
  }
}

const rich = (arr: any[] | undefined): string =>
  (arr ?? [])
    .map((t) => t?.plain_text ?? t?.text?.content ?? "")
    .join("")
    .trim();

function titleOf(r: any): string {
  if (r.object === "data_source" || r.object === "database") return rich(r.title) || "Base sans titre";
  const props = r.properties ?? {};
  for (const k of Object.keys(props)) {
    if (props[k]?.type === "title") return rich(props[k].title) || "Sans titre";
  }
  return "Sans titre";
}

function toItem(r: any): ResultItem {
  const isDb = r.object === "data_source" || r.object === "database";
  const dbId: string | undefined = r.parent?.database_id ?? (r.object === "database" ? r.id : undefined);
  const url: string =
    r.url ?? `https://www.notion.so/${String(isDb ? dbId ?? r.id : r.id).replace(/-/g, "")}`;
  const parent: string | undefined = r.parent?.data_source_id ?? r.parent?.database_id ?? r.parent?.page_id;
  return {
    id: r.id,
    source: "notion",
    kind: isDb ? "database" : "page",
    title: titleOf(r),
    url,
    app: url.replace(/^https:\/\//, "notion://"),
    t: Date.parse(r.last_edited_time) || undefined,
    icon: r.icon?.type === "emoji" ? r.icon.emoji : undefined,
    f: {
      p: parent,
      db: isDb ? dbId : undefined,
      cb: r.created_by?.id,
      eb: r.last_edited_by?.id,
      c: Date.parse(r.created_time) || undefined,
    },
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function users(): Record<string, string> {
  return getIndex("notion").meta.users ?? {};
}

/** Identifiant Notion de l'utilisateur (« moi »), choisi dans les paramètres. */
function meId(): string {
  return settings().notionMe;
}

// --- Arborescence (calculée depuis l'index, mise en cache par version d'index) ---

let treeCache: { v: number; byDb: Map<string, ResultItem>; anc: Map<string, ResultItem[]> } = {
  v: -1,
  byDb: new Map(),
  anc: new Map(),
};

function tree() {
  const v = indexVersion.get().v;
  if (treeCache.v !== v) {
    const byDb = new Map<string, ResultItem>();
    for (const it of getIndex("notion").items) if (it.f?.db) byDb.set(it.f.db, it);
    treeCache = { v, byDb, anc: new Map() };
  }
  return treeCache;
}

function parentOf(item: ResultItem): ResultItem | undefined {
  const p = item.f?.p;
  if (!p) return undefined;
  const found = getIndex("notion").byId.get(p) ?? tree().byDb.get(p);
  return found && found.id !== item.id ? found : undefined;
}

/** Ancêtres du plus proche au plus lointain. */
export function ancestors(item: ResultItem): ResultItem[] {
  const t = tree();
  const hit = t.anc.get(item.id);
  if (hit) return hit;
  const out: ResultItem[] = [];
  const seen = new Set([item.id]);
  let cur = item;
  for (let i = 0; i < 12; i++) {
    const p = parentOf(cur);
    if (!p || seen.has(p.id)) break;
    out.push(p);
    seen.add(p.id);
    cur = p;
  }
  t.anc.set(item.id, out);
  return out;
}

/** Segments du chemin (de la racine au parent direct). */
function pathSegments(item: ResultItem): string[] {
  const p = item.f?.path as string | undefined;
  if (p) return p.split(" / ").map((x) => x.trim()).filter(Boolean);
  return ancestors(item)
    .map((x) => x.title)
    .reverse();
}

function pathOf(item: ResultItem, max = 3): string {
  const a = pathSegments(item);
  if (!a.length) return "";
  return a.length > max ? [a[0], "…", ...a.slice(-(max - 1))].join(" › ") : a.join(" › ");
}

/** Tous les chemins connus : index local + chemins vus dans les recherches Notion complètes. */
function knownPaths(): string[][] {
  const out: string[][] = [];
  for (const it of getIndex("notion").items) {
    const seg = pathSegments(it);
    if (seg.length) out.push(seg);
  }
  for (const p of (getIndex("notion").meta.mcpPaths as string[] | undefined) ?? []) out.push(p.split(" / "));
  return out;
}

/** Espaces (premier niveau de l'arborescence) et nombre d'éléments vus dedans. */
function spaces(): Array<{ value: string; detail: string }> {
  const count = new Map<string, number>();
  for (const seg of knownPaths()) count.set(seg[0], (count.get(seg[0]) ?? 0) + 1);
  return [...count.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 100)
    .map(([value, n]) => ({ value, detail: `${n.toLocaleString("fr-FR")} éléments` }));
}

/** Pages et bases qui contiennent d'autres éléments (filtre « Dans »). */
function containers(): Array<{ value: string; detail?: string }> {
  const count = new Map<string, { n: number; parent?: string }>();
  for (const seg of knownPaths()) {
    seg.forEach((name, i) => {
      const c = count.get(name) ?? { n: 0, parent: i ? seg[i - 1] : undefined };
      c.n++;
      count.set(name, c);
    });
  }
  return [...count.entries()]
    .sort((x, y) => y[1].n - x[1].n)
    .slice(0, 300)
    .map(([value, c]) => ({ value, detail: c.parent ? `dans ${c.parent}` : `${c.n} éléments` }));
}

function userValues() {
  const me = meId();
  const list = Object.entries(users()).map(([id, n]) => ({ value: n, detail: id === me ? "vous" : undefined }));
  return me ? [{ value: "moi", label: "Moi", aliases: ["me"] }, ...list] : list;
}

function matchUser(id: string | undefined, wanted: string[]): boolean {
  const name = norm(users()[id ?? ""] ?? "");
  return wanted.some((w) => (w === "moi" || w === "me" ? !!id && id === meId() : name.includes(w)));
}


/** Plage de dates du premier filtre de ce type présent dans la requête. */
function rangeOf(q: ParsedQuery, key: string) {
  for (const v of opValues(q, key)) {
    const r = periodRange(v);
    if (r) return r;
  }
  return null;
}

// --- Favoris : favoris Notion (lus en lecture seule) + pages épinglées dans Shorteo ---

/** Favoris connus : ceux de Notion puis les épingles Shorteo, sans doublon. */
export function notionFavorites(): NotionFavorite[] {
  const out = new Map<string, NotionFavorite>();
  const fromNotion = (getIndex("notion").meta.favorites as NotionFavorite[] | undefined) ?? [];
  for (const f of [...fromNotion, ...settings().notionPins]) {
    const k = notionKey(f.id);
    if (k && !out.has(k)) out.set(k, { ...f, id: k });
  }
  return [...out.values()];
}

/** Recharge les favoris Notion (au plus toutes les 10 min ; 1 h après un échec). */
export async function ensureNotionFavorites(force = false): Promise<void> {
  if (platform.demo || !settings().connected.notionMcp) return;
  const m = getIndex("notion").meta;
  const wait = m.favError ? 3600000 : 600000;
  if (!force && Date.now() - (m.favAt ?? 0) < wait) return;
  try {
    const favorites = await mcpFavorites();
    setIndexMeta("notion", { favorites, favAt: Date.now(), favError: undefined });
  } catch (e) {
    setIndexMeta("notion", { favAt: Date.now(), favError: errorMessage(e) });
  }
}

/** Épingle / désépingle une page dans Shorteo (aucune modification dans Notion). */
export function togglePin(item: ResultItem): boolean {
  const pins = settings().notionPins;
  const k = notionKey(item.id);
  const on = pins.some((p) => notionKey(p.id) === k);
  updateSettings({
    notionPins: on ? pins.filter((p) => notionKey(p.id) !== k) : [...pins, { id: k, title: item.title, url: item.url }],
  });
  return !on;
}

export function isPinned(item: ResultItem): boolean {
  const k = notionKey(item.id);
  return settings().notionPins.some((p) => notionKey(p.id) === k);
}

/** Pages vues dans les recherches limitées aux favoris (sous-pages, même hors de l'index). */
function rememberFavDescendants(items: ResultItem[]): void {
  if (!items.length) return;
  const cur: string[] = getIndex("notion").meta.favDesc ?? [];
  const set = new Set(cur);
  for (const it of items) set.add(notionKey(it.id));
  if (set.size !== cur.length) setIndexMeta("notion", { favDesc: [...set].slice(-5000) });
}

/** L'élément est-il un favori ou l'une de ses sous-pages ? */
function favoriteTest(): (it: ResultItem) => boolean {
  const favs = notionFavorites();
  const ids = new Set(favs.map((f) => f.id));
  const titles = new Set(favs.map((f) => norm(f.title)).filter((t) => t && t !== "favori"));
  const desc = new Set<string>(getIndex("notion").meta.favDesc ?? []);
  return (it) => {
    const k = notionKey(it.id);
    if (ids.has(k) || desc.has(k)) return true;
    if (ancestors(it).some((a) => ids.has(notionKey(a.id)))) return true;
    return pathSegments(it).some((s) => titles.has(norm(s)));
  };
}

/** Les favoris eux-mêmes, en tête quand le filtre ★ est actif. */
function favoriteItems(): ResultItem[] {
  const idx = getIndex("notion");
  const byKey = new Map(idx.items.map((i) => [notionKey(i.id), i]));
  return notionFavorites().map(
    (f) =>
      byKey.get(f.id) ?? {
        id: f.id,
        source: "notion",
        kind: "page",
        title: f.title,
        url: f.url ?? `https://www.notion.so/${f.id}`,
        app: `notion://www.notion.so/${f.id}`,
        f: { fav: 1 },
      },
  );
}

function applyFilters(q: ParsedQuery, trustMcp = true): (it: ResultItem) => boolean {
  const types = opValues(q, "type");
  const by = opValues(q, "par").map(norm);
  const editedBy = opValues(q, "modifie_par").map(norm);
  const period = rangeOf(q, "modifie");
  const created = rangeOf(q, "cree");
  const inside = opValues(q, "dans").map(norm);
  const space = opValues(q, "espace").map(norm);
  const inFav = opValues(q, "favoris").length ? favoriteTest() : null;
  return (it) => {
    if (inFav && !inFav(it)) return false;
    if (types.length && !types.includes(it.kind === "database" ? "base" : "page")) return false;
    if (period && !inRange(it.t, period)) return false;
    // Les résultats de la recherche Notion complète sont déjà filtrés par Notion (auteur, création)
    const fromMcp = trustMcp && !!it.f?.mcp;
    if (!fromMcp && created && !inRange(it.f?.c, created)) return false;
    if (!fromMcp && by.length && !matchUser(it.f?.cb, by)) return false;
    if (!fromMcp && editedBy.length && !matchUser(it.f?.eb, editedBy)) return false;
    const seg = inside.length || space.length ? pathSegments(it).map(norm) : [];
    if (inside.length && !inside.some((d) => seg.some((t) => t === d || t.includes(d)))) return false;
    if (space.length && !space.some((d) => !!seg[0] && (seg[0] === d || seg[0].includes(d)))) return false;
    return true;
  };
}

function sortItems(items: ResultItem[], tri: string | undefined): ResultItem[] {
  if (tri === "recent") return [...items].sort((a, b) => (b.t ?? 0) - (a.t ?? 0));
  if (tri === "ancien") return [...items].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  if (tri === "cree") return [...items].sort((a, b) => (b.f?.c ?? 0) - (a.f?.c ?? 0));
  return items;
}

async function fetchUsers(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let cursor: string | undefined;
  do {
    const res = await notion<any>(`/users?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const u of res.results ?? []) if (u.type === "person" && u.name) out[u.id] = u.name;
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

export const notionSource: SourceDef = {
  key: "notion",
  label: "Notion",
  color: "#a1a1aa",
  placeholder: "Pages et bases Notion…",
  operators: [
    {
      key: "type",
      strict: true,
      multi: true,
      aliases: ["type"],
      label: "Type",
      values: () => [
        { value: "page", label: "Pages" },
        { value: "base", label: "Bases de données", aliases: ["database", "db", "bdd"] },
      ],
    },
    { key: "par", multi: true, aliases: ["par", "auteur", "by"], label: "Créé par", values: userValues },
    { key: "modifie_par", multi: true, aliases: ["modifié_par", "edited_by"], label: "Modifié par", values: userValues },
    { key: "espace", multi: true, aliases: ["espace", "space", "teamspace"], label: "Espace", values: spaces },
    { key: "dans", multi: true, aliases: ["dans", "in"], label: "Dans", values: containers },
    { key: "modifie", aliases: ["modifié", "modif", "edited"], label: "Modifié", values: () => PERIOD_VALUES, dates: true },
    { key: "cree", aliases: ["créé", "created"], label: "Créé", values: () => PERIOD_VALUES, dates: true },
    {
      key: "favoris",
      strict: true,
      aliases: ["favoris", "fav"],
      label: "Favoris",
      values: () => [{ value: "oui", label: "Favoris et leurs sous-pages", aliases: ["yes", "1"] }],
    },
    {
      key: "tri",
      strict: true,
      aliases: ["tri", "sort"],
      label: "Tri",
      values: () => [
        { value: "pertinence", label: "Pertinence" },
        { value: "recent", label: "Modifiés récemment", aliases: ["récent", "date"] },
        { value: "ancien", label: "Modifiés il y a longtemps", aliases: ["vieux"] },
        { value: "cree", label: "Créés récemment", aliases: ["création"] },
      ],
    },
  ],
  filterBar: ["type", "par", "espace", "dans", "modifie", "tri"],
  chips: [{ label: "Favoris", op: "favoris", value: "oui", icon: "star" }],
  configured: () => settings().connected.notion || settings().connected.notionMcp,
  liveDelay: () => (settings().connected.notionMcp ? 380 : 220),
  nativeFirst: true,

  localSearch(q, limit) {
    const tri = opValues(q, "tri")[0];
    if (opValues(q, "favoris").length) {
      void ensureNotionFavorites();
      const filter = applyFilters(q, false);
      const favs = favoriteItems().filter((f) => !q.tokens.length || q.tokens.every((t) => norm(f.title).includes(t)));
      const found = q.tokens.length ? searchIndex("notion", q.tokens, filter, limit) : [];
      const seen = new Set(favs.map((f) => notionKey(f.id)));
      return [...favs, ...found.filter((i) => !seen.has(notionKey(i.id)))].slice(0, limit);
    }
    if (!tri || tri === "pertinence") return searchIndex("notion", q.tokens, applyFilters(q, false), limit);
    return sortItems(searchIndex("notion", q.tokens, applyFilters(q, false), 2000), tri).slice(0, limit);
  },

  wantsLive: (q) => q.text.length >= 2,

  async liveSearch(q, limit) {
    if (platform.demo) return demoLive("notion", q);
    const st = settings();
    const tri = opValues(q, "tri")[0];
    const tasks: Array<Promise<ResultItem[]>> = [];

    const favOnly = opValues(q, "favoris").length > 0;
    if (favOnly && st.connected.notionMcp) await ensureNotionFavorites();
    const favs = favOnly ? notionFavorites() : [];

    if (st.connected.notionMcp) {
      const by = opValues(q, "par").map(norm);
      const ids = Object.entries(users())
        .filter(([, n]) => by.some((b) => b !== "moi" && b !== "me" && norm(n).includes(b)))
        .map(([id]) => id);
      const created = rangeOf(q, "cree");
      const edited = rangeOf(q, "modifie");
      const opts = {
        createdByMe: by.includes("moi") || by.includes("me"),
        createdBy: ids,
        created: created ?? undefined,
        edited: edited ?? undefined,
        sortRecent: tri === "recent",
      };
      if (favOnly && favs.length && favs.length <= 8) {
        // ★ Favoris : une recherche Notion par favori, limitée à la page et à ses sous-pages
        tasks.push(
          (async () => {
            const lists: ResultItem[][] = [];
            for (let i = 0; i < favs.length; i += 4) {
              const batch = await Promise.allSettled(
                favs.slice(i, i + 4).map((f) => mcpSearch(q.text, { ...opts, pageUrl: f.url ?? f.id, pageSize: 10 })),
              );
              for (const b of batch) if (b.status === "fulfilled") lists.push(b.value);
              if (!lists.length && batch.every((b) => b.status === "rejected")) throw (batch[0] as PromiseRejectedResult).reason;
            }
            const items = lists.flat();
            upsertItems("notion", items);
            rememberFavDescendants(items);
            return items;
          })(),
        );
      } else {
        tasks.push(
          mcpSearch(q.text, { ...opts, pageSize: Math.min(limit, 25) }).then((items) => {
            // mémorisés localement : la prochaine frappe les propose instantanément
            upsertItems("notion", items);
            return items;
          }),
        );
      }
    }

    if (st.connected.notion) {
      tasks.push(
        (async () => {
          const types = opValues(q, "type");
          const filter =
            types.length === 1 ? { property: "object", value: types[0] === "base" ? "data_source" : "page" } : undefined;
          const sort =
            tri === "recent" || tri === "ancien"
              ? { direction: tri === "recent" ? "descending" : "ascending", timestamp: "last_edited_time" }
              : undefined;
          const res = await notion<any>("/search", { query: q.text, page_size: Math.min(limit, 30), filter, sort });
          const items = (res.results ?? [])
            .filter((r: any) => !r.in_trash && !r.archived && !r.is_archived)
            .map(toItem);
          upsertItems("notion", items);
          return items;
        })(),
      );
    }

    const settled = await Promise.allSettled(tasks);
    const ok = settled.filter((x): x is PromiseFulfilledResult<ResultItem[]> => x.status === "fulfilled");
    // Une erreur de la recherche complète ne doit jamais être masquée par l'index (souvent vide)
    if (st.connected.notionMcp && settled[0]?.status === "rejected") {
      throw new Error(`Recherche complète Notion : ${errorMessage((settled[0] as PromiseRejectedResult).reason)}`);
    }
    if (!ok.length) {
      const err = settled.find((x): x is PromiseRejectedResult => x.status === "rejected");
      throw err?.reason ?? new Error("Recherche Notion impossible");
    }
    // Résultats de la recherche complète d'abord (contenu + chemins), puis ceux de l'API
    const seen = new Set<string>();
    const merged: ResultItem[] = [];
    for (const list of ok.map((x) => x.value)) {
      for (const it of list) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        merged.push(it);
      }
    }
    const filtered = merged.filter(applyFilters(q));
    if (favOnly) {
      // les favoris dont le titre correspond, en tête
      const seen2 = new Set(filtered.map((i) => notionKey(i.id)));
      const favHits = favoriteItems().filter((f) => !seen2.has(notionKey(f.id)) && q.tokens.every((t) => norm(f.title).includes(t)));
      return sortItems([...favHits, ...filtered], tri);
    }
    return sortItems(filtered, tri);
  },

  emptyResults() {
    return searchIndex("notion", [], null, 12);
  },

  nativeSearch(q) {
    const tpl = settings().notionSearchUrl;
    if (tpl) return { label: "Rechercher dans Notion", url: fillTemplate(tpl, { q: q.raw }) };
    return {
      label: "Rechercher dans Notion",
      url: "https://www.notion.so/",
      app: "notion://www.notion.so/",
      copy: q.text,
      recipe: "notion",
      hint: "Ouvre la recherche de Notion avec votre texte",
      dropped: activeFilterLabels(q, notionSource),
    };
  },

  describe(item) {
    const path = pathOf(item);
    return {
      sub: path || (item.kind === "database" ? "Base de données" : undefined),
      meta: relativeDate(item.t),
      badge: item.kind === "database" ? "Base" : "Page",
      badgeTone: item.kind === "database" ? "violet" : "gray",
    };
  },

  details(item) {
    const rows = [
      { label: "Type", value: item.kind === "database" ? "Base de données" : "Page" },
      { label: "Modifié", value: fullDate(item.t) },
    ];
    const path = pathOf(item, 6);
    if (path) rows.push({ label: "Emplacement", value: path });
    const author = users()[item.f?.cb];
    if (author) rows.push({ label: "Créé par", value: author });
    const editor = users()[item.f?.eb];
    if (editor) rows.push({ label: "Modifié par", value: editor });
    if (item.f?.c) rows.push({ label: "Créé le", value: fullDate(item.f.c) });
    return rows;
  },

  async sync({ full, progress }) {
    void ensureNotionFavorites(full);
    const idx = getIndex("notion");
    const isFull = full || !idx.items.length;
    const since = isFull ? 0 : (idx.meta.lastSync ?? 0) - 10 * 60000;
    const map = new Map<string, ResultItem>(isFull ? [] : idx.items.map((i) => [i.id, i]));
    let cursor: string | undefined;
    let count = 0;
    let changed = false;
    let stop = false;
    do {
      const res = await notion<any>("/search", {
        page_size: 100,
        start_cursor: cursor,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      });
      for (const r of res.results ?? []) {
        const t = Date.parse(r.last_edited_time);
        if (!isFull && since && t < since) {
          stop = true;
          break;
        }
        changed = true;
        if (r.in_trash || r.archived || r.is_archived) {
          map.delete(r.id);
          continue;
        }
        map.set(r.id, toItem(r));
        count++;
      }
      if (isFull) progress(`Notion : ${count} pages`);
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor && !stop);
    let userMap = idx.meta.users;
    if (isFull || !userMap) userMap = await fetchUsers().catch(() => userMap ?? {});
    if (!isFull && !changed) {
      setIndexMeta("notion", { users: userMap, lastSync: Date.now() });
      return;
    }
    setIndex("notion", [...map.values()], {
      ...idx.meta,
      users: userMap,
      lastSync: Date.now(),
      lastFull: isFull ? Date.now() : idx.meta.lastFull,
    });
  },

  appTarget: {
    name: "Notion",
    process: "Notion.exe",
    scheme: "notion",
    mode: () => settings().notionOpen,
  },
};
