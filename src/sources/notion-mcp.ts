import { platform, type HttpResponse } from "../app/platform";
import { getSecret, setSecret, deleteSecret } from "../app/secrets";
import { NotConfiguredError, qs } from "../app/http";
import { getIndex, setIndexMeta } from "../app/index-store";
import type { ResultItem } from "./types";

/**
 * Notion « complet » : serveur MCP officiel de Notion (https://mcp.notion.com/mcp).
 * La recherche se fait avec VOS droits Notion : tout l'espace de travail, titres ET contenu,
 * comme la recherche native. Connexion OAuth (navigateur), enregistrement automatique du
 * client (RFC 7591), PKCE. Lecture seule : la partie native n'autorise que la recherche et
 * la consultation (outils « notion-search » et « notion-fetch »).
 */

const MCP_URL = "https://mcp.notion.com/mcp";
const PROTOCOL = "2025-06-18";
const VERSION = "0.3.0";

interface Client {
  client_id: string;
  client_secret?: string;
  token_endpoint: string;
}

let access: { token: string; exp: number } | null = null;
let refreshing: Promise<string> | null = null;
let sessionId: string | null = null;
let ready = false;
let initializing: Promise<void> | null = null;
let nextId = 1;

async function getJson(url: string): Promise<any> {
  const r = await platform.http({ method: "GET", url, headers: { Accept: "application/json" }, timeout_ms: 15000 });
  if (r.status >= 400) throw new Error(`${r.status} sur ${url}`);
  return JSON.parse(r.body);
}

