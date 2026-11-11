import { settingsStore, saveSettingsNow, type Settings } from "./settings";
import { getSecret, setSecret } from "./secrets";

/**
 * Export / import de la configuration pour l'installer sur un autre PC.
 * Le fichier .shorteo est chiffré (AES-256-GCM) avec une clé dérivée du mot de passe
 * choisi (PBKDF2-SHA256, 310 000 itérations) : sans le mot de passe, il est illisible.
 *
 * Inclus : réglages, raccourcis, clé Notion (index), clé Pipedrive, connexion Google.
 * Exclu : la recherche complète Notion (à reconnecter en un clic : son jeton change à
 * chaque renouvellement, deux PC ne peuvent pas le partager), le lancement au démarrage,
 * l'historique ChatGPT / Claude importé et les index (reconstruits automatiquement).
 */

const SECRET_KEYS = [
  "notion_token",
  "pipedrive_token",
  "google_client_id",
  "google_client_secret",
  "google_refresh_token",
] as const;

const ITERATIONS = 310000;

interface ExportFile {
  format: "shorteo-config";
  v: 1;
  createdAt: string;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  cipher: { name: "AES-256-GCM"; iv: string };
  data: string;
}

interface Payload {
  settings: Partial<Settings>;
  secrets: Record<string, string>;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Contenu du fichier .shorteo (JSON chiffré). */
export async function exportConfig(password: string): Promise<{ content: string; count: number }> {
  if (password.length < 8) throw new Error("Choisissez un mot de passe d'au moins 8 caractères");
  const secrets: Record<string, string> = {};
  for (const k of SECRET_KEYS) {
    const v = await getSecret(k);
    if (v) secrets[k] = v;
  }
  const { connected, lastSource: _ls, ...rest } = settingsStore.get();
  const payload: Payload = {
    settings: { ...rest, connected: { ...connected, notionMcp: false } },
    secrets,
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(JSON.stringify(payload))),
  );
  const file: ExportFile = {
    format: "shorteo-config",
    v: 1,
    createdAt: new Date().toISOString(),
    kdf: { name: "PBKDF2-SHA256", iterations: ITERATIONS, salt: toB64(salt) },
    cipher: { name: "AES-256-GCM", iv: toB64(iv) },
    data: toB64(data),
  };
  return { content: JSON.stringify(file, null, 2), count: Object.keys(secrets).length };
}

/** Déchiffre et applique un fichier .shorteo. Renvoie le nombre de clés restaurées. */
export async function importConfig(content: string, password: string): Promise<number> {
  let file: ExportFile;
  try {
    file = JSON.parse(content);
  } catch {
    throw new Error("Ce fichier n'est pas un export Shorteo");
  }
  if (file?.format !== "shorteo-config" || file.v !== 1) throw new Error("Ce fichier n'est pas un export Shorteo");
  const key = await deriveKey(password, fromB64(file.kdf.salt), file.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(file.cipher.iv) as BufferSource },
      key,
      fromB64(file.data) as BufferSource,
    );
  } catch {
    throw new Error("Mot de passe incorrect (ou fichier abîmé)");
  }
  const payload = JSON.parse(new TextDecoder().decode(plain)) as Payload;
  let count = 0;
  for (const k of SECRET_KEYS) {
    const v = payload.secrets?.[k];
    if (v) {
      await setSecret(k, v);
      count++;
    }
  }
  const current = settingsStore.get();
  const incoming = payload.settings ?? {};
  settingsStore.set({
    ...current,
    ...incoming,
    lastSource: current.lastSource,
    connected: {
      ...current.connected,
      ...(incoming.connected ?? {}),
      // la recherche complète Notion se reconnecte sur chaque PC
      notionMcp: current.connected.notionMcp,
    },
  });
  await saveSettingsNow();
  return count;
}
