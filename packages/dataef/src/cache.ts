import { apiCache, db } from '@sour/db';
import { eq } from 'drizzle-orm';
import type { Cached } from './types';

export const FETCH_TIMEOUT_MS = 5_000;

/**
 * 'cache'   – used while replying to a user: return whatever is cached (even if expired, marked
 *             stale) and only call the API if nothing is cached at all.
 * 'refresh' – used by the refresh job: call the API; on failure keep and return the old value.
 */
export type ReadMode = 'cache' | 'refresh';

export async function readCache<T>(key: string): Promise<Cached<T> | null> {
  const [row] = await db.select().from(apiCache).where(eq(apiCache.key, key)).limit(1);
  if (!row) return null;
  return { data: row.payload as T, fetchedAt: row.fetchedAt, stale: row.expiresAt < new Date() };
}

export async function writeCache<T>(key: string, data: T, ttlMs: number) {
  const now = new Date();
  const values = { key, payload: data as object, fetchedAt: now, expiresAt: new Date(now.getTime() + ttlMs) };
  await db
    .insert(apiCache)
    .values(values)
    .onConflictDoUpdate({ target: apiCache.key, set: values });
}

export function withTimeout<T>(p: Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Fallback rule: API fails or takes > 5 s → last cached value marked stale; nothing cached → null. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  mode: ReadMode = 'cache',
): Promise<Cached<T> | null> {
  const hit = await readCache<T>(key);
  // While replying, never wait on the API: any cached value (fresh or stale) wins.
  if (mode === 'cache' && hit) return hit;

  try {
    const data = await withTimeout(fetcher());
    await writeCache(key, data, ttlMs);
    return { data, fetchedAt: new Date(), stale: false };
  } catch (err) {
    console.warn(`[dataef] ${key} fetch failed: ${(err as Error).message}`);
    return hit ? { ...hit, stale: true } : null;
  }
}
