import { request, qs, NotConfiguredError } from "../app/http";
import { getSecret } from "../app/secrets";
import { settings, fillTemplate } from "../app/settings";
import { getIndex, searchIndex, setIndex, upsertItems } from "../app/index-store";
import { fullDate, money, relativeDate } from "../app/format";
import { norm } from "../app/search";
import { opValues } from "../app/query";
import { platform } from "../app/platform";
import { demoLive } from "./demo";
import type { ContactInfo, ParsedQuery, ResultItem, SourceDef } from "./types";

const KIND_LABEL: Record<string, string> = {
  deal: "Affaire",
  person: "Contact",
  organization: "Organisation",
  lead: "Lead",
  product: "Produit",
};

const STATUS_LABEL: Record<string, string> = { open: "En cours", won: "Gagnée", lost: "Perdue" };

function domain(): string {
  return settings().pipedriveDomain.trim().toLowerCase().replace(/\.pipedrive\.com.*$/, "").replace(/[^a-z0-9-]/g, "");
}

function webBase(): string {
  return `https://${domain() || "app"}.pipedrive.com`;
}

async function pd<T = any>(path: string, params: Record<string, any> = {}): Promise<T> {
  const token = await getSecret("pipedrive_token");
  if (!token || !domain()) throw new NotConfiguredError("Pipedrive");
  return request<T>(`https://${domain()}.pipedrive.com/api${path}?${qs({ ...params, api_token: token })}`);
}

export async function testPipedrive(): Promise<string> {
  const me = await pd<any>("/v1/users/me");
  return `Connecté en tant que ${me?.data?.name ?? "utilisateur"} (${me?.data?.company_name ?? domain()})`;
}

function linkFor(kind: string, id: string | number): string {
  const b = webBase();
  switch (kind) {
    case "deal":
      return `${b}/deal/${id}`;
    case "person":
      return `${b}/person/${id}`;
    case "organization":
      return `${b}/organization/${id}`;
    case "lead":
      return `${b}/leads/inbox/${id}`;
    case "product":
      return `${b}/product/${id}`;
    default:
      return b;
  }
}

const idOf = (v: any): number | undefined => (typeof v === "object" && v !== null ? v.id ?? v.value : v) ?? undefined;
const nameOf = (v: any): string | undefined => (typeof v === "object" && v !== null ? v.name : undefined);
const firstValue = (arr: any): string | undefined => {
  if (!Array.isArray(arr) || !arr.length) return undefined;
  const primary = arr.find((x) => x?.primary) ?? arr[0];
  return typeof primary === "string" ? primary : primary?.value;
};
/** Toutes les valeurs d'un champ multiple (e-mails, téléphones), avec leur libellé. */
const allValues = (arr: any): Array<{ v: string; l?: string }> => {
  if (!Array.isArray(arr)) return typeof arr === "string" && arr ? [{ v: arr }] : [];
  const out: Array<{ v: string; l?: string }> = [];
  for (const x of arr) {
    const v = typeof x === "string" ? x : x?.value;
    if (v && !out.some((o) => o.v === v)) out.push({ v: String(v), l: typeof x === "object" ? x?.label : undefined });
  }
  // la valeur principale en premier
  const primary = Array.isArray(arr) ? arr.find((x: any) => x?.primary)?.value : undefined;
  if (primary) out.sort((a, b) => (a.v === primary ? -1 : b.v === primary ? 1 : 0));
  return out;
};

const addressOf = (a: any): string | undefined => (typeof a === "string" ? a : a?.value ?? a?.formatted_address);

function mk(kind: string, id: string | number, title: string, t: any, f: Record<string, any>, text?: string): ResultItem {
  return {
    id: `${kind}-${id}`,
    source: "pipedrive",
    kind,
    title: title || "Sans nom",
    url: linkFor(kind, id),
    t: Date.parse(t) || undefined,
    text,
    f,
  };
}

