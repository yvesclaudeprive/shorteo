import { qs, mapLimit } from "../app/http";
import { settings, fillTemplate } from "../app/settings";
import { getIndex, setIndex } from "../app/index-store";
import { decodeEntities, fullDate, relativeDate } from "../app/format";
import { norm } from "../app/search";
import { platform } from "../app/platform";
import { quoteIfNeeded } from "../app/query";
import { gapi } from "./google";
import { demoLive } from "./demo";
import type { Completion, OperatorValue, ParsedQuery, ResultItem, SourceDef } from "./types";

/**
 * Mails : la recherche passe en direct par Gmail (mêmes opérateurs que Superhuman),
 * les résultats s'ouvrent dans Superhuman. Aucun mail n'est stocké localement :
 * seuls les contacts (noms + adresses) et les libellés sont gardés pour l'autocomplétion.
 */

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SUPERHUMAN_WEB = "https://mail.superhuman.com/";

interface Contact {
  n: string;
  e: string;
}

function contacts(): Contact[] {
  return (getIndex("contacts").meta.list as Contact[] | undefined) ?? [];
}

function labels(): string[] {
  return (getIndex("contacts").meta.labels as string[] | undefined) ?? [];
}

function contactValues(): OperatorValue[] {
  return [
    { value: "me", label: "Moi", aliases: ["moi"] },
    ...contacts().map((c) => ({ value: c.e, label: c.n || c.e, detail: c.n ? c.e : undefined })),
  ];
}

function dateValues(): OperatorValue[] {
  const d = (offsetDays: number) => {
    const x = new Date(Date.now() - offsetDays * 86400000);
    return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, "0")}/${String(x.getDate()).padStart(2, "0")}`;
  };
  const now = new Date();
  const monthStart = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/01`;
  return [
    { value: d(1), label: "Hier" },
    { value: d(7), label: "Il y a 7 jours" },
    { value: d(30), label: "Il y a 30 jours" },
    { value: monthStart, label: "Début du mois" },
    { value: `${now.getFullYear()}/01/01`, label: "Début de l'année" },
  ];
}

/** Alias français → opérateurs Gmail. */
const OPERATORS = [
  { key: "from", aliases: ["de", "from", "expediteur"], label: "Expéditeur", values: contactValues },
  { key: "to", aliases: ["à", "a", "to", "pour"], label: "Destinataire", values: contactValues },
  { key: "cc", aliases: ["cc"], label: "En copie", values: contactValues },
  { key: "subject", aliases: ["objet", "subject", "sujet"], label: "Objet" },
  {
    key: "has",
    strict: true,
    aliases: ["avec", "has"],
    label: "Contient",
    values: () => [
      { value: "attachment", label: "Pièce jointe", aliases: ["pj", "piece-jointe"] },
      { value: "drive", label: "Fichier Drive" },
      { value: "document", label: "Google Docs" },
      { value: "spreadsheet", label: "Google Sheets" },
      { value: "presentation", label: "Google Slides" },
      { value: "youtube", label: "Vidéo YouTube" },
      { value: "userlabels", label: "Un libellé" },
    ],
  },
  {
    key: "is",
    strict: true,
    aliases: ["est", "is"],
    label: "État",
    values: () => [
      { value: "unread", label: "Non lu", aliases: ["nonlu", "non-lu"] },
      { value: "read", label: "Lu", aliases: ["lu"] },
      { value: "starred", label: "Suivi", aliases: ["suivi", "etoile"] },
      { value: "important", label: "Important" },
      { value: "snoozed", label: "Reporté", aliases: ["reporte"] },
      { value: "muted", label: "Ignoré", aliases: ["ignore"] },
    ],
  },
  {
    key: "in",
    strict: true,
    aliases: ["dans", "in"],
    label: "Dossier",
    values: () => [
      { value: "inbox", label: "Boîte de réception", aliases: ["reception"] },
      { value: "sent", label: "Envoyés", aliases: ["envoyes"] },
      { value: "drafts", label: "Brouillons", aliases: ["brouillons"] },
      { value: "anywhere", label: "Partout (archives incluses)", aliases: ["partout", "tout"] },
      { value: "trash", label: "Corbeille", aliases: ["corbeille"] },
      { value: "spam", label: "Spam" },
    ],
  },
  {
    key: "label",
    aliases: ["libellé", "label"],
    label: "Libellé",
    values: () => labels().map((l) => ({ value: l })),
  },
  { key: "after", aliases: ["après", "depuis", "after"], label: "Après le", values: dateValues },
  { key: "before", aliases: ["avant", "before"], label: "Avant le", values: dateValues },
  {
    key: "newer_than",
    aliases: ["récent", "newer_than"],
    label: "Plus récent que",
    values: () => [
      { value: "1d", label: "1 jour" },
      { value: "7d", label: "7 jours" },
      { value: "1m", label: "1 mois" },
      { value: "1y", label: "1 an" },
    ],
  },
  {
    key: "older_than",
    aliases: ["ancien", "older_than"],
    label: "Plus ancien que",
    values: () => [
      { value: "7d", label: "7 jours" },
      { value: "1m", label: "1 mois" },
      { value: "1y", label: "1 an" },
    ],
  },
  {
    key: "filename",
    aliases: ["fichier", "filename"],
    label: "Pièce jointe nommée",
    values: () => ["pdf", "docx", "xlsx", "pptx", "csv", "png", "jpg", "zip"].map((v) => ({ value: v })),
  },
  {
    key: "larger",
    aliases: ["taille", "larger"],
    label: "Plus lourd que",
    values: () => ["1M", "5M", "10M", "25M"].map((v) => ({ value: v })),
  },
  {
    key: "category",
    strict: true,
    aliases: ["catégorie", "category"],
    label: "Catégorie",
    values: () => [
      { value: "primary", label: "Principale" },
      { value: "social", label: "Réseaux sociaux" },
      { value: "promotions", label: "Promotions" },
      { value: "updates", label: "Notifications" },
      { value: "forums", label: "Forums" },
    ],
  },
];

