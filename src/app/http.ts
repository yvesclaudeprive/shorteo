import { platform } from "./platform";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class NotConfiguredError extends Error {}

type Params = Record<string, string | number | boolean | undefined | null | Array<string | number>>;

/** Construit une query string (les tableaux deviennent des paramètres répétés). */
export function qs(params: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.append(k, String(v));
  }
  return sp.toString();
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorMessage(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    const m =
      j?.error?.message ??
      j?.error_description ??
      j?.message ??
      (typeof j?.error === "string" ? j.error : undefined);
    if (m) return `${status} — ${m}`;
  } catch {
    /* pas du JSON */
  }
  return `${status} — ${body.slice(0, 160)}`;
}

/** Requête HTTPS via la partie native, avec nouvelle tentative sur 429 / 5xx. */
export async function request<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  for (let attempt = 0; ; attempt++) {
    const res = await platform.http({
      method: opts.method ?? (body ? "POST" : "GET"),
      url,
      headers,
      body,
      timeout_ms: opts.timeoutMs ?? 20000,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const wait = Math.min(10, Number(res.retry_after) || 1 + attempt * 2);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status >= 400) throw new ApiError(res.status, errorMessage(res.status, res.body));
    if (!res.body) return null as T;
    try {
      return JSON.parse(res.body) as T;
    } catch {
      return res.body as unknown as T;
    }
  }
}

/** Exécute des tâches avec une concurrence limitée. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
