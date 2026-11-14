import type { SourceKey } from "../sources/types";

/**
 * Raccourcis globaux : un général (ouvre Shorteo) + un par outil (ouvre Shorteo
 * directement sur l'outil). Format des raccourcis : « Ctrl+Alt+Shift+D ».
 */

export const DEFAULT_SHORTCUT = "Ctrl+Shift+Space";

/** Ctrl+Maj+Alt + initiale : libres sous Windows, dans Google Docs / Word, et sans
 * conflit avec AltGr (= Ctrl+Alt) sur un clavier AZERTY. */
export const DEFAULT_TOOL_SHORTCUTS: Record<SourceKey, string> = {
  notion: "Ctrl+Alt+Shift+N",
  drive: "Ctrl+Alt+Shift+D",
  pipedrive: "Ctrl+Alt+Shift+P",
  mail: "Ctrl+Alt+Shift+M",
  chatgpt: "Ctrl+Alt+Shift+G",
  claude: "Ctrl+Alt+Shift+C",
};

export type ShortcutTarget = "all" | SourceKey;

/** Ordre habituel en français : Ctrl, Maj, Alt, Win. */
const MOD_ORDER = ["Ctrl", "Shift", "Alt", "Super"];
const MOD_LABEL: Record<string, string> = { Ctrl: "Ctrl", Alt: "Alt", Shift: "Maj", Super: "Win" };

function split(accel: string): { mods: string[]; key: string } {
  const parts = accel.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  return { mods: parts, key };
}

/** Affichage à la française : « Ctrl+Maj+Alt+D », « Ctrl+Maj+Espace ». */
export function shortcutLabel(accel: string): string {
  if (!accel) return "";
  const { mods, key } = split(accel);
  const ordered = [...mods].sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return [...ordered.map((m) => MOD_LABEL[m] ?? m), key === "Space" ? "Espace" : key].join("+");
}

/** Même raccourci, quelle que soit l'écriture (ordre des touches, majuscules). */
export function sameShortcut(a: string, b: string): boolean {
  if (!a || !b) return false;
  const n = (x: string) => {
    const { mods, key } = split(x);
    return [...mods.map((m) => m.toLowerCase())].sort().join("+") + "+" + key.toLowerCase();
  };
  return n(a) === n(b);
}

/**
 * Raccourci à partir d'une touche pressée. La lettre est celle du clavier réel
 * (AZERTY : la touche « A » donne bien A), grâce à la carte du clavier quand elle existe.
 */
export function shortcutFromKey(
  e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string; key: string },
  layout?: Map<string, string> | null,
): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const code = e.code;
  let key: string | null = null;
  const mapped = layout?.get(code);
  if (mapped && /^[a-z]$/i.test(mapped)) key = mapped.toUpperCase();
  else if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  if (!key || !mods.length) return null;
  return [...mods, key].join("+");
}

export interface ShortcutCheck {
  level: "error" | "warn";
  message: string;
}

const RESERVED: Array<[string, string]> = [
  ["Alt+Tab", "réservé par Windows (changer de fenêtre)"],
  ["Alt+F4", "réservé par Windows (fermer la fenêtre)"],
  ["Ctrl+Alt+Delete", "réservé par Windows"],
  ["Ctrl+Shift+Escape", "réservé par Windows (gestionnaire des tâches)"],
  ["Ctrl+Escape", "réservé par Windows (menu Démarrer)"],
  ["Super+L", "réservé par Windows (verrouillage)"],
  ["Super+D", "réservé par Windows (bureau)"],
  ["Super+E", "réservé par Windows (explorateur)"],
  ["Super+R", "réservé par Windows (exécuter)"],
  ["Super+S", "réservé par Windows (recherche)"],
  ["Super+V", "réservé par Windows (historique du presse-papiers)"],
  ["Super+Shift+S", "réservé par Windows (capture d'écran)"],
];

/**
 * Vérifie un raccourci avant de l'enregistrer : refus s'il volerait une touche
 * courante à toutes les applications, avertissement s'il risque de gêner.
 */
export function checkShortcut(
  accel: string,
  target: ShortcutTarget,
  others: Partial<Record<ShortcutTarget, string>>,
): ShortcutCheck | null {
  const { mods, key } = split(accel);
  const has = (m: string) => mods.includes(m);
  for (const [t, other] of Object.entries(others) as Array<[ShortcutTarget, string]>) {
    if (t !== target && other && sameShortcut(other, accel)) {
      return { level: "error", message: `Déjà utilisé dans Shorteo (${t === "all" ? "raccourci général" : t}).` };
    }
  }
  for (const [r, why] of RESERVED) if (sameShortcut(r, accel)) return { level: "error", message: `${shortcutLabel(accel)} : ${why}.` };
  if (!has("Ctrl") && !has("Alt") && !has("Super")) {
    return { level: "error", message: "Ajoutez Ctrl, Alt ou Win : Maj seule servirait à taper du texte." };
  }
  const isLetterOrDigit = /^[A-Z0-9]$/.test(key);
  if (mods.length === 1 && isLetterOrDigit && !has("Super")) {
    return {
      level: "error",
      message: `${shortcutLabel(accel)} sert déjà dans toutes les applications (copier, coller, gras…) : ajoutez Maj et Alt, par exemple Ctrl+Maj+Alt + une lettre.`,
    };
  }
  if (has("Ctrl") && has("Alt") && !has("Shift") && !has("Super")) {
    if (/^[0-9E]$/.test(key)) {
      return {
        level: "error",
        message: `Sur un clavier AZERTY, Ctrl+Alt = AltGr : ${shortcutLabel(accel)} empêcherait de taper un caractère (@ # { [ € …).`,
      };
    }
    return {
      level: "warn",
      message: "Ctrl+Alt = AltGr sur un clavier AZERTY, et Google Docs ou Word utilisent certains Ctrl+Alt : Ctrl+Maj+Alt est plus sûr.",
    };
  }
  if (sameShortcut(accel, "Alt+Space")) {
    return { level: "warn", message: "Alt+Espace est utilisé par ChatGPT et par le menu des fenêtres de Windows." };
  }
  if (has("Super")) {
    return { level: "warn", message: "Windows utilise beaucoup de raccourcis avec la touche Win : vérifiez qu'il n'est pas déjà pris." };
  }
  return null;
}
