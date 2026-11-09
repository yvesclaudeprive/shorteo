import { request, ApiError, NotConfiguredError, qs } from "../app/http";
import { getSecret, setSecret, deleteSecret } from "../app/secrets";
import { platform } from "../app/platform";

/** Connexion Google (Drive + Gmail + contacts), en lecture seule. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/directory.readonly",
];

let access: { token: string; exp: number } | null = null;
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const [cid, secret, rt] = await Promise.all([
    getSecret("google_client_id"),
    getSecret("google_client_secret"),
    getSecret("google_refresh_token"),
  ]);
  if (!cid || !secret || !rt) throw new NotConfiguredError("Google");
  const res = await request<any>("https://oauth2.googleapis.com/token", {
    method: "POST",
    form: { client_id: cid, client_secret: secret, refresh_token: rt, grant_type: "refresh_token" },
  });
  access = { token: res.access_token, exp: Date.now() + (res.expires_in ?? 3600) * 1000 };
  return access.token;
}

export async function googleToken(): Promise<string> {
  if (access && access.exp > Date.now() + 60000) return access.token;
  if (!refreshing) refreshing = refreshAccessToken().finally(() => (refreshing = null));
  return refreshing;
}

export async function gapi<T = any>(url: string): Promise<T> {
  const token = await googleToken();
  try {
    return await request<T>(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      access = null;
      const t2 = await googleToken();
      return request<T>(url, { headers: { Authorization: `Bearer ${t2}` } });
    }
    throw e;
  }
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes).slice(0, len);
}

/** Ouvre la page de connexion Google dans le navigateur et récupère l'accès. Renvoie l'adresse mail. */
export async function connectGoogle(clientId: string, clientSecret: string): Promise<string> {
  await setSecret("google_client_id", clientId.trim());
  await setSecret("google_client_secret", clientSecret.trim());
  const verifier = randomString(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  const state = randomString(16);
  const port = await platform.oauthPrepare();
  const redirect = `http://127.0.0.1:${port}`;
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    qs({
      client_id: clientId.trim(),
      redirect_uri: redirect,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      state,
    });
  await platform.suspendBlur(true);
  try {
    await platform.openUrl(authUrl);
    const path = await platform.oauthWait();
    const params = new URLSearchParams(path.split("?")[1] ?? "");
    if (params.get("error")) throw new Error(`Google a refusé : ${params.get("error")}`);
    if (params.get("state") !== state) throw new Error("Réponse Google invalide (state)");
    const code = params.get("code");
    if (!code) throw new Error("Code Google manquant");
    const res = await request<any>("https://oauth2.googleapis.com/token", {
      method: "POST",
      form: {
        code,
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        redirect_uri: redirect,
        grant_type: "authorization_code",
        code_verifier: verifier,
      },
    });
    if (!res.refresh_token) throw new Error("Google n'a pas renvoyé de jeton durable : réessayez");
    await setSecret("google_refresh_token", res.refresh_token);
    access = { token: res.access_token, exp: Date.now() + (res.expires_in ?? 3600) * 1000 };
    const profile = await gapi<any>("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    return profile.emailAddress as string;
  } finally {
    await platform.suspendBlur(false);
  }
}

export async function disconnectGoogle(): Promise<void> {
  access = null;
  await deleteSecret("google_refresh_token");
}