/** Construit la requête Gmail (opérateurs traduits + texte libre conservé). */
export function toGmailQuery(q: ParsedQuery): string {
  const parts: string[] = [];
  for (const o of q.ops) parts.push(`${o.negate ? "-" : ""}${o.key}:${quoteIfNeeded(o.value)}`);
  parts.push(...q.unknown);
  const free = q.raw
    .split(/\s+/)
    .filter((w) => w && !/^-?[\p{L}_]+:/u.test(w));
  parts.push(...free);
  return parts.join(" ").trim();
}

function header(msg: any, name: string): string {
  const h = msg?.payload?.headers?.find((x: any) => String(x.name).toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function parseAddress(v: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>/.exec(v);
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim() };
  return { name: v.trim(), email: v.trim() };
}

export function superhumanLinks(threadId: string): { url: string; app?: string } {
  const s = settings();
  const url = fillTemplate(s.superhumanThreadUrl || "https://mail.superhuman.com/{email}/thread/{threadId}", {
    email: s.mailAccount,
    threadId,
  }).replace(/%40/g, "@");
  const app = url.startsWith(SUPERHUMAN_WEB) ? `superhuman://${url.slice(SUPERHUMAN_WEB.length)}` : undefined;
  return { url, app };
}

function threadToItem(th: any): ResultItem {
  const msgs: any[] = th.messages ?? [];
  const first = msgs[0];
  const last = msgs[msgs.length - 1];
  const people: string[] = [];
  for (const m of msgs) {
    const p = parseAddress(header(m, "From"));
    const short = p.name.split(/\s+/)[0] || p.email;
    if (!people.includes(short)) people.push(short);
  }
  const from = parseAddress(header(last, "From"));
  const links = superhumanLinks(th.id);
  return {
    id: th.id,
    source: "mail",
    kind: "thread",
    title: header(first, "Subject") || "(sans objet)",
    url: links.url,
    app: links.app,
    t: Number(last?.internalDate) || undefined,
    snippet: decodeEntities(last?.snippet ?? ""),
    unread: msgs.some((m) => m.labelIds?.includes("UNREAD")),
    f: {
      from: from.name,
      fe: from.email,
      to: header(first, "To"),
      people: people.slice(0, 4).join(", "),
      n: msgs.length,
      star: msgs.some((m) => m.labelIds?.includes("STARRED")) ? 1 : 0,
      imp: msgs.some((m) => m.labelIds?.includes("IMPORTANT")) ? 1 : 0,
    },
  };
}

async function searchThreads(gq: string, limit: number): Promise<ResultItem[]> {
  const list = await gapi<any>(`${GMAIL}/threads?${qs({ q: gq, maxResults: limit })}`);
  const threads: any[] = list.threads ?? [];
  const details = await mapLimit(threads, 8, (t) =>
    gapi<any>(
      `${GMAIL}/threads/${t.id}?${qs({
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
        fields: "id,messages(id,labelIds,internalDate,snippet,payload/headers)",
      })}`,
    ).catch(() => null),
  );
  return details.filter(Boolean).map(threadToItem);
}

async function fetchPaged(base: string, key: string, max = 20000): Promise<any[]> {
  const out: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gapi<any>(`${base}${base.includes("?") ? "&" : "?"}${qs({ pageSize: 1000, pageToken })}`);
    out.push(...(res[key] ?? []));
    pageToken = res.nextPageToken;
  } while (pageToken && out.length < max);
  return out;
}

function toContacts(people: any[], into: Map<string, Contact>) {
  for (const p of people) {
    const name = p.names?.[0]?.displayName ?? "";
    for (const e of p.emailAddresses ?? []) {
      const email = String(e.value ?? "").toLowerCase();
      if (!email || into.has(email)) continue;
      into.set(email, { n: name, e: email });
    }
  }
}