async function discover(): Promise<any> {
  let asUrl = "https://mcp.notion.com";
  for (const u of [
    "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp",
    "https://mcp.notion.com/.well-known/oauth-protected-resource",
  ]) {
    try {
      const pr = await getJson(u);
      if (pr.authorization_servers?.[0]) {
        asUrl = pr.authorization_servers[0];
        break;
      }
    } catch {
      /* essai suivant */
    }
  }
  const base = new URL(asUrl);
  const path = base.pathname.replace(/\/$/, "");
  for (const c of [
    `${base.origin}/.well-known/oauth-authorization-server${path}`,
    `${base.origin}/.well-known/openid-configuration${path}`,
    `${base.origin}/.well-known/oauth-authorization-server`,
  ]) {
    try {
      const m = await getJson(c);
      if (m.authorization_endpoint && m.token_endpoint) return m;
    } catch {
      /* essai suivant */
    }
  }
  throw new Error("Impossible de joindre le service de connexion de Notion (mcp.notion.com).");
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

async function tokenRequest(client: Client, form: Record<string, string>): Promise<void> {
  const body = new URLSearchParams({
    ...form,
    client_id: client.client_id,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
  }).toString();
  const r = await platform.http({
    method: "POST",
    url: client.token_endpoint,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (r.status >= 400) throw new Error(`Connexion Notion refusée (${r.status}) : ${r.body.slice(0, 200)}`);
  const j = JSON.parse(r.body);
  access = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  if (j.refresh_token) await setSecret("notion_mcp_refresh", j.refresh_token);
}

/** Ouvre la page de connexion Notion dans le navigateur et enregistre l'accès. */
export async function connectNotionMcp(): Promise<void> {
  const meta = await discover();
  if (!meta.registration_endpoint) throw new Error("Notion ne propose pas l'enregistrement automatique de l'application.");
  const port = await platform.oauthPrepare();
  const redirect = `http://127.0.0.1:${port}/callback`;
  const reg = await platform.http({
    method: "POST",
    url: meta.registration_endpoint,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Shorteo",
      redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (reg.status >= 400) throw new Error(`Enregistrement refusé par Notion (${reg.status}) : ${reg.body.slice(0, 200)}`);
  const r = JSON.parse(reg.body);
  const client: Client = { client_id: r.client_id, client_secret: r.client_secret, token_endpoint: meta.token_endpoint };

  const verifier = randomString(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  const state = randomString(16);
  const url =
    meta.authorization_endpoint +
    (meta.authorization_endpoint.includes("?") ? "&" : "?") +
    qs({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      resource: MCP_URL,
    });

  await platform.suspendBlur(true);
  try {
    await platform.openUrl(url);
    const path = await platform.oauthWait();
    const params = new URLSearchParams(path.split("?")[1] ?? "");
    if (params.get("error")) throw new Error(`Notion a refusé : ${params.get("error_description") ?? params.get("error")}`);
    if (params.get("state") !== state) throw new Error("Réponse de Notion invalide (state)");
    const code = params.get("code");
    if (!code) throw new Error("Code de connexion Notion manquant");
    await tokenRequest(client, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
      resource: MCP_URL,
    });
    await setSecret("notion_mcp_client", JSON.stringify(client));
    sessionId = null;
    ready = false;
  } finally {
    await platform.suspendBlur(false);
  }
}

export async function disconnectNotionMcp(): Promise<void> {
  access = null;
  sessionId = null;
  ready = false;
  await deleteSecret("notion_mcp_refresh");
  await deleteSecret("notion_mcp_client");
}

async function refreshAccess(): Promise<string> {
  const raw = await getSecret("notion_mcp_client");
  const rt = await getSecret("notion_mcp_refresh");
  if (!raw || !rt) throw new NotConfiguredError("Notion");
  const client = JSON.parse(raw) as Client;
  await tokenRequest(client, { grant_type: "refresh_token", refresh_token: rt, resource: MCP_URL });
  return access!.token;
}

async function accessToken(): Promise<string> {
  if (access && access.exp > Date.now() + 60000) return access.token;
  if (!refreshing) refreshing = refreshAccess().finally(() => (refreshing = null));
  return refreshing;
}

function parseRpc(r: HttpResponse, id?: number): any {
  const ct = r.headers?.["content-type"] ?? "";
  let msgs: any[] = [];
  if (ct.includes("text/event-stream")) {
    for (const line of r.body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        msgs.push(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ligne ignorée */
      }
    }
  } else if (r.body.trim()) {
    const j = JSON.parse(r.body);
    msgs = Array.isArray(j) ? j : [j];
  }
  const m = id === undefined ? msgs[0] : msgs.find((x) => x?.id === id) ?? msgs[0];
  if (m?.error) throw new Error(m.error.message ?? "Erreur Notion");
  return m?.result;
}

async function post(payload: unknown, retry = true): Promise<HttpResponse> {
  const token = await accessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": PROTOCOL,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const r = await platform.http({ method: "POST", url: MCP_URL, headers, body: JSON.stringify(payload), timeout_ms: 25000 });
  if (r.status === 401 && retry) {
    access = null;
    return post(payload, false);
  }
  if (r.status === 404 && sessionId && retry) {
    sessionId = null;
    ready = false;
    await ensureSession();
    return post(payload, false);
  }
  if (r.status === 429) throw new Error("Notion limite le nombre de recherches : réessayez dans un instant.");
  if (r.status >= 400) throw new Error(`Notion (${r.status}) : ${r.body.slice(0, 200)}`);
  return r;
}

async function ensureSession(): Promise<void> {
  if (ready) return;
  if (!initializing) {
    initializing = (async () => {
      const id = nextId++;
      const r = await post(
        {
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "Shorteo", version: VERSION } },
        },
        false,
      );
      sessionId = r.headers?.["mcp-session-id"] ?? null;
      parseRpc(r, id);
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
      ready = true;
    })().finally(() => (initializing = null));
  }
  await initializing;
}

async function callTool(name: "notion-search" | "notion-fetch", args: Record<string, unknown>): Promise<any> {
  await ensureSession();
  const id = nextId++;
  const r = await post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const res = parseRpc(r, id);
  if (res?.isError) {
    const t = res.content?.find((c: any) => c.type === "text")?.text;
    throw new Error(t ? String(t).slice(0, 200) : "Erreur de recherche Notion");
  }
  if (res?.structuredContent) return res.structuredContent;
  const text = res?.content?.find((c: any) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { results: [] };
  }
}

function cleanHighlight(h: string | undefined, title: string): string | undefined {
  if (!h) return undefined;
  let s = h.replace(/\bSource:\s*\w+\s*/g, "").trim();
  if (s.toLowerCase().startsWith(title.toLowerCase())) s = s.slice(title.length).trim();
  return s && s.toLowerCase() !== title.toLowerCase() ? s : undefined;
}

function toItem(r: any): ResultItem {
  const id = String(r.id ?? "");
  const nodash = id.replace(/-/g, "");
  const title = r.title || "Sans titre";
  return {
    id,
    source: "notion",
    kind: r.type === "database" || r.type === "data_source" ? "database" : "page",
    title,
    url: r.url ?? `https://www.notion.so/${nodash}`,
    app: `notion://www.notion.so/${nodash}`,
    t: Date.parse(r.timestamp) || undefined,
    snippet: cleanHighlight(r.highlight, title),
    f: { path: r.path || undefined, mcp: 1 },
  };
}

/** Mémorise les chemins vus (espaces, pages parentes) pour l'autocomplétion des filtres. */
function rememberPaths(items: ResultItem[]): void {
  const idx = getIndex("notion");
  const known: string[] = idx.meta.mcpPaths ?? [];
  const set = new Set(known);
  let changed = false;
  for (const it of items) {
    const p = it.f?.path as string | undefined;
    if (p && !set.has(p)) {
      set.add(p);
      changed = true;
    }
  }
  if (changed) setIndexMeta("notion", { mcpPaths: [...set].slice(-600) });
}

export interface McpSearchOptions {
  createdByMe?: boolean;
  createdBy?: string[];
  created?: { from?: number; to?: number };
  edited?: { from?: number; to?: number };
  sortRecent?: boolean;
  pageSize?: number;
}

export async function mcpSearch(query: string, o: McpSearchOptions = {}): Promise<ResultItem[]> {
  const filters: Record<string, unknown> = {};
  const created = [...(o.createdBy ?? []), ...(o.createdByMe ? ["me"] : [])];
  if (created.length) filters.created_by_user_ids = created;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const range = (r: { from?: number; to?: number }) => ({
    ...(r.from !== undefined ? { start_date: day(r.from) } : {}),
    ...(r.to !== undefined ? { end_date: day(r.to - 1) } : {}),
  });
  if (o.created) filters.created_date_range = range(o.created);
  if (o.edited) filters.last_edited_date_range = range(o.edited);
  const data = await callTool("notion-search", {
    query,
    page_size: o.pageSize ?? 25,
    max_highlight_length: 160,
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(o.sortRecent ? { sort: "last_edited" } : {}),
  });
  const items = ((data?.results ?? []) as any[]).filter((r) => r?.id).map(toItem);
  rememberPaths(items);
  return items;
}

export async function testNotionMcp(): Promise<string> {
  const items = await mcpSearch("a", { pageSize: 5 });
  return items.length
    ? `Connecté : la recherche couvre tout votre Notion (titres et contenu).`
    : "Connecté, mais la recherche de test n'a rien renvoyé.";
}