function fromList(kind: string, r: any): ResultItem {
  switch (kind) {
    case "organization":
      return mk(kind, r.id, r.name, r.update_time, { o: idOf(r.owner_id), addr: addressOf(r.address) }, addressOf(r.address));
    case "person": {
      const email = firstValue(r.emails ?? r.email);
      const phone = firstValue(r.phones ?? r.phone);
      return mk(
        kind,
        r.id,
        r.name,
        r.update_time,
        {
          org: idOf(r.org_id),
          e: email,
          ph: phone,
          em: allValues(r.emails ?? r.email),
          pm: allValues(r.phones ?? r.phone),
          o: idOf(r.owner_id),
        },
        [email, phone, nameOf(r.org_id)].filter(Boolean).join(" "),
      );
    }
    case "deal":
      return mk(kind, r.id, r.title, r.update_time, {
        org: idOf(r.org_id),
        per: idOf(r.person_id),
        st: r.status,
        sg: idOf(r.stage_id),
        v: r.value,
        cur: r.currency,
        o: idOf(r.owner_id ?? r.user_id),
        ec: r.expected_close_date,
      });
    case "lead":
      return mk(kind, r.id, r.title, r.update_time, {
        org: idOf(r.organization_id),
        per: idOf(r.person_id),
        v: r.value?.amount,
        cur: r.value?.currency,
        o: idOf(r.owner_id),
      });
    default:
      return mk(kind, r.id, r.name, r.update_time, { code: r.code }, r.code);
  }
}

/** Résultat de l'API itemSearch (recherche en direct). */
function fromSearch(it: any): ResultItem | null {
  const t = it?.type;
  if (!t || !KIND_LABEL[t]) return null;
  switch (t) {
    case "deal":
      return mk(t, it.id, it.title, undefined, {
        org: it.organization?.id,
        orgName: it.organization?.name,
        per: it.person?.id,
        perName: it.person?.name,
        st: it.status,
        sg: it.stage?.id,
        sgName: it.stage?.name,
        v: it.value,
        cur: it.currency,
        o: it.owner?.id,
      });
    case "person": {
      const email = firstValue(it.emails);
      const phone = firstValue(it.phones);
      return mk(
        t,
        it.id,
        it.name,
        undefined,
        {
          org: it.organization?.id,
          orgName: it.organization?.name,
          e: email,
          ph: phone,
          em: allValues(it.emails),
          pm: allValues(it.phones),
          o: it.owner?.id,
        },
        [email, phone, it.organization?.name].filter(Boolean).join(" "),
      );
    }
    case "organization":
      return mk(t, it.id, it.name, undefined, { addr: addressOf(it.address), o: it.owner?.id }, addressOf(it.address));
    case "lead":
      return mk(t, it.id, it.title, undefined, {
        org: it.organization?.id,
        orgName: it.organization?.name,
        per: it.person?.id,
        perName: it.person?.name,
        v: it.value,
        cur: it.currency,
        o: it.owner?.id,
      });
    default:
      return mk(t, it.id, it.name, undefined, { code: it.code }, it.code);
  }
}

function meta() {
  return getIndex("pipedrive").meta as {
    users?: Record<string, string>;
    stages?: Record<string, { name: string; pipeline?: string }>;
  };
}

function orgName(item: ResultItem): string | undefined {
  if (item.f?.orgName) return item.f.orgName;
  const id = item.f?.org;
  return id ? getIndex("pipedrive").byId.get(`organization-${id}`)?.title : undefined;
}

function personName(item: ResultItem): string | undefined {
  if (item.f?.perName) return item.f.perName;
  const id = item.f?.per;
  return id ? getIndex("pipedrive").byId.get(`person-${id}`)?.title : undefined;
}

function stageName(item: ResultItem): string | undefined {
  if (item.f?.sgName) return item.f.sgName;
  const st = item.f?.sg ? meta().stages?.[item.f.sg] : undefined;
  return st ? (st.pipeline ? `${st.pipeline} › ${st.name}` : st.name) : undefined;
}

function ownerName(item: ResultItem): string | undefined {
  return item.f?.o ? meta().users?.[item.f.o] : undefined;
}