export const mailSource: SourceDef = {
  key: "mail",
  label: "Mails",
  color: "#a78bfa",
  placeholder: "Mails (de:, à:, objet:, avec:pj, après:…)",
  operators: OPERATORS,
  filterBar: ["from", "to", "is", "has", "in", "newer_than", "label"],
  chips: [
    { label: "Non lus", op: "is", value: "unread" },
    { label: "Avec PJ", op: "has", value: "attachment" },
    { label: "Suivis", op: "is", value: "starred" },
    { label: "Envoyés", op: "in", value: "sent" },
    { label: "Partout", op: "in", value: "anywhere" },
    { label: "7 jours", op: "newer_than", value: "7d" },
    { label: "30 jours", op: "newer_than", value: "1m" },
  ],
  configured: () => settings().connected.google,

  wantsLive: (q) => q.raw.trim().length >= 2,

  async liveSearch(q, limit) {
    if (platform.demo) return demoLive("mail", q);
    return searchThreads(toGmailQuery(q) || "in:inbox", Math.min(limit, 25));
  },

  async emptyResults() {
    if (platform.demo) return demoLive("mail", { raw: "", text: "", tokens: [], ops: [], unknown: [], exact: false });
    if (!settings().connected.google) return [];
    return searchThreads("in:inbox", 15);
  },

  textCompletions(token): Completion[] {
    const t = norm(token);
    if (t.length < 2 || token.includes(":")) return [];
    const hits = contacts()
      .filter((c) => norm(c.n).split(/\s+/).some((w) => w.startsWith(t)) || c.e.startsWith(t))
      .slice(0, 4);
    return hits.map((c) => ({
      label: `Mails de ${c.n || c.e}`,
      detail: c.e,
      insert: `de:${c.e} `,
      kind: "contact" as const,
    }));
  },

  nativeSearch(q) {
    const s = settings();
    const gq = toGmailQuery(q);
    if (s.superhumanSearchUrl) {
      const url = fillTemplate(s.superhumanSearchUrl, { q: gq, email: s.mailAccount }).replace(/%40/g, "@");
      return {
        label: "Rechercher dans Superhuman",
        url,
        app: url.startsWith(SUPERHUMAN_WEB) ? `superhuman://${url.slice(SUPERHUMAN_WEB.length)}` : undefined,
      };
    }
    return {
      label: "Rechercher dans Superhuman",
      url: SUPERHUMAN_WEB,
      app: "superhuman://",
      copy: gq,
      hint: "Requête copiée : dans Superhuman, appuyez sur / puis Ctrl+V",
    };
  },

  describe(item) {
    const n = item.f?.n ?? 1;
    return {
      sub: `${item.f?.people || item.f?.from || ""}${n > 1 ? ` (${n})` : ""}`,
      meta: relativeDate(item.t),
      badge: item.f?.star ? "Suivi" : item.f?.imp ? "Important" : undefined,
      badgeTone: item.f?.star ? "amber" : "violet",
    };
  },

  details(item) {
    return [
      { label: "De", value: item.f?.fe ? `${item.f.from} <${item.f.fe}>` : item.f?.from ?? "—" },
      { label: "À", value: item.f?.to || "—" },
      { label: "Dernier message", value: fullDate(item.t) },
      { label: "Messages", value: String(item.f?.n ?? 1) },
    ];
  },

  secondaryActions(item) {
    const s = settings();
    return [
      {
        label: "Ouvrir dans Gmail",
        run: () =>
          platform.openUrl(`https://mail.google.com/mail/u/${encodeURIComponent(s.mailAccount || "0")}/#all/${item.id}`),
      },
    ];
  },

  extraNative(q) {
    return [{ label: "Gmail", url: gmailSearchUrl(q) }];
  },

  async sync({ full }) {
    const idx = getIndex("contacts");
    const day = 86400000;
    if (!full && idx.meta.lastSync && Date.now() - idx.meta.lastSync < day) return;
    const map = new Map<string, Contact>();
    const sources = [
      ["https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses", "connections"],
      ["https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses", "otherContacts"],
      [
        "https://people.googleapis.com/v1/people:listDirectoryPeople?readMask=names,emailAddresses&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
        "people",
      ],
    ];
    for (const [url, key] of sources) {
      try {
        toContacts(await fetchPaged(url, key), map);
      } catch {
        /* source indisponible : on continue */
      }
    }
    let labelNames: string[] = idx.meta.labels ?? [];
    try {
      const res = await gapi<any>(`${GMAIL}/labels`);
      labelNames = (res.labels ?? []).filter((l: any) => l.type === "user").map((l: any) => l.name);
    } catch {
      /* ignoré */
    }
    const list = [...map.values()].sort((a, b) => (a.n || a.e).localeCompare(b.n || b.e, "fr"));
    setIndex("contacts", [], { list, labels: labelNames, lastSync: Date.now(), lastFull: Date.now() });
  },

  appTarget: {
    name: "Superhuman",
    process: "Superhuman.exe",
    scheme: "superhuman",
    mode: () => settings().superhumanOpen,
  },
};

export function gmailSearchUrl(q: ParsedQuery): string {
  const s = settings();
  return `https://mail.google.com/mail/u/${encodeURIComponent(s.mailAccount || "0")}/#search/${encodeURIComponent(toGmailQuery(q))}`;
}
