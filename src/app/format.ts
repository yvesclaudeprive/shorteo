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

/** Période « 7j », « 30j », « 3m », « 1a », « aujourdhui »… en millisecondes. */
export function periodMs(value: string): number | null {
  const v = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’\s]/g, "");
  const day = 86400000;
  if (v === "aujourdhui" || v === "today") return day;
  if (v === "semaine" || v === "week") return 7 * day;
  if (v === "mois" || v === "month") return 30 * day;
  if (v === "annee" || v === "year") return 365 * day;
  const m = /^(\d+)\s*(j|d|jours?|days?|s|w|sem|m|mois|months?|a|y|ans?|years?|h)$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2];
  if (u === "h") return n * 3600000;
  if (/^(j|d|jour|jours|day|days)$/.test(u)) return n * day;
  if (/^(s|w|sem)$/.test(u)) return n * 7 * day;
  if (/^(m|mois|month|months)$/.test(u)) return n * 30 * day;
  return n * 365 * day;
}

export const PERIOD_VALUES = [
  { value: "aujourdhui", label: "Aujourd'hui" },
  { value: "7j", label: "7 derniers jours" },
  { value: "30j", label: "30 derniers jours" },
  { value: "3m", label: "3 derniers mois" },
  { value: "1a", label: "12 derniers mois" },
];
