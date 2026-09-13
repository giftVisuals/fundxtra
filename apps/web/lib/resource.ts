'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

/**
 * A tiny read-through cache for API data, shared across the whole Mini App.
 *
 * Each tab unmounts when you leave it and mounts again when you come back, so
 * every panel refetched everything from scratch on every visit. Tapping
 * through the five tabs and back cost a full reload of all of them — and each
 * of those requests costs Firestore reads that the user did nothing to earn.
 *
 * This holds what was already fetched. Coming back to a tab within the TTL
 * shows the data immediately and asks for nothing; past the TTL the cached
 * value still renders at once and a refresh happens behind it, so returning to
 * a screen never shows a spinner over data we already have.
 *
 * Anything that moves money calls `invalidateResources`, which is what keeps
 * the balance honest: the cache exists to stop pointless refetching, never to
 * let a screen show a number that has since changed.
 */

const DEFAULT_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  storedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Drop cached data.
 *
 * With no argument, everything — used at sign-out, so one account's data can
 * never be shown to the next. With a prefix, just the matching keys.
 */
export function invalidateResources(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Fetch through the cache, sharing one request between simultaneous callers. */
async function load<T>(key: string): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const request = api
    .get<T>(key)
    .then((value) => {
      cache.set(key, { value, storedAt: Date.now() });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** True only when there is nothing to show yet. */
  loading: boolean;
  /** Refetch, ignoring the cache. */
  reload: () => Promise<void>;
}

export function useResource<T>(key: string, options: { ttlMs?: number } = {}): Resource<T> {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;

  // Read straight from the cache during the first render, so a revisited tab
  // paints its data immediately instead of flashing a loading state.
  const [data, setData] = useState<T | null>(() => (cache.get(key)?.value as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchNow = useCallback(async () => {
    try {
      const value = await load<T>(key);
      if (alive.current) {
        setData(value);
        setError(null);
      }
    } catch (caught) {
      // A refresh that fails behind data already on screen keeps the data:
      // replacing a good balance with an error because the network blinked is
      // worse than showing a value that is a minute old.
      if (alive.current && cache.get(key) === undefined) setData(null);
      if (alive.current) setError(errorMessage(caught));
    }
  }, [key]);

  useEffect(() => {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.storedAt < ttl) return;
    void fetchNow();
  }, [key, ttl, fetchNow]);

  const reload = useCallback(async () => {
    cache.delete(key);
    await fetchNow();
  }, [key, fetchNow]);

  return { data, error, loading: data === null && error === null, reload };
}
