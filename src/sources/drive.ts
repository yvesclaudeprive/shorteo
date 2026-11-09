import { qs } from "../app/http";
import { settings } from "../app/settings";
import { getIndex, searchIndex, setIndex, setIndexMeta, upsertItems } from "../app/index-store";
import { fullDate, periodMs, PERIOD_VALUES, relativeDate } from "../app/format";
import { norm } from "../app/search";
import { opValues } from "../app/query";
import { platform } from "../app/platform";
import { gapi } from "./google";
import { demoLive } from "./demo";
import type { ParsedQuery, ResultItem, SourceDef } from "./types";

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

function applyFilters(q: ParsedQuery): (it: ResultItem) => boolean {
  const types = opValues(q, "type");
  const own = opValues(q, "owner").map(norm);
  const period = opValues(q, "modifie")
    .map(periodMs)
    .find((x) => x !== null);
  const flags = opValues(q, "is");
  const folders = opValues(q, "dossier").map(norm);
  return (it) => {
    if (types.length && !types.includes(it.kind)) return false;
    if (own.length) {
      const ok = own.some((o) =>
        o === "moi" || o === "me" ? it.f?.me : norm(`${it.f?.o ?? ""} ${it.f?.oe ?? ""}`).includes(o),
      );
      if (!ok) return false;
    }
    if (period && (!it.t || it.t < Date.now() - period)) return false;
    if (flags.includes("suivi") && !it.f?.s) return false;
    if (flags.includes("partage") && !it.f?.sh) return false;
    if (folders.length) {
      const fn = norm(folderName(it.f?.p) ?? "");
      if (!folders.some((f) => fn.includes(f))) return false;
    }
    return true;
  };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function folderIdByName(name: string): string | undefined {
  const n = norm(name);
  return getIndex("drive").items.find((i) => i.kind === "folder" && norm(i.title) === n)?.id;
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
  const period = opValues(q, "modifie")
    .map(periodMs)
    .find((x) => x !== null);
  if (period) parts.push(`modifiedTime > '${new Date(Date.now() - period).toISOString()}'`);
  if (opValues(q, "is").includes("suivi")) parts.push("starred = true");
  for (const d of opValues(q, "dossier")) {
    const id = folderIdByName(d);
    if (id) parts.push(`'${id}' in parents`);
  }
  return parts.join(" and ");
}

export const driveSource: SourceDef = {
  key: "drive",
  label: "Drive",
  color: "#1fa463",
  placeholder: "Fichiers et dossiers Google Drive…",
  operators: [
    {
      key: "type",
      strict: true,
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
      aliases: ["proprio", "owner", "propriétaire"],
      label: "Propriétaire",
      values: () => [{ value: "moi", label: "Moi" }, ...owners()],
    },
    { key: "modifie", aliases: ["modifié", "modif", "after"], label: "Modifié depuis", values: () => PERIOD_VALUES },
    {
      key: "is",
      strict: true,
      aliases: ["est", "is"],
      label: "Statut",
      values: () => [
        { value: "suivi", label: "Suivi (étoile)", aliases: ["starred", "etoile"] },
        { value: "partage", label: "Partagé", aliases: ["partagé", "shared"] },
      ],
    },
    {
      key: "dossier",
      aliases: ["dossier", "dans", "in"],
      label: "Dans le dossier",
      values: () =>
        getIndex("drive")
          .items.filter((i) => i.kind === "folder")
          .sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
          .slice(0, 80)
          .map((i) => ({ value: i.title })),
    },
  ],
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
    const res = await gapi<any>(`${API}/files?${qs(params)}`);
    const items = (res.files ?? []).map(toItem);
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
    const parts: string[] = [];
    if (q.text) parts.push(q.text);
    for (const t of opValues(q, "type")) if (WEB_TYPE[t]) parts.push(`type:${WEB_TYPE[t]}`);
    for (const o of opValues(q, "owner")) {
      const n = norm(o);
      if (n === "moi" || n === "me") parts.push("owner:me");
      else {
        const e = owners().find((x) => norm(x.value) === n)?.detail;
        if (e) parts.push(`owner:${e}`);
      }
    }
    if (opValues(q, "is").includes("suivi")) parts.push("is:starred");
    const period = opValues(q, "modifie")
      .map(periodMs)
      .find((x) => x !== null);
    if (period) parts.push(`after:${new Date(Date.now() - period).toISOString().slice(0, 10)}`);
    return {
      label: "Rechercher dans Drive",
      url: `https://drive.google.com/drive/search?q=${encodeURIComponent(parts.join(" "))}`,
    };
  },

  describe(item) {
    const owner = item.f?.me ? "Moi" : item.f?.o;
    const folder = folderName(item.f?.p);
    return {
      sub: [owner, folder ? `📁 ${folder}` : undefined].filter(Boolean).join(" · ") || undefined,
      meta: relativeDate(item.t),
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
