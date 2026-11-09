import { request, NotConfiguredError } from "../app/http";
import { getSecret } from "../app/secrets";
import { settings, fillTemplate } from "../app/settings";
import { getIndex, searchIndex, setIndex, setIndexMeta, upsertItems } from "../app/index-store";
import { fullDate, periodMs, PERIOD_VALUES, relativeDate } from "../app/format";
import { norm } from "../app/search";
import { opValues } from "../app/query";
import { platform } from "../app/platform";
import { demoLive } from "./demo";
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

export async function testNotion(): Promise<string> {
  const me = await notion<any>("/users/me");
  const name = me?.bot?.workspace_name ?? me?.name ?? "Notion";
  return `Connecté à l'espace « ${name} »`;
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
      c: Date.parse(r.created_time) || undefined,
    },
  };
}

function users(): Record<string, string> {
  return getIndex("notion").meta.users ?? {};
}

function parentTitle(item: ResultItem): string | undefined {
  const idx = getIndex("notion");
  const p = item.f?.p;
  if (!p) return undefined;
  const direct = idx.byId.get(p);
  if (direct) return direct.title;
  // Page d'une base : le parent est la « data source », retrouvée via l'id de base
  for (const it of idx.items) if (it.f?.db === p) return it.title;
  return undefined;
}

function applyFilters(q: ParsedQuery): (it: ResultItem) => boolean {
  const types = opValues(q, "type");
  const by = opValues(q, "par").map(norm);
  const period = opValues(q, "modifie")
    .map(periodMs)
    .find((x) => x !== null);
  const inside = opValues(q, "dans").map(norm);
  const userMap = users();
  return (it) => {
    if (types.length && !types.includes(it.kind === "database" ? "base" : "page")) return false;
    if (period && (!it.t || it.t < Date.now() - period)) return false;
    if (by.length) {
      const name = norm(userMap[it.f?.cb] ?? "");
      if (!by.some((b) => name.includes(b))) return false;
    }
    if (inside.length) {
      const pt = norm(parentTitle(it) ?? "");
      if (!inside.some((d) => pt.includes(d))) return false;
    }
    return true;
  };
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
  color: "#e6e6e6",
  placeholder: "Pages et bases Notion…",
  operators: [
    {
      key: "type",
      strict: true,
      aliases: ["type"],
      label: "Type",
      values: () => [
        { value: "page", label: "Page" },
        { value: "base", label: "Base de données", aliases: ["database", "db", "bdd"] },
      ],
    },
    {
      key: "par",
      aliases: ["par", "auteur", "by"],
      label: "Créé par",
      values: () => Object.values(users()).map((n) => ({ value: n })),
    },
    { key: "modifie", aliases: ["modifié", "modif", "edited"], label: "Modifié depuis", values: () => PERIOD_VALUES },
    {
      key: "dans",
      aliases: ["dans", "in"],
      label: "Dans la page / base",
      values: () =>
        getIndex("notion")
          .items.filter((i) => i.kind === "database")
          .slice(0, 60)
          .map((i) => ({ value: i.title })),
    },
    {
      key: "tri",
      strict: true,
      aliases: ["tri", "sort"],
      label: "Tri",
      values: () => [
        { value: "recent", label: "Les plus récents", aliases: ["récent", "date"] },
        { value: "pertinence", label: "Pertinence" },
      ],
    },
  ],
  chips: [
    { label: "Pages", op: "type", value: "page" },
    { label: "Bases", op: "type", value: "base" },
    { label: "7 jours", op: "modifie", value: "7j" },
    { label: "30 jours", op: "modifie", value: "30j" },
    { label: "Récents d'abord", op: "tri", value: "recent" },
  ],
  configured: () => settings().connected.notion,

  localSearch(q, limit) {
    return searchIndex("notion", q.tokens, applyFilters(q), limit, opValues(q, "tri").includes("recent"));
  },

  wantsLive: (q) => q.text.length >= 2,

  async liveSearch(q, limit) {
    if (platform.demo) return demoLive("notion", q);
    const types = opValues(q, "type");
    const filter =
      types.length === 1 ? { property: "object", value: types[0] === "base" ? "data_source" : "page" } : undefined;
    const res = await notion<any>("/search", { query: q.text, page_size: Math.min(limit, 30), filter });
    const items = (res.results ?? [])
      .filter((r: any) => !r.in_trash && !r.archived && !r.is_archived)
      .map(toItem);
    upsertItems("notion", items);
    return items.filter(applyFilters(q));
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
      copy: q.text || q.raw,
      hint: "Requête copiée : dans Notion, faites Ctrl+K puis Ctrl+V",
    };
  },

  describe(item) {
    const parent = parentTitle(item);
    return {
      sub: parent ? `Dans ${parent}` : item.kind === "database" ? "Base de données" : undefined,
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
    const parent = parentTitle(item);
    if (parent) rows.push({ label: "Emplacement", value: parent });
    const author = users()[item.f?.cb];
    if (author) rows.push({ label: "Créé par", value: author });
    if (item.f?.c) rows.push({ label: "Créé le", value: fullDate(item.f.c) });
    return rows;
  },

  async sync({ full, progress }) {
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
