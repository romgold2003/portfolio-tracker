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
/**
 * Twenty seconds: no longer than the live refresh below asks, so a figure the
 * server has is drawn at the next tick rather than two minutes later.
 */
const CACHE_MS = 20 * 1000;

/**
 * Whether a release is due or has just printed without a figure yet — the
 * minutes the panel is watched for. From two minutes before it is due until
 * six hours after, or until its figure arrives.
 */
export function awaitingRelease(releases, now = Date.now()) {
  return (releases ?? []).some((r) => {
    if (r?.actual || !r?.at) return false;
    const at = Date.parse(r.at);
    return Number.isFinite(at) && now >= at - 2 * 60_000 && now < at + 6 * 3600_000;
  });
}

let cache = { at: 0, week: null };

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
