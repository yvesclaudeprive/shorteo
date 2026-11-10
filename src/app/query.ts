import { norm, tokenize } from "./search";
import type { Completion, OperatorDef, OperatorValue, ParsedOp, ParsedQuery, SourceDef } from "../sources/types";

/**
 * Analyse de la barre de recherche : texte libre + opérateurs « clé:valeur »
 * (ex. « devis type:sheet owner:moi modifié:30j »), à la manière de Superhuman / Gmail.
 */

interface Lexeme {
  start: number;
  end: number;
  raw: string;
}

export function lex(input: string): Lexeme[] {
  const out: Lexeme[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i++;
    if (i >= input.length) break;
    const start = i;
    let inQuote = false;
    while (i < input.length && (inQuote || !/\s/.test(input[i]))) {
      if (input[i] === '"') inQuote = !inQuote;
      i++;
    }
    out.push({ start, end: i, raw: input.slice(start, i) });
  }
  return out;
}

const OP_RE = /^(-?)([\p{L}_]+):(.*)$/u;

function splitOp(raw: string): { negate: boolean; key: string; value: string } | null {
  const m = OP_RE.exec(raw);
  if (!m) return null;
  return { negate: m[1] === "-", key: m[2], value: m[3] };
}

export function unquote(v: string): string {
  return v.replace(/^"(.*)"$/s, "$1").replace(/"/g, "");
}

export function quoteIfNeeded(v: string): string {
  return /\s/.test(v) ? `"${v}"` : v;
}

export function findOperator(source: SourceDef | null, key: string): OperatorDef | undefined {
  if (!source) return undefined;
  const k = norm(key);
  return source.operators.find((op) => op.aliases.some((a) => norm(a) === k));
}

function findValue(op: OperatorDef, value: string) {
  const v = norm(unquote(value));
  return (op.values?.() ?? []).find(
    (x) => norm(x.value) === v || (x.label && norm(x.label) === v) || x.aliases?.some((a) => norm(a) === v),
  );
}

function matchValue(op: OperatorDef, value: string): string {
  return findValue(op, value)?.value ?? unquote(value);
}

export function parseQuery(input: string, source: SourceDef | null): ParsedQuery {
  const ops: ParsedOp[] = [];
  const unknown: string[] = [];
  const text: string[] = [];
  for (const lx of lex(input)) {
    const sp = splitOp(lx.raw);
    if (sp && sp.value !== "") {
      const op = findOperator(source, sp.key);
      if (op) {
        if (op.strict && !findValue(op, sp.value)) continue; // valeur incomplète : ignorée
        ops.push({ key: op.key, value: matchValue(op, sp.value), negate: sp.negate, raw: lx.raw });
        continue;
      }
      if (source) {
        unknown.push(lx.raw);
        continue;
      }
    }
    if (sp && sp.value === "") continue; // opérateur en cours de saisie
    text.push(lx.raw);
  }
  const joined = text.join(" ");
  return {
    raw: input,
    text: unquote(joined).trim(),
    tokens: tokenize(joined),
    ops,
    unknown,
    exact: /"[^"]+"/.test(joined),
  };
}

export function opValues(q: ParsedQuery, key: string): string[] {
  return q.ops.filter((o) => o.key === key && !o.negate).map((o) => o.value);
}

export function hasOp(q: ParsedQuery, key: string, value?: string): boolean {
  return q.ops.some((o) => o.key === key && (value === undefined || norm(o.value) === norm(value)));
}

export interface CompletionState {
  items: Completion[];
  /** Fin de texte grisée proposée dans la barre */
  ghost: string;
  start: number;
  end: number;
}

const EMPTY: CompletionState = { items: [], ghost: "", start: 0, end: 0 };

function valueMatches(v: OperatorValue, partial: string): number {
  if (!partial) return 1;
  const p = norm(partial);
  const fields = [v.value, v.label ?? "", v.detail ?? "", ...(v.aliases ?? [])].map(norm);
  if (fields.some((f) => f.startsWith(p))) return 3;
  if (fields.some((f) => f.split(/[\s@._-]+/).some((w) => w.startsWith(p)))) return 2;
  if (fields.some((f) => f.includes(p))) return 1;
  return 0;
}

