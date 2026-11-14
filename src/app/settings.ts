import { createStore } from "./store";
import { platform } from "./platform";
import { DEFAULT_TOOL_SHORTCUTS } from "./shortcuts";
import type { SourceKey } from "../sources/types";

export type OpenMode = "app-if-running" | "app-if-installed" | "browser";
export type Theme = "auto" | "light" | "dark";

/**
 * Paramètres (stockés sur le PC, jamais dans le dépôt).
 * Les clés d'accès ne sont PAS ici : elles vont dans le coffre-fort Windows.
 */
export interface Settings {
  shortcut: string;
  /** Un raccourci par outil (vide = aucun) : ouvre Shorteo directement sur l'outil */
  toolShortcuts: Record<SourceKey, string>;
  hideOnBlur: boolean;
  theme: Theme;
  syncMinutes: number;
  lastSource: string;
  connected: {
    notion: boolean;
    notionMcp: boolean;
    pipedrive: boolean;
    google: boolean;
  };
  pipedriveDomain: string;
  mailAccount: string;
  /** Votre identifiant d'utilisateur Notion (filtre « Créé par : Moi ») */
  notionMe: string;
  /** Pages épinglées dans Shorteo (s'ajoutent aux favoris Notion pour le filtre ★ Favoris) */
  notionPins: Array<{ id: string; title: string; url?: string }>;
  notionOpen: OpenMode;
  superhumanOpen: OpenMode;
  claudeOpen: OpenMode;
  chatgptOpen: OpenMode;
  /** Modèles d'URL (variables : {email} {threadId} {q}). Vide = comportement par défaut. */
  superhumanThreadUrl: string;
  superhumanSearchUrl: string;
  /** Ouverture de la recherche Superhuman : touche « / » ou palette Ctrl+K → Search */
  superhumanSearchKey: "slash" | "palette";
  notionSearchUrl: string;
  pipedriveSearchUrl: string;
  driveMaxItems: number;
  /** Raccourcis affichés en tête de la recherche Drive (noms de dossiers ou de fichiers) */
  driveFavorites: string[];
  /** Version des réglages (migrations) */
  schema: number;
}

export const DEFAULT_SETTINGS: Settings = {
  shortcut: "Ctrl+Shift+Space",
  toolShortcuts: { ...DEFAULT_TOOL_SHORTCUTS },
  hideOnBlur: true,
  theme: "auto",
  syncMinutes: 2,
  lastSource: "all",
  connected: { notion: false, notionMcp: false, pipedrive: false, google: false },
  pipedriveDomain: "",
  mailAccount: "",
  notionMe: "",
  notionPins: [],
  notionOpen: "app-if-installed",
  superhumanOpen: "app-if-installed",
  claudeOpen: "browser",
  chatgptOpen: "browser",
  superhumanThreadUrl: "https://mail.superhuman.com/{email}/thread/{threadId}",
  superhumanSearchUrl: "",
  superhumanSearchKey: "slash",
  notionSearchUrl: "",
  pipedriveSearchUrl: "",
  driveMaxItems: 60000,
  driveFavorites: [
    "Clients en cours",
    "Prospects en cours",
    "Devis type",
    "Password client en cours",
    "Password prospects en cours",
  ],
  schema: 3,
};

export const settingsStore = createStore<Settings>({ ...DEFAULT_SETTINGS });

export function settings(): Settings {
  return settingsStore.get();
}

export async function loadSettings(): Promise<boolean> {
  const raw = await platform.settingsLoad();
  if (!raw) {
    if (platform.demo) {
      settingsStore.set({
        connected: { notion: true, notionMcp: false, pipedrive: true, google: true },
        pipedriveDomain: "demo",
        mailAccount: "vous@exemple.fr",
      });
    }
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    settingsStore.set({
      ...DEFAULT_SETTINGS,
      ...parsed,
      connected: { ...DEFAULT_SETTINGS.connected, ...(parsed.connected ?? {}) },
      toolShortcuts: { ...DEFAULT_TOOL_SHORTCUTS, ...(parsed.toolShortcuts ?? {}) },
    });
    // v2 : Notion et Superhuman s'ouvrent dans leur application dès qu'elle est installée
    if ((parsed.schema ?? 1) < 2) {
      settingsStore.set({ notionOpen: "app-if-installed", superhumanOpen: "app-if-installed", schema: 2 });
      void platform.settingsSave(JSON.stringify(settingsStore.get(), null, 2));
    }
    // v3 : Claude et ChatGPT s'ouvrent sur leur site (recherche saisie dans l'onglet)
    if ((parsed.schema ?? 1) < 3) {
      settingsStore.set({ claudeOpen: "browser", chatgptOpen: "browser", schema: 3 });
      void platform.settingsSave(JSON.stringify(settingsStore.get(), null, 2));
    }
  } catch {
    /* fichier corrompu : valeurs par défaut */
  }
  return true;
}

let saveTimer: number | undefined;

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set(patch);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void platform.settingsSave(JSON.stringify(settingsStore.get(), null, 2));
  }, 250);
}

export async function saveSettingsNow(): Promise<void> {
  window.clearTimeout(saveTimer);
  await platform.settingsSave(JSON.stringify(settingsStore.get(), null, 2));
}

/** Remplace {variable} dans un modèle d'URL (valeurs encodées). */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(vars[k] ?? ""));
}
