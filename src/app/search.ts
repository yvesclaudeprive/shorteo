import type { ResultItem } from "../sources/types";

/** Minuscules sans accents. */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function tokenize(s: string): string[] {
  return norm(s)
    .replace(/["“”]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface Entry {
  item: ResultItem;
  /** titre normalisé */
  n: string;
  /** texte annexe normalisé */
  x: string;
}

export function toEntry(item: ResultItem): Entry {
  return { item, n: norm(item.title), x: item.text ? norm(item.text) : "" };
}

function isWordStart(s: string, i: number): boolean {
  if (i === 0) return true;
  const c = s.charCodeAt(i - 1);
  const alnum = (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
  return !alnum;
}

/** Les lettres de t apparaissent dans l'ordre dans s, sur une plage raisonnable. */
function subsequence(s: string, t: string): boolean {
  let start = s.indexOf(t[0]);
  while (start >= 0) {
    let j = 1;
    let i = start + 1;
    const limit = start + t.length * 3;
    while (i < s.length && i < limit && j < t.length) {
      if (s[i] === t[j]) j++;
      i++;
    }
    if (j === t.length) return true;
    start = s.indexOf(t[0], start + 1);
  }
  return false;
}

/**
 * Score de pertinence d'une entrée pour des mots normalisés.
 * -1 = ne correspond pas. Début de titre > début de mot > milieu de mot > texte annexe.
 */
export function scoreEntry(e: Entry, tokens: string[]): number {
  if (!tokens.length) return 0;
  let score = 0;
  for (const t of tokens) {
    const i = e.n.indexOf(t);
    if (i >= 0) {
      score += i === 0 ? 34 : isWordStart(e.n, i) ? 24 : 10;
      continue;
    }
    if (e.x) {
      const j = e.x.indexOf(t);
      if (j >= 0) {
        score += isWordStart(e.x, j) ? 7 : 3;
        continue;
      }
    }
    if (t.length >= 4 && subsequence(e.n, t)) {
      score += 2;
      continue;
    }
    return -1;
  }
  const full = tokens.join(" ");
  if (e.n === full) score += 60;
  else if (e.n.startsWith(full)) score += 25;
  score -= Math.min(8, e.n.length / 15);
  return score;
}

/** Bonus de fraîcheur (0 à 8). */
export function recencyBoost(t?: number): number {
  if (!t) return 0;
  const days = (Date.now() - t) / 86400000;
  return Math.max(0, 8 * Math.exp(-days / 45));
}

/** Découpe un titre pour surligner les mots recherchés. */
export function highlight(title: string, tokens: string[]): Array<{ text: string; hit: boolean }> {
  if (!tokens.length) return [{ text: title, hit: false }];
  const n = norm(title);
  if (n.length !== title.length) return [{ text: title, hit: false }];
  const marks = new Array<boolean>(title.length).fill(false);
  for (const t of tokens) {
    let i = n.indexOf(t);
    while (i >= 0) {
      for (let k = i; k < i + t.length; k++) marks[k] = true;
      i = n.indexOf(t, i + t.length);
    }
  }
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cur = "";
  let curHit = marks[0] ?? false;
  for (let k = 0; k < title.length; k++) {
    if (marks[k] !== curHit) {
      if (cur) parts.push({ text: cur, hit: curHit });
      cur = "";
      curHit = marks[k];
    }
    cur += title[k];
  }
  if (cur) parts.push({ text: cur, hit: curHit });
  return parts;
}
