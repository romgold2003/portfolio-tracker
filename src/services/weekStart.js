/**
 * What each holding closed at going into this week.
 *
 * The reference price a week-to-date change is measured from. It changes once,
 * on Monday, so it is fetched once and then kept for the rest of the week —
 * keyed by that Monday, so the moment a new week begins the old answer stops
 * matching and is replaced.
 */
import { cloudEnabled } from './cloud.js';

let cache = { monday: null, key: '', closes: new Map() };

export function resetWeekStart() {
  cache = { monday: null, key: '', closes: new Map() };
}

/** The Monday of the current week, in New York, as an ISO day. */
export function mondayOfWeek(now = new Date()) {
  const nyDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const date = new Date(`${nyDay}T00:00:00Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}

/**
 * Closing prices from before this week began, by ticker.
 *
 * Returns an empty map rather than throwing when there is no server or the
 * fetch fails; the caller falls back to its own price log.
 */
export async function weekStartCloses(tickers) {
  if (!cloudEnabled()) return new Map();

  const wanted = [...new Set(tickers)].filter(Boolean);
  if (!wanted.length) return new Map();

  const monday = mondayOfWeek();
  const key = [...wanted].sort().join(',');
  // Still the same week and the same book: the answer cannot have changed.
  if (cache.monday === monday && cache.key === key) return cache.closes;

  try {
    const res = await fetch(`/api/weekstart?symbols=${encodeURIComponent(wanted.join(','))}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return cache.closes;
    const body = await res.json();
    if (!body?.closes) return cache.closes;

    const closes = new Map(Object.entries(body.closes).map(([k, v]) => [k.toUpperCase(), v]));
    cache = { monday: body.monday || monday, key, closes };
    return closes;
  } catch {
    return cache.closes;
  }
}