const TYPE_VALUES = [
  { value: "deal", label: "Affaires", aliases: ["affaire", "affaires", "deals"] },
  { value: "person", label: "Contacts", aliases: ["contact", "contacts", "personne", "personnes"] },
  { value: "organization", label: "Organisations", aliases: ["organisation", "org", "societe", "entreprise"] },
  { value: "lead", label: "Leads", aliases: ["leads", "prospect"] },
  { value: "product", label: "Produits", aliases: ["produit", "produits"] },
];

const FIELD_VALUES = [
  { value: "email", label: "E-mail", aliases: ["mail"] },
  { value: "phone", label: "Téléphone", aliases: ["telephone", "tel"] },
  { value: "notes", label: "Notes" },
  { value: "name", label: "Nom", aliases: ["nom"] },
  { value: "title", label: "Titre de l'affaire", aliases: ["titre"] },
  { value: "address", label: "Adresse", aliases: ["adresse"] },
  { value: "custom_fields", label: "Champs personnalisés", aliases: ["perso"] },
];

function applyFilters(q: ParsedQuery): (it: ResultItem) => boolean {
  const types = opValues(q, "type");
  const statuses = opValues(q, "statut");
  const stages = opValues(q, "etape").map(norm);
  const owners = opValues(q, "owner").map(norm);
  const userMap = meta().users ?? {};
  return (it) => {
    if (types.length && !types.includes(it.kind)) return false;
    if (statuses.length && (it.kind !== "deal" || !statuses.includes(it.f?.st))) return false;
    if (stages.length) {
      const sn = norm(stageName(it) ?? "");
      if (!stages.some((s) => sn.includes(s))) return false;
    }
    if (owners.length) {
      const on = norm(userMap[it.f?.o] ?? "");
      if (!owners.some((o) => on.includes(o))) return false;
    }
    return true;
  };
}

async function fetchV2(path: string, params: Record<string, any>, progress: (count: number) => void, out: any[]) {
  let cursor: string | undefined;
  do {
    const res = await pd<any>(path, { ...params, limit: 500, cursor });
    out.push(...(res.data ?? []));
    progress(out.length);
    cursor = res.additional_data?.next_cursor ?? undefined;
  } while (cursor);
}

