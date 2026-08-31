/**
 * The economic-release panel's data, from the browser's side.
 *
 * Needs the server, which is the only thing here that can reach the calendar
 * feed. Without one the panel does not appear, which is right for the static
 * builds rather than an error nobody can act on.
 */
import { cloudEnabled } from './cloud.js';

/** These change on a release schedule, not on a tape. */
const CACHE_MS = 15 * 60 * 1000;

let cache = { at: 0, releases: null };

export function resetEconCache() {
  cache = { at: 0, releases: null };
}

/** The watched releases, or null if they cannot be had. Never throws. */
export async function econReleases() {
  if (!cloudEnabled()) return null;
  if (cache.releases && Date.now() - cache.at < CACHE_MS) return cache.releases;

  try {
    const res = await fetch('/api/econ', { credentials: 'same-origin' });
    if (!res.ok) return cache.releases;
    const body = await res.json();
    if (!Array.isArray(body?.releases) || !body.releases.length) return cache.releases;
    cache = { at: Date.now(), releases: body.releases };
    return cache.releases;
  } catch {
    return cache.releases;
  }
}
