const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
const dateShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const dateLong = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const dateFull = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** « à l'instant », « il y a 5 min », « hier », « 12 nov. », « 3 mars 2024 » */
export function relativeDate(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "hier";
  if (d < 7) return rtf.format(-d, "day");
  const date = new Date(ms);
  return date.getFullYear() === new Date().getFullYear() ? dateShort.format(date) : dateLong.format(date);
}

export function fullDate(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return dateFull.format(new Date(ms));
}

export function money(value?: number | null, currency?: string | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency ?? ""}`.trim();
  }
}

/** Décode les entités HTML courantes (extraits Gmail). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Période « 7j », « 30j », « 3m », « 1a », « aujourdhui »… en millisecondes (depuis maintenant). */
export function periodMs(value: string): number | null {
  const r = periodRange(value);
  return r?.from !== undefined && r.to === undefined ? Date.now() - r.from : null;
}

const DAY = 86400000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/**
 * Plage de dates d'un filtre : périodes nommées (« 7j », « mois », « mois-dernier »…)
 * ou dates personnalisées « 2026-01-01..2026-03-31 », « 2026-01-01.. », « ..2026-03-31 ».
 * `to` est exclusif (fin de journée incluse).
 */
export function periodRange(value: string): { from?: number; to?: number } | null {
  const raw = value.trim();
  if (raw.includes("..")) {
    const [a, b] = raw.split("..");
    const from = a ? parseDay(a) : null;
    const end = b ? parseDay(b) : null;
    if (from === null && end === null) return null;
    return { from: from ?? undefined, to: end !== null ? end + DAY : undefined };
  }
  const v = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’\s]/g, "");
  const now = new Date();
  const today = startOfDay(now);
  switch (v) {
    case "aujourdhui":
    case "today":
      return { from: today };
    case "hier":
    case "yesterday":
      return { from: today - DAY, to: today };
    case "semaine": {
      const dow = (now.getDay() + 6) % 7;
      return { from: today - dow * DAY };
    }
    case "mois":
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() };
    case "mois-dernier":
    case "moisdernier":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        to: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      };
    case "annee":
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1).getTime() };
    case "annee-derniere":
    case "anneederniere":
      return { from: new Date(now.getFullYear() - 1, 0, 1).getTime(), to: new Date(now.getFullYear(), 0, 1).getTime() };
  }
  const m = /^(\d+)\s*(j|d|jours?|days?|s|w|sem|m|mois|months?|a|y|ans?|years?|h)$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2];
  let ms: number;
  if (u === "h") ms = n * 3600000;
  else if (/^(j|d|jour|jours|day|days)$/.test(u)) ms = n * DAY;
  else if (/^(s|w|sem)$/.test(u)) ms = n * 7 * DAY;
  else if (/^(m|mois|month|months)$/.test(u)) ms = n * 30 * DAY;
  else ms = n * 365 * DAY;
  return { from: Date.now() - ms };
}

/** L'instant t est-il dans la plage ? */
export function inRange(t: number | undefined, r: { from?: number; to?: number } | null): boolean {
  if (!r) return true;
  if (!t) return false;
  if (r.from !== undefined && t < r.from) return false;
  if (r.to !== undefined && t >= r.to) return false;
  return true;
}

const dShort = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Libellé lisible d'une plage personnalisée. */
export function rangeLabel(value: string): string | null {
  if (!value.includes("..")) return null;
  const [a, b] = value.split("..");
  const fa = a ? parseDay(a) : null;
  const fb = b ? parseDay(b) : null;
  if (fa !== null && fb !== null) return `du ${dShort.format(fa)} au ${dShort.format(fb)}`;
  if (fa !== null) return `depuis le ${dShort.format(fa)}`;
  if (fb !== null) return `jusqu'au ${dShort.format(fb)}`;
  return null;
}

export const PERIOD_VALUES = [
  { value: "aujourdhui", label: "Aujourd'hui" },
  { value: "hier", label: "Hier" },
  { value: "semaine", label: "Cette semaine" },
  { value: "7j", label: "7 derniers jours" },
  { value: "14j", label: "14 derniers jours" },
  { value: "30j", label: "30 derniers jours" },
  { value: "mois", label: "Ce mois-ci" },
  { value: "mois-dernier", label: "Le mois dernier" },
  { value: "3m", label: "3 derniers mois" },
  { value: "6m", label: "6 derniers mois" },
  { value: "annee", label: "Cette année" },
  { value: "annee-derniere", label: "L'année dernière" },
  { value: "1a", label: "12 derniers mois" },
  { value: "2a", label: "2 dernières années" },
];