export const pipedriveSource: SourceDef = {
  key: "pipedrive",
  label: "Pipedrive",
  color: "#22c55e",
  placeholder: "Affaires, contacts, organisations, leads…",
  operators: [
    { key: "type", strict: true, aliases: ["type"], label: "Type", values: () => TYPE_VALUES },
    {
      key: "statut",
      strict: true,
      aliases: ["statut", "status"],
      label: "Statut de l'affaire",
      values: () => [
        { value: "open", label: "En cours", aliases: ["ouvert", "ouverte", "en-cours"] },
        { value: "won", label: "Gagnée", aliases: ["gagne", "gagnee", "signe"] },
        { value: "lost", label: "Perdue", aliases: ["perdu", "perdue"] },
      ],
    },
    {
      key: "etape",
      aliases: ["étape", "stage"],
      label: "Étape du pipeline",
      values: () =>
        Object.values(meta().stages ?? {}).map((s) => ({ value: s.name, detail: s.pipeline })),
    },
    {
      key: "owner",
      aliases: ["proprio", "owner", "propriétaire"],
      label: "Propriétaire",
      values: () => Object.values(meta().users ?? {}).map((n) => ({ value: n })),
    },
    { key: "champ", strict: true, aliases: ["champ", "field"], label: "Chercher dans le champ", values: () => FIELD_VALUES },
  ],
  filterBar: ["type", "statut", "etape", "owner", "champ"],
  chips: [
    { label: "Affaires", op: "type", value: "deal" },
    { label: "Contacts", op: "type", value: "person" },
    { label: "Organisations", op: "type", value: "organization" },
    { label: "Leads", op: "type", value: "lead" },
    { label: "En cours", op: "statut", value: "open" },
    { label: "Gagnées", op: "statut", value: "won" },
    { label: "Perdues", op: "statut", value: "lost" },
  ],
  configured: () => settings().connected.pipedrive,
  nativeFirst: true,

  localSearch(q, limit) {
    return searchIndex("pipedrive", q.tokens, applyFilters(q), limit);
  },

  wantsLive: (q) => q.text.length >= 2 || (q.exact && q.text.length >= 1),

  async liveSearch(q, limit) {
    if (platform.demo) return demoLive("pipedrive", q);
    const types = opValues(q, "type");
    const fields = opValues(q, "champ");
    const res = await pd<any>("/v2/itemSearch", {
      term: q.text,
      item_types: (types.length ? types : ["deal", "person", "organization", "lead", "product"]).join(","),
      fields: fields.length ? fields.join(",") : undefined,
      exact_match: q.exact ? true : undefined,
      limit: Math.min(limit, 30),
    });
    const items = ((res.data?.items ?? []) as any[])
      .map((x) => fromSearch(x.item))
      .filter((x): x is ResultItem => !!x);
    upsertItems(
      "pipedrive",
      items.filter((i) => !getIndex("pipedrive").byId.has(i.id)),
    );
    return items.filter(applyFilters(q));
  },

  emptyResults() {
    return searchIndex("pipedrive", [], (i) => i.kind === "deal" && i.f?.st === "open", 12);
  },

  nativeSearch(q) {
    const tpl = settings().pipedriveSearchUrl;
    if (tpl) return { label: "Rechercher dans Pipedrive", url: fillTemplate(tpl, { q: q.text || q.raw }) };
    return {
      label: "Rechercher dans Pipedrive",
      url: `${webBase()}/`,
      copy: q.text || q.raw,
      recipe: "pipedrive",
      hint: "Ouvre Pipedrive et y lance la recherche (raccourci / de Pipedrive)",
    };
  },

  describe(item) {
    const label = KIND_LABEL[item.kind] ?? "Élément";
    switch (item.kind) {
      case "deal": {
        const st = item.f?.st as string | undefined;
        return {
          sub: [stageName(item), orgName(item) ?? personName(item)].filter(Boolean).join(" · ") || undefined,
          meta: money(item.f?.v, item.f?.cur) || relativeDate(item.t),
          badge: st && st !== "open" ? STATUS_LABEL[st] : label,
          badgeTone: st === "won" ? "green" : st === "lost" ? "red" : "blue",
        };
      }
      case "person":
        return {
          sub: [orgName(item), item.f?.e].filter(Boolean).join(" · ") || undefined,
          meta: relativeDate(item.t),
          badge: label,
          badgeTone: "violet",
        };
      case "organization":
        return { sub: item.f?.addr, meta: relativeDate(item.t), badge: label, badgeTone: "amber" };
      case "lead":
        return {
          sub: [orgName(item), personName(item)].filter(Boolean).join(" · ") || undefined,
          meta: money(item.f?.v, item.f?.cur) || relativeDate(item.t),
          badge: label,
          badgeTone: "green",
        };
      default:
        return { sub: item.f?.code, badge: label, badgeTone: "gray" };
    }
  },

  details(item) {
    const rows = [{ label: "Type", value: KIND_LABEL[item.kind] ?? item.kind }];
    if (item.kind === "deal") {
      if (item.f?.st) rows.push({ label: "Statut", value: STATUS_LABEL[item.f.st] ?? item.f.st });
      const sg = stageName(item);
      if (sg) rows.push({ label: "Étape", value: sg });
      const v = money(item.f?.v, item.f?.cur);
      if (v) rows.push({ label: "Montant", value: v });
      if (item.f?.ec) rows.push({ label: "Clôture prévue", value: item.f.ec });
    }
    if (item.kind === "lead") {
      const v = money(item.f?.v, item.f?.cur);
      if (v) rows.push({ label: "Valeur", value: v });
    }
    const org = orgName(item);
    if (org && item.kind !== "organization") rows.push({ label: "Organisation", value: org });
    const per = personName(item);
    if (per) rows.push({ label: "Contact", value: per });
    if (item.f?.addr) rows.push({ label: "Adresse", value: item.f.addr });
    const owner = ownerName(item);
    if (owner) rows.push({ label: "Propriétaire", value: owner });
    if (item.t) rows.push({ label: "Mis à jour", value: fullDate(item.t) });
    return rows;
  },

  contacts(item) {
    const LABEL: Record<string, string> = { work: "Travail", home: "Domicile", mobile: "Mobile", other: "Autre" };
    const of = (p: ResultItem, who?: string): ContactInfo[] => {
      const em: Array<{ v: string; l?: string }> = p.f?.em?.length ? p.f.em : p.f?.e ? [{ v: p.f.e }] : [];
      const pm: Array<{ v: string; l?: string }> = p.f?.pm?.length ? p.f.pm : p.f?.ph ? [{ v: p.f.ph }] : [];
      return [
        ...pm.map((x) => ({ kind: "phone" as const, value: x.v, label: x.l ? LABEL[x.l] ?? x.l : undefined, who })),
        ...em.map((x) => ({ kind: "email" as const, value: x.v, label: x.l ? LABEL[x.l] ?? x.l : undefined, who })),
      ];
    };
    const idx = getIndex("pipedrive");
    if (item.kind === "person") return of(item);
    if ((item.kind === "deal" || item.kind === "lead") && item.f?.per) {
      const p = idx.byId.get(`person-${item.f.per}`);
      return p ? of(p, p.title) : [];
    }
    if (item.kind === "organization") {
      const id = Number(item.id.replace("organization-", ""));
      return idx.items
        .filter((p) => p.kind === "person" && p.f?.org === id)
        .slice(0, 8)
        .flatMap((p) => of(p, p.title).slice(0, 2));
    }
    return [];
  },

  async sync({ full, progress }) {
    const idx = getIndex("pipedrive");
    const isFull = full || !idx.items.length || idx.meta.schema !== 2;
    const since = isFull ? undefined : new Date((idx.meta.lastSync ?? 0) - 10 * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const LABELS: Record<string, string> = {
      organization: "organisations",
      person: "contacts",
      deal: "affaires",
      product: "produits",
    };

    // Référentiels : utilisateurs, pipelines, étapes
    const users: Record<string, string> = {};
    const stages: Record<string, { name: string; pipeline?: string }> = {};
    try {
      const u = await pd<any>("/v1/users");
      for (const x of u.data ?? []) users[x.id] = x.name;
      const pipes: Record<string, string> = {};
      const pl = await pd<any>("/v2/pipelines");
      for (const x of pl.data ?? []) pipes[x.id] = x.name;
      const sg = await pd<any>("/v2/stages", { limit: 500 });
      const multi = Object.keys(pipes).length > 1;
      for (const x of sg.data ?? []) stages[x.id] = { name: x.name, pipeline: multi ? pipes[x.pipeline_id] : undefined };
    } catch {
      /* référentiels facultatifs */
    }

    const map = new Map<string, ResultItem>(isFull ? [] : idx.items.map((i) => [i.id, i]));
    const kinds: Array<[string, string]> = [
      ["organization", "/v2/organizations"],
      ["person", "/v2/persons"],
      ["deal", "/v2/deals"],
      ["product", "/v2/products"],
    ];
    for (const [kind, path] of kinds) {
      const rows: any[] = [];
      try {
        await fetchV2(
          path,
          since ? { updated_since: since } : {},
          (count) => progress(`Pipedrive : ${count.toLocaleString("fr-FR")} ${LABELS[kind]}`),
          rows,
        );
      } catch (e) {
        if (kind === "product") continue; // module produits parfois désactivé
        throw e;
      }
      for (const r of rows) map.set(`${kind}-${r.id}`, fromList(kind, r));
    }
    // Leads (API v1, pagination par « start »)
    try {
      let start = 0;
      for (;;) {
        const res = await pd<any>("/v1/leads", { limit: 500, start, archived_status: "not_archived" });
        for (const r of res.data ?? []) map.set(`lead-${r.id}`, fromList("lead", r));
        const p = res.additional_data?.pagination;
        if (!p?.more_items_in_collection) break;
        start = p.next_start;
      }
    } catch {
      /* leads facultatifs */
    }
    setIndex("pipedrive", [...map.values()], {
      ...idx.meta,
      users: Object.keys(users).length ? users : idx.meta.users,
      stages: Object.keys(stages).length ? stages : idx.meta.stages,
      lastSync: Date.now(),
      lastFull: isFull ? Date.now() : idx.meta.lastFull,
      schema: 2,
    });
  },
};