/** Suggestions pour le mot sous le curseur. */
export function computeCompletions(input: string, caret: number, source: SourceDef | null): CompletionState {
  if (!source) return EMPTY;
  const lexemes = lex(input);
  const cur = lexemes.find((l) => l.start <= caret && caret <= l.end && caret === l.end);
  if (!cur) return EMPTY;
  const raw = cur.raw;
  const items: Completion[] = [];
  const colon = raw.indexOf(":");

  if (colon > 0) {
    const neg = raw.startsWith("-") ? "-" : "";
    const typedKey = raw.slice(neg.length, colon);
    const op = findOperator(source, typedKey);
    if (!op || (!op.values && !op.complete)) return { ...EMPTY, start: cur.start, end: cur.end };
    const partial = unquote(raw.slice(colon + 1));
    const ranked = op.complete
      ? op.complete(partial).slice(0, 8).map((v) => ({ v, s: 1 }))
      : (op.values?.() ?? [])
          .map((v) => ({ v, s: valueMatches(v, partial) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 8);
    for (const { v } of ranked) {
      items.push({
        label: v.label ?? v.value,
        detail: v.detail ?? (v.label && v.label !== v.value ? v.value : undefined),
        insert: `${neg}${typedKey}:${quoteIfNeeded(v.value)} `,
        kind: op.key === "from" || op.key === "to" || op.key === "cc" ? "contact" : "value",
      });
    }
  } else {
    const t = norm(raw.replace(/^-/, ""));
    if (t.length >= 2) {
      for (const op of source.operators) {
        const alias = op.aliases.find((a) => norm(a).startsWith(t));
        if (alias && norm(alias) !== t) {
          items.push({ label: `${alias}:`, detail: op.label, insert: `${raw.startsWith("-") ? "-" : ""}${alias}:`, kind: "operator" });
        }
        if (items.length >= 4) break;
      }
    }
    if (source.textCompletions && raw.length >= 2) items.push(...source.textCompletions(raw));
  }

  let ghost = "";
  const first = items[0];
  if (first && caret === input.length) {
    const ins = first.insert.trimEnd();
    if (norm(ins).startsWith(norm(raw)) && ins.length > raw.length) ghost = ins.slice(raw.length);
  }
  return { items: items.slice(0, 8), ghost, start: cur.start, end: cur.end };
}

/** Remplace le mot courant par la suggestion. */
export function applyCompletion(input: string, state: CompletionState, c: Completion): { value: string; caret: number } {
  const before = input.slice(0, state.start);
  const after = input.slice(state.end);
  const value = before + c.insert + after.replace(/^\s+/, "");
  return { value, caret: before.length + c.insert.length };
}

/** Ajoute ou retire un filtre (pastilles). */
export function toggleOperator(input: string, source: SourceDef, opKey: string, value: string): string {
  const op = source.operators.find((o) => o.key === opKey);
  if (!op) return input;
  const lexemes = lex(input);
  const kept: string[] = [];
  let removed = false;
  for (const lx of lexemes) {
    const sp = splitOp(lx.raw);
    if (sp && !sp.negate) {
      const o = findOperator(source, sp.key);
      if (o && o.key === opKey) {
        if (norm(matchValue(o, sp.value)) === norm(value)) {
          removed = true;
          continue;
        }
        // même filtre, autre valeur : on remplace
        continue;
      }
    }
    kept.push(lx.raw);
  }
  if (!removed) kept.push(`${op.aliases[0]}:${quoteIfNeeded(value)}`);
  const out = kept.join(" ");
  return out ? out + " " : "";
}

/** Retire les opérateurs que l'outil cible ne comprend pas (changement d'outil). */
export function carryQuery(input: string, target: SourceDef | null): string {
  if (!target) {
    return lex(input)
      .filter((lx) => !splitOp(lx.raw))
      .map((l) => l.raw)
      .join(" ");
  }
  return lex(input)
    .filter((lx) => {
      const sp = splitOp(lx.raw);
      return !sp || !!findOperator(target, sp.key);
    })
    .map((l) => l.raw)
    .join(" ");
}

/** Retire toutes les occurrences d'un filtre. */
export function removeOperator(input: string, source: SourceDef, opKey: string): string {
  const kept = lex(input).filter((lx) => {
    const sp = splitOp(lx.raw);
    if (!sp) return true;
    const o = findOperator(source, sp.key);
    return !o || o.key !== opKey;
  });
  const out = kept.map((l) => l.raw).join(" ");
  return out ? out + " " : "";
}

/** Libellé lisible d'une valeur de filtre. */
export function valueLabel(op: OperatorDef, value: string): string {
  const v = (op.values?.() ?? []).find((x) => norm(x.value) === norm(value));
  return v?.label ?? value;
}
