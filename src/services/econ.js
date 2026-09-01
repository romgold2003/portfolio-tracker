/**
 * The economic-release panel's data, from the browser's side.
 *
 * Needs the server, which is the only thing here that can reach the calendar
 * feed. Without one the panel does not appear, which is right for the static
 * builds rather than an error nobody can act on.
 */
import { cloudEnabled } from './cloud.js';

/**
 * The week's schedule is fixed by Monday; only the forecasts move inside it.
 *
 * Short enough that the panel turns over promptly when the week does, long
 * enough that opening the page repeatedly is not a request each time.
 */
const CACHE_MS = 15 * 60 * 1000;

let cache = { at: 0, week: null };

export function resetEconCache() {
  cache = { at: 0, week: null };
}

/**
 * This week's watched releases, as `{ week, releases }`, or null if they cannot
 * be had. Never throws.
 *
 * An empty `releases` is a real answer, not a failure: some weeks hold none of
 * these. It is cached like any other, so a quiet week is not re-fetched on
 * every render.
 */
export async function econReleases() {
  if (!cloudEnabled()) return null;
  if (cache.week && Date.now() - cache.at < CACHE_MS) return cache.week;

  try {
    const res = await fetch('/api/econ', { credentials: 'same-origin' });
    if (!res.ok) return cache.week;
    const body = await res.json();
    if (!Array.isArray(body?.releases)) return cache.week;
    cache = { at: Date.now(), week: { week: body.week ?? null, releases: body.releases } };
    return cache.week;
  } catch {
    return cache.week;
  }
}
