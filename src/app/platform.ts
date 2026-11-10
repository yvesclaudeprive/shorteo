import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Accès aux fonctions natives (Rust). Hors de l'application (navigateur),
 * un mode « démo » permet de prévisualiser l'interface sans réseau.
 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object);

export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_ms?: number;
}

export interface HttpResponse {
  status: number;
  body: string;
  retry_after?: string | null;
  headers?: Record<string, string>;
}

export interface AppsStatus {
  running: Record<string, boolean>;
  installed: Record<string, boolean>;
}

export interface ImportedConversation {
  id: string;
  title: string;
  updated_ms?: number | null;
  updated_iso?: string | null;
  text: string;
}

function ls(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const platform = {
  demo: !isTauri,

  async http(req: HttpRequest): Promise<HttpResponse> {
    if (!isTauri) throw new Error("Mode démo : pas d'accès réseau");
    return invoke<HttpResponse>("http_request", { req });
  },

  async settingsLoad(): Promise<string | null> {
    if (!isTauri) return ls()?.getItem("ys-settings") ?? null;
    return invoke<string | null>("settings_load");
  },

  async settingsSave(data: string): Promise<void> {
    if (!isTauri) {
      try {
        ls()?.setItem("ys-settings", data);
      } catch {
        /* ignoré */
      }
      return;
    }
    await invoke("settings_save", { data });
  },

  async indexLoad(name: string): Promise<string | null> {
    if (!isTauri) return null;
    return invoke<string | null>("index_load", { name });
  },

  async indexSave(name: string, data: string): Promise<void> {
    if (!isTauri) return;
    await invoke("index_save", { name, data });
  },

  async indexClear(): Promise<void> {
    if (!isTauri) return;
    await invoke("index_clear");
  },

  async secretGet(key: string): Promise<string | null> {
    if (!isTauri) return null;
    return invoke<string | null>("secret_get", { key });
  },

  async secretSet(key: string, value: string): Promise<void> {
    if (!isTauri) return;
    await invoke("secret_set", { key, value });
  },

  async secretDelete(key: string): Promise<void> {
    if (!isTauri) return;
    await invoke("secret_delete", { key });
  },

  async appsStatus(processes: string[], schemes: string[]): Promise<AppsStatus> {
    if (!isTauri) return { running: {}, installed: {} };
    return invoke<AppsStatus>("apps_status", { processes, schemes });
  },

  async openUrl(url: string): Promise<void> {
    if (!isTauri) {
      if (url.startsWith("http")) window.open(url, "_blank", "noopener");
      return;
    }
    await invoke("open_url", { url });
  },

  /** Déplacement de la fenêtre (bouton de la souris enfoncé). */
  async startDrag(): Promise<void> {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  },

  async pickJsonFile(): Promise<string | null> {
    if (!isTauri) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    await platform.suspendBlur(true);
    try {
      const res = await open({ multiple: false, directory: false, filters: [{ name: "Fichier JSON", extensions: ["json"] }] });
      return typeof res === "string" ? res : null;
    } finally {
      await platform.suspendBlur(false);
    }
  },

  /** Tape le raccourci de recherche + colle la requête dans l'application ouverte (Windows). */
  async nativeSearchKeys(recipe: "notion" | "superhuman"): Promise<boolean> {
    if (!isTauri) return false;
    return invoke<boolean>("native_search_keys", { recipe });
  },

  async readJsonFile(path: string): Promise<string> {
    return invoke<string>("read_json_file", { path });
  },

  async hide(): Promise<void> {
    if (!isTauri) return;
    await invoke("hide_window");
  },

  async show(): Promise<void> {
    if (!isTauri) return;
    await invoke("show_main_window");
  },

  async quit(): Promise<void> {
    if (!isTauri) return;
    await invoke("quit_app");
  },

  async suspendBlur(suspended: boolean): Promise<void> {
    if (!isTauri) return;
    await invoke("suspend_blur", { suspended });
  },

  async setShortcut(shortcut: string): Promise<void> {
    if (!isTauri) return;
    await invoke("set_shortcut", { shortcut });
  },

  async shortcutError(): Promise<string | null> {
    if (!isTauri) return null;
    const s = await invoke<{ error: string | null }>("shortcut_status");
    return s.error;
  },

  async oauthPrepare(): Promise<number> {
    return invoke<number>("oauth_prepare");
  },

  async oauthWait(): Promise<string> {
    return invoke<string>("oauth_wait");
  },

  async importHistory(path: string, kind: "chatgpt" | "claude"): Promise<ImportedConversation[]> {
    return invoke<ImportedConversation[]>("import_ai_history", { path, kind });
  },

  async pickFile(): Promise<string | null> {
    if (!isTauri) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    await platform.suspendBlur(true);
    try {
      const res = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Export (.zip ou .json)", extensions: ["zip", "json"] }],
      });
      return typeof res === "string" ? res : null;
    } finally {
      await platform.suspendBlur(false);
    }
  },

  async copy(text: string): Promise<void> {
    if (!isTauri) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* ignoré */
      }
      return;
    }
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  },

  async autostartEnabled(): Promise<boolean> {
    if (!isTauri) return false;
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    return isEnabled();
  },

  async setAutostart(on: boolean): Promise<void> {
    if (!isTauri) return;
    const { enable, disable } = await import("@tauri-apps/plugin-autostart");
    if (on) await enable();
    else await disable();
  },

  async on(event: string, handler: () => void): Promise<UnlistenFn> {
    if (!isTauri) return () => {};
    return listen(event, () => handler());
  },
};
