/**
 * The fear-and-greed readings, from the browser's side.
 *
 * Needs the server, which is the only thing here that can reach the source.
 * Without one the dials do not appear, which is right for the static builds.
 */
import { cloudEnabled } from './cloud.js';

/** The stock index recomputes through the session; the crypto one daily. */
const CACHE_MS = 30 * 60 * 1000;

let cache = { at: 0, data: null };

export function resetSentimentCache() {
  cache = { at: 0, data: null };
}

/** Both readings, or null if they cannot be had. Never throws. */
export async function marketSentiment() {
  if (!cloudEnabled()) return null;
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  try {
    const res = await fetch('/api/sentiment', { credentials: 'same-origin' });
    if (!res.ok) return cache.data;
    const body = await res.json();
    if (!body?.stocks && !body?.crypto) return cache.data;
    cache = { at: Date.now(), data: body };
    return body;
  } catch {
    return cache.data;
  }
}
