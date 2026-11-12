import { qs } from "../app/http";
import { settings } from "../app/settings";
import { getIndex, indexVersion, searchIndex, setIndex, setIndexMeta, upsertItems } from "../app/index-store";
import { fullDate, inRange, periodRange, PERIOD_VALUES, relativeDate } from "../app/format";
import { norm } from "../app/search";
import { activeFilterLabels, opValues, valueLabel } from "../app/query";
import { platform } from "../app/platform";
import { gapi } from "./google";
import { demoLive } from "./demo";
import type { ParsedQuery, ResultItem, SourceDef, Tone } from "./types";

const API = "https://www.googleapis.com/drive/v3";
const FIELDS =
  "id,name,mimeType,modifiedTime,viewedByMeTime,owners(displayName,emailAddress,me),webViewLink,starred,shared,parents,trashed";

export const DRIVE_KINDS: Record<string, string> = {
  doc: "Docs",
  sheet: "Sheets",
  slides: "Slides",
  pdf: "PDF",
  folder: "Dossier",
  form: "Forms",
  image: "Image",
  video: "Vidéo",
  file: "Fichier",
};

const MIME: Record<string, string[]> = {
  doc: [
    "application/vnd.google-apps.document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ],
  sheet: [
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
  ],
  slides: [
    "application/vnd.google-apps.presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ],
  pdf: ["application/pdf"],
  folder: ["application/vnd.google-apps.folder"],
  form: ["application/vnd.google-apps.form"],
};

/** Correspondance avec les filtres de la recherche Drive sur le web. */
const WEB_TYPE: Record<string, string> = {
  doc: "document",
  sheet: "spreadsheet",
  slides: "presentation",
  pdf: "pdf",
  folder: "folder",
  form: "form",
  image: "image",
  video: "video",
};

function kindOf(m: string): string {
  for (const [k, list] of Object.entries(MIME)) if (list.includes(m)) return k;
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  return "file";
}

function toItem(f: any): ResultItem {
  const owner = f.owners?.[0];
  return {
    id: f.id,
    source: "drive",
    kind: kindOf(f.mimeType ?? ""),
    title: f.name ?? "Sans nom",
    url: f.webViewLink ?? `https://drive.google.com/open?id=${f.id}`,
    t: Date.parse(f.modifiedTime) || undefined,
    f: {
      o: owner?.displayName,
      oe: owner?.emailAddress,
      me: f.owners?.some((x: any) => x.me) ? 1 : 0,
      s: f.starred ? 1 : 0,
      sh: f.shared ? 1 : 0,
      p: f.parents?.[0],
      v: Date.parse(f.viewedByMeTime) || 0,
    },
  };
}

function folderName(id?: string): string | undefined {
  if (!id) return undefined;
  return getIndex("drive").byId.get(id)?.title;
}

// --- Racines : « Mon Drive » et drives partagés (lus en GET, gardés dans l'index) ---

export interface SharedDrive {
  id: string;
  name: string;
}

/** Clé de cache : change quand l'index ou la liste des drives change. */
function cacheKey(): string {
  return `${indexVersion.get().v}:${getIndex("drive").meta.rootsAt ?? 0}`;
}

/** Identifiant du dossier racine « Mon Drive » (si déjà connu). */
export function myDriveRootId(): string | undefined {
  return getIndex("drive").meta.rootId;
}

/** Drives partagés dont vous êtes membre, triés par nom. */
export function sharedDrives(): SharedDrive[] {
  return [...((getIndex("drive").meta.drives as SharedDrive[] | undefined) ?? [])].sort((a, b) => collator.compare(a.name, b.name));
}

function sharedDriveName(id: string): string | undefined {
  return ((getIndex("drive").meta.drives as SharedDrive[] | undefined) ?? []).find((d) => d.id === id)?.name;
}

/** Un drive partagé présenté comme un dossier (pour le filtre et le lien). */
export function sharedDriveItem(d: SharedDrive): ResultItem {
  return {
    id: d.id,
    source: "drive",
    kind: "folder",
    title: d.name,
    url: `https://drive.google.com/drive/folders/${d.id}`,
    f: { drive: 1 },
  };
}

async function fetchRoots(): Promise<void> {
  const root = await gapi<any>(`${API}/files/root?${qs({ fields: "id" })}`);
  const drives: SharedDrive[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gapi<any>(`${API}/drives?${qs({ pageSize: 100, fields: "nextPageToken,drives(id,name)", pageToken })}`);
    for (const d of res.drives ?? []) drives.push({ id: d.id, name: d.name ?? "Drive partagé" });
    pageToken = res.nextPageToken;
  } while (pageToken && drives.length < 1000);
  setIndexMeta("drive", { rootId: root.id, drives, rootsAt: Date.now() });
}

/** Charge (ou rafraîchit, une fois par jour) la racine « Mon Drive » et les drives partagés. */
export async function ensureDriveRoots(force = false): Promise<boolean> {
  if (platform.demo || !settings().connected.google) return false;
  const at = getIndex("drive").meta.rootsAt ?? 0;
  if (!force && Date.now() - at < 86400000) return false;
  await fetchRoots();
  return true;
}

// --- Dossiers parents (sous-dossiers compris), mis en cache par version d'index ---

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
let chainCache: { k: string; map: Map<string, string[]> } = { k: "", map: new Map() };

/** Noms des dossiers qui contiennent l'élément, du plus proche au plus lointain
 * (le nom du drive partagé en dernier, le cas échéant). */
function folderChain(item: ResultItem): string[] {
  const k = cacheKey();
  if (chainCache.k !== k) chainCache = { k, map: new Map() };
  const hit = chainCache.map.get(item.id);
  if (hit) return hit;
  const idx = getIndex("drive");
  const out: string[] = [];
  const seen = new Set<string>([item.id]);
  let p = item.f?.p as string | undefined;
  for (let i = 0; i < 15 && p && !seen.has(p); i++) {
    seen.add(p);
    const f = idx.byId.get(p);
    if (!f) {
      const d = sharedDriveName(p);
      if (d) out.push(d);
      break;
    }
    out.push(f.title);
    p = f.f?.p;
  }
  chainCache.map.set(item.id, out);
  return out;
}

const SHORT_LABELS: Record<string, string> = {
  "clients en cours": "Client",
  "prospects en cours": "Prospect",
  "devis type": "Devis type",
  "password client en cours": "Password client",
  "password clients en cours": "Password client",
  "password prospects en cours": "Password prospect",
  "password prospect en cours": "Password prospect",
};
const TAG_TONES: Tone[] = ["green", "blue", "violet", "amber", "red"];

/** Étiquette courte d'un raccourci (« Clients en cours » → « Client »). */
export function shortcutLabel(name: string): string {
  return SHORT_LABELS[norm(name.trim())] ?? name.replace(/\s+en\s+cours$/i, "").trim();
}

/** Étiquettes d'un fichier : raccourcis (dossiers ou fichiers) auxquels il appartient. */
function shortcutTags(item: ResultItem): Array<{ label: string; tone: Tone }> {
  const favs = settings().driveFavorites;
  if (!favs.length) return [];
  const chain = folderChain(item).map(norm);
  const title = norm(item.title);
  const out: Array<{ label: string; tone: Tone }> = [];
  favs.forEach((name, i) => {
    const n = norm(name.trim());
    if (title === n || chain.includes(n)) out.push({ label: shortcutLabel(name), tone: TAG_TONES[i % TAG_TONES.length] });
  });
  return out;
}

// --- Arborescence des dossiers ---

export const PATH_SEP = " / ";

/** Chemin d'un dossier, de la racine connue jusqu'à lui (noms). */
export function folderPath(folder: ResultItem): string[] {
  return [...folderChain(folder)].reverse().concat(folder.title);
}

interface Tree {
  k: string;
  /** dossiers par identifiant du parent, triés par nom */
  children: Map<string, ResultItem[]>;
  /** dossiers dont le parent n'est pas un dossier connu */
  top: ResultItem[];
}
let treeCache: Tree = { k: "", children: new Map(), top: [] };

/** Arborescence des dossiers, calculée une fois par version de l'index. */
function tree(): Tree {
  const k = cacheKey();
  if (treeCache.k === k) return treeCache;
  const idx = getIndex("drive");
  const children = new Map<string, ResultItem[]>();
  const top: ResultItem[] = [];
  for (const i of idx.items) {
    if (i.kind !== "folder") continue;
    const p = (i.f?.p as string | undefined) ?? "";
    let list = children.get(p);
    if (!list) children.set(p, (list = []));
    list.push(i);
    const parent = p ? idx.byId.get(p) : undefined;
    if (!parent || parent.kind !== "folder") top.push(i);
  }
  const byName = (a: ResultItem, b: ResultItem) => collator.compare(a.title, b.title);
  for (const list of children.values()) list.sort(byName);
  top.sort(byName);
  treeCache = { k, children, top };
  return treeCache;
}

/** Sous-dossiers d'un dossier (ou dossiers de premier niveau si parentId est null), triés par nom. */
export function childFolders(parentId: string | null): ResultItem[] {
  const t = tree();
  return parentId ? t.children.get(parentId) ?? [] : t.top;
}

/** Nombre de sous-dossiers (sans parcourir l'index). */
export function childCount(parentId: string): number {
  return tree().children.get(parentId)?.length ?? 0;
}

/** Les trois entrées de départ du sélecteur de dossiers. */
export function folderRoots(): { myDrive: ResultItem[]; shared: ResultItem[]; others: ResultItem[] } {
  const t = tree();
  const root = myDriveRootId();
  const drives = sharedDrives();
  const driveIds = new Set(drives.map((d) => d.id));
  const shared = drives.map(sharedDriveItem);
  if (!root) {
    // racine pas encore connue : tout ce qui n'est pas dans un drive partagé
    return { myDrive: t.top.filter((f) => !driveIds.has(f.f?.p)), shared, others: [] };
  }
  return {
    myDrive: t.children.get(root) ?? [],
    shared,
    others: t.top.filter((f) => f.f?.p !== root && !driveIds.has(f.f?.p)),
  };
}

/** Tous les dossiers connus, drives partagés compris. */
function allFolders(): ResultItem[] {
  const t = tree();
  const out: ResultItem[] = sharedDrives().map(sharedDriveItem);
  for (const list of t.children.values()) out.push(...list);
  return out;
}

/** Recherche d'un dossier par son nom (sélecteur de dossiers). */
export function searchFolders(text: string, limit = 80): ResultItem[] {
  const n = norm(text.trim());
  if (!n) return [];
  return allFolders()
    .filter((i) => norm(i.title).includes(n))
    .sort((a, b) => {
      const sa = norm(a.title).startsWith(n) ? 1 : 0;
      const sb = norm(b.title).startsWith(n) ? 1 : 0;
      return sb - sa || (b.t ?? 0) - (a.t ?? 0);
    })
    .slice(0, limit);
}

/** Dossier désigné par une valeur de filtre : nom (« Devis ») ou chemin (« Clients en cours / ACME / Devis »). */
export function folderByValue(value: string): ResultItem | undefined {
  const segs = value.split(PATH_SEP).map((x) => norm(x.trim())).filter(Boolean);
  if (!segs.length) return undefined;
  const folders = allFolders().filter((i) => norm(i.title) === segs[segs.length - 1]);
  if (segs.length === 1) return folders.sort((a, b) => (b.t ?? 0) - (a.t ?? 0))[0];
  return folders.find((f) => {
    const p = folderPath(f).map(norm);
    return p.length >= segs.length && segs.every((s, i) => p[p.length - segs.length + i] === s);
  });
}

/** L'élément est-il dans ce dossier (sous-dossiers compris) ? */
function inFolder(it: ResultItem, value: string): boolean {
  const segs = value.split(PATH_SEP).map((x) => norm(x.trim())).filter(Boolean);
  const chain = [...folderChain(it)].reverse().map(norm);
  if (segs.length === 1) return chain.some((c) => c === segs[0] || c.includes(segs[0]));
  for (let i = 0; i + segs.length <= chain.length; i++) {
    if (segs.every((s, k) => chain[i + k] === s)) return true;
  }
  return false;
}

/** Raccourcis Drive des paramètres, retrouvés par leur nom dans l'index. */
export function driveShortcuts(): Array<{ name: string; item?: ResultItem }> {
  const items = getIndex("drive").items;
  return settings().driveFavorites.map((name) => {
    const n = norm(name.trim());
    const matches = items.filter((i) => norm(i.title) === n);
    const item =
      matches.find((i) => i.kind === "folder") ??
      matches.sort((a, b) => (b.t ?? 0) - (a.t ?? 0))[0];
    return { name, item };
  });
}

let valuesCache: { k: string; list: Array<{ value: string; label: string; detail?: string }> } = { k: "", list: [] };

/** Valeurs du filtre « Dossier » (récents d'abord), calculées une fois par version de l'index. */
function folderValues() {
  const k = cacheKey();
  if (valuesCache.k === k) return valuesCache.list;
  const list = allFolders()
    .sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
    .slice(0, 400)
    .map((i) => {
      const path = folderPath(i);
      return { value: path.join(PATH_SEP), label: i.title, detail: path.slice(0, -1).join(" › ") || undefined };
    });
  valuesCache = { k, list };
  return list;
}

function owners(): Array<{ value: string; detail?: string }> {
  const count = new Map<string, { n: number; e?: string }>();
  for (const it of getIndex("drive").items) {
    const o = it.f?.o;
    if (!o || it.f?.me) continue;
    const c = count.get(o) ?? { n: 0, e: it.f?.oe };
    c.n++;
    count.set(o, c);
  }
  return [...count.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 40)
    .map(([value, c]) => ({ value, detail: c.e }));
}


/** Plage de dates du premier filtre de ce type présent dans la requête. */
function rangeOf(q: ParsedQuery, key: string) {
  for (const v of opValues(q, key)) {
    const r = periodRange(v);
    if (r) return r;
  }
  return null;
}

function applyFilters(q: ParsedQuery): (it: ResultItem) => boolean {
  const types = opValues(q, "type");
  const own = opValues(q, "owner").map(norm);
  const period = rangeOf(q, "modifie");
  const flags = opValues(q, "is");
  const folders = opValues(q, "dossier");
  return (it) => {
    if (types.length && !types.includes(it.kind)) return false;
    if (own.length) {
      const ok = own.some((o) =>
        o === "moi" || o === "me" ? it.f?.me : norm(`${it.f?.o ?? ""} ${it.f?.oe ?? ""}`).includes(o),
      );
      if (!ok) return false;
    }
    if (period && !inRange(it.t, period)) return false;
    if (flags.includes("suivi") && !it.f?.s) return false;
    if (flags.includes("partage") && !it.f?.sh) return false;
    // dans le dossier ou l'un de ses sous-dossiers
    if (folders.length && !folders.some((f) => inFolder(it, f))) return false;
    return true;
  };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function folderIdByName(name: string): string | undefined {
  return folderByValue(name)?.id;
}

function liveQuery(q: ParsedQuery): string {
  const parts = ["trashed = false"];
  if (q.text) parts.push(`fullText contains '${esc(q.text)}'`);
  const types = opValues(q, "type");
  if (types.length) {
    const ors = types.flatMap((t) =>
      MIME[t]
        ? MIME[t].map((m) => `mimeType = '${m}'`)
        : t === "image" || t === "video"
          ? [`mimeType contains '${t}/'`]
          : [],
    );
    if (ors.length) parts.push(`(${ors.join(" or ")})`);
  }
  for (const o of opValues(q, "owner")) {
    if (norm(o) === "moi" || norm(o) === "me") parts.push("'me' in owners");
  }
  const period = rangeOf(q, "modifie");
  if (period?.from !== undefined) parts.push(`modifiedTime > '${new Date(period.from).toISOString()}'`);
  if (period?.to !== undefined) parts.push(`modifiedTime < '${new Date(period.to).toISOString()}'`);
  if (opValues(q, "is").includes("suivi")) parts.push("starred = true");
  return parts.join(" and ");
}

export const driveSource: SourceDef = {
  key: "drive",
  label: "Drive",
  color: "#4c8bf5",
  placeholder: "Fichiers et dossiers Google Drive…",
  operators: [
    {
      key: "type",
      strict: true,
      multi: true,
      aliases: ["type"],
      label: "Type de fichier",
      values: () => [
        { value: "doc", label: "Documents", aliases: ["docs", "document", "word"] },
        { value: "sheet", label: "Feuilles de calcul", aliases: ["sheets", "tableur", "excel", "xls"] },
        { value: "slides", label: "Présentations", aliases: ["presentation", "ppt", "powerpoint"] },
        { value: "pdf", label: "PDF" },
        { value: "folder", label: "Dossiers", aliases: ["dossier"] },
        { value: "form", label: "Formulaires", aliases: ["forms", "formulaire"] },
        { value: "image", label: "Images", aliases: ["photo"] },
        { value: "video", label: "Vidéos", aliases: ["vidéo"] },
      ],
    },
    {
      key: "owner",
      multi: true,
      aliases: ["proprio", "owner", "propriétaire"],
      label: "Propriétaire",
      values: () => [{ value: "moi", label: "Moi" }, ...owners()],
    },
    { key: "modifie", aliases: ["modifié", "modif", "after"], label: "Modifié", values: () => PERIOD_VALUES, dates: true },
    {
      key: "is",
      strict: true,
      multi: true,
      aliases: ["est", "is"],
      label: "Statut",
      values: () => [
        { value: "suivi", label: "Suivi (étoile)", aliases: ["starred", "etoile"] },
        { value: "partage", label: "Partagé", aliases: ["partagé", "shared"] },
      ],
    },
    {
      key: "dossier",
      multi: true,
      aliases: ["dossier", "dans", "in"],
      label: "Dossier",
      values: () => folderValues(),
    },
  ],
  filterBar: ["type", "owner", "modifie", "dossier", "is"],
  chips: [
    { label: "Docs", op: "type", value: "doc" },
    { label: "Sheets", op: "type", value: "sheet" },
    { label: "Slides", op: "type", value: "slides" },
    { label: "PDF", op: "type", value: "pdf" },
    { label: "Dossiers", op: "type", value: "folder" },
    { label: "À moi", op: "owner", value: "moi" },
    { label: "Suivis", op: "is", value: "suivi" },
    { label: "30 jours", op: "modifie", value: "30j" },
  ],
  configured: () => settings().connected.google,
  nativeFirst: true,

  localSearch(q, limit) {
    return searchIndex("drive", q.tokens, applyFilters(q), limit);
  },

  wantsLive: (q) => q.text.length >= 2,

  async liveSearch(q, limit) {
    if (platform.demo) return demoLive("drive", q);
    const params: Record<string, any> = {
      q: liveQuery(q),
      pageSize: Math.min(limit, 30),
      fields: `files(${FIELDS})`,
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    };
    const base = liveQuery(q);
    const queries = [base];
    for (const d of opValues(q, "dossier")) {
      const id = folderIdByName(d);
      if (id) queries.push(`${base} and '${id}' in parents`);
    }
    const lists = await Promise.all(
      queries.map((qq) => gapi<any>(`${API}/files?${qs({ ...params, q: qq })}`).then((r) => (r.files ?? []).map(toItem))),
    );
    const seen = new Set<string>();
    const items: ResultItem[] = [];
    for (const it of lists.flat()) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }
    upsertItems("drive", items);
    return items.filter(applyFilters(q));
  },

  emptyResults() {
    const items = [...getIndex("drive").items]
      .filter((i) => i.f?.v)
      .sort((a, b) => (b.f?.v ?? 0) - (a.f?.v ?? 0))
      .slice(0, 12);
    return items.length ? items : searchIndex("drive", [], null, 12);
  },

  nativeSearch(q) {
    // Drive sur le web : un seul type, un seul propriétaire, un seul dossier à la fois
    const parts: string[] = [];
    const dropped: string[] = [];
    const op = (k: string) => driveSource.operators.find((o) => o.key === k)!;
    if (q.text) parts.push(q.text);
    const types = opValues(q, "type");
    if (types.length === 1 && WEB_TYPE[types[0]]) parts.push(`type:${WEB_TYPE[types[0]]}`);
    else if (types.length > 1) dropped.push(...activeFilterLabels(q, driveSource, ["type"]));
    const own = opValues(q, "owner");
    if (own.length === 1) {
      const n = norm(own[0]);
      const e = n === "moi" || n === "me" ? "me" : owners().find((x) => norm(x.value) === n)?.detail;
      if (e) parts.push(`owner:${e}`);
      else dropped.push(...activeFilterLabels(q, driveSource, ["owner"]));
    } else if (own.length > 1) dropped.push(...activeFilterLabels(q, driveSource, ["owner"]));
    const flags = opValues(q, "is");
    if (flags.includes("suivi")) parts.push("is:starred");
    if (flags.includes("partage")) dropped.push(`${op("is").label} : ${valueLabel(op("is"), "partage")}`);
    const period = rangeOf(q, "modifie");
    if (period?.from !== undefined) parts.push(`after:${new Date(period.from).toISOString().slice(0, 10)}`);
    if (period?.to !== undefined) parts.push(`before:${new Date(period.to).toISOString().slice(0, 10)}`);
    // dossier : sans autre critère, on ouvre le dossier ; sinon recherche limitée à ce dossier
    const folders = opValues(q, "dossier")
      .map(folderByValue)
      .filter((f): f is ResultItem => !!f);
    if (folders.length > 1) dropped.push(...activeFilterLabels(q, driveSource, ["dossier"]));
    const folder = folders.length === 1 ? folders[0] : undefined;
    if (folder && !parts.length) {
      const label = `Ouvrir le dossier « ${folder.title} » dans Drive`;
      return { label, title: label, url: `https://drive.google.com/drive/folders/${folder.id}`, dropped };
    }
    if (folder) parts.push(`parent:${folder.id}`);
    return {
      label: "Rechercher dans Drive",
      title: parts.length ? undefined : "Ouvrir Google Drive",
      url: parts.length ? `https://drive.google.com/drive/search?q=${encodeURIComponent(parts.join(" "))}` : "https://drive.google.com/drive/my-drive",
      copy: undefined,
      dropped,
    };
  },

  describe(item) {
    const tags = shortcutTags(item);
    const owner = item.f?.me ? "Moi" : item.f?.o;
    const folder = folderName(item.f?.p);
    return {
      sub: [owner, folder ? `📁 ${folder}` : undefined].filter(Boolean).join(" · ") || undefined,
      meta: relativeDate(item.t),
      tags,
      badge: DRIVE_KINDS[item.kind] ?? "Fichier",
      badgeTone:
        item.kind === "sheet" ? "green" : item.kind === "doc" ? "blue" : item.kind === "slides" ? "amber" : item.kind === "pdf" ? "red" : "gray",
    };
  },

  details(item) {
    const rows = [
      { label: "Type", value: DRIVE_KINDS[item.kind] ?? "Fichier" },
      { label: "Propriétaire", value: item.f?.me ? "Moi" : item.f?.o ?? "—" },
      { label: "Modifié", value: fullDate(item.t) },
    ];
    const folder = folderName(item.f?.p);
    if (folder) rows.push({ label: "Dossier", value: folder });
    if (item.f?.v) rows.push({ label: "Ouvert par vous", value: fullDate(item.f.v) });
    rows.push({ label: "Partage", value: item.f?.sh ? "Partagé" : "Privé" });
    return rows;
  },

  async sync({ full, progress }) {
    const idx = getIndex("drive");
    const max = settings().driveMaxItems;
    await ensureDriveRoots(full).catch(() => {});
    if (full || !idx.items.length || !idx.meta.changeToken) {
      const start = await gapi<any>(`${API}/changes/startPageToken?supportsAllDrives=true`);
      const items: ResultItem[] = [];
      let pageToken: string | undefined;
      do {
        const res = await gapi<any>(
          `${API}/files?${qs({
            q: "trashed = false",
            pageSize: 1000,
            fields: `nextPageToken,files(${FIELDS})`,
            corpora: "allDrives",
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            orderBy: "modifiedTime desc",
            pageToken,
          })}`,
        );
        for (const f of res.files ?? []) items.push(toItem(f));
        progress(`Drive : ${items.length.toLocaleString("fr-FR")} fichiers`);
        pageToken = res.nextPageToken;
      } while (pageToken && items.length < max);
      setIndex("drive", items, {
        ...idx.meta,
        changeToken: start.startPageToken,
        lastSync: Date.now(),
        lastFull: Date.now(),
      });
      return;
    }
    const map = new Map<string, ResultItem>(idx.items.map((i) => [i.id, i]));
    let token: string | undefined = idx.meta.changeToken;
    let newToken = token;
    let changes = 0;
    while (token) {
      const res: any = await gapi<any>(
        `${API}/changes?${qs({
          pageToken: token,
          pageSize: 1000,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))`,
        })}`,
      );
      for (const c of res.changes ?? []) {
        changes++;
        if (c.removed || !c.file || c.file.trashed) map.delete(c.fileId);
        else map.set(c.fileId, toItem(c.file));
      }
      if (res.nextPageToken) token = res.nextPageToken;
      else {
        newToken = res.newStartPageToken ?? newToken;
        token = undefined;
      }
    }
    if (changes) setIndex("drive", [...map.values()], { ...idx.meta, changeToken: newToken, lastSync: Date.now() });
    else setIndexMeta("drive", { changeToken: newToken, lastSync: Date.now() });
  },
};
