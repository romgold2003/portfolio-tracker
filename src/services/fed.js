/**
 * The Fed panel's data, from the browser's side.
 *
 * Needs the server, which is the only thing here that can reach the futures
 * feed. Without one the panel simply does not appear, which is the right answer
 * for the static builds rather than an error nobody can act on.
 */
import { cloudEnabled } from './cloud.js';

/**
 * How long an answer is reused.
 *
 * The odds move on a continuous futures tape but they move slowly — fractions
 * of a percent over an hour. Asking every five minutes is already far more
 * often than the number changes.
 */
/**
 * A minute. The panel is watched for a sudden repricing, so holding the
 * previous answer for five was most of what stood between a shift happening
 * and it appearing — the endpoint itself only caches for sixty seconds.
 */
const CACHE_MS = 60 * 1000;

let cache = { at: 0, decision: null };

export function resetFedCache() {
  cache = { at: 0, decision: null };
}

/**
 * The next decision, or null if it cannot be had.
 *
 * Never throws. This is a panel on a page about something else; a futures feed
 * having a bad morning must not take the month's P&L down with it.
 */
export async function fedDecision() {
  if (!cloudEnabled()) return null;
  if (cache.decision && Date.now() - cache.at < CACHE_MS) return cache.decision;

  try {
    const res = await fetch('/api/fed', { credentials: 'same-origin' });
    if (!res.ok) return cache.decision;
    const decision = await res.json();
    if (!decision || typeof decision.meeting !== 'string' || !decision.odds) {
      return cache.decision;
    }
    cache = { at: Date.now(), decision };
    return decision;
  } catch {
    return cache.decision;
  }
}
