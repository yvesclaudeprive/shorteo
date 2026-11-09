import { platform } from "./platform";

/** Clés d'accès : coffre-fort Windows, avec cache mémoire. */
const cache = new Map<string, string | null>();

export async function getSecret(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  const v = await platform.secretGet(key);
  cache.set(key, v);
  return v;
}

export async function setSecret(key: string, value: string): Promise<void> {
  await platform.secretSet(key, value);
  cache.set(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  await platform.secretDelete(key);
  cache.delete(key);
}
