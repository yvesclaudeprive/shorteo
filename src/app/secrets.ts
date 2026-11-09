import { platform } from "./platform";

/**
 * Clés d'accès : coffre-fort Windows, avec cache mémoire.
 * Le coffre-fort limite la taille d'une entrée : les valeurs longues (jetons)
 * sont découpées en morceaux.
 */
const cache = new Map<string, string | null>();
const CHUNK = 900;
const MARK = "__chunks:";

export async function getSecret(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  let v = await platform.secretGet(key);
  if (v && v.startsWith(MARK)) {
    const n = Number(v.slice(MARK.length));
    const parts: string[] = [];
    for (let i = 0; i < n; i++) parts.push((await platform.secretGet(`${key}__${i}`)) ?? "");
    v = parts.join("");
  }
  cache.set(key, v);
  return v;
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (value.length <= CHUNK) {
    await platform.secretSet(key, value);
  } else {
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await platform.secretSet(`${key}__${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await platform.secretSet(key, `${MARK}${n}`);
  }
  cache.set(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  const raw = await platform.secretGet(key);
  if (raw && raw.startsWith(MARK)) {
    const n = Number(raw.slice(MARK.length));
    for (let i = 0; i < n; i++) await platform.secretDelete(`${key}__${i}`);
  }
  await platform.secretDelete(key);
  cache.delete(key);
}
