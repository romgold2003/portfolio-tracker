/**
 * Earnings for the News page, from the browser's side (api/_panels/earnings.js).
 *
 * Needs the server, like the Fed panel: without one there is nothing to show.
 * Never throws — a panel on a page about something else.
 */
import { cloudEnabled } from './cloud.js';
import { rememberForecasts } from '../core/store.js';

/** The endpoint keeps each company five minutes; asking faster returns the same. */
const CACHE_MS = 2 * 60 * 1000;
let cache = { key: '', at: 0, companies: null };
let listCache = null;
let problem = '';

/** Why the last request failed, in the server's words, for the panel to say. */
export function earningsProblem() { return problem; }

/** The server's own reason, when it gave one. */
async function reasonOf(res) {
  try { return (await res.json())?.error || `the server answered ${res.status}`; } catch { return `the server answered ${res.status}`; }
}

/** Each company's last report and next date, in the order asked, or null. */
export async function earningsFor(symbols) {
  if (!cloudEnabled() || !symbols?.length) return symbols?.length ? null : [];
  const key = [...symbols].sort().join(',');
  if (cache.key === key && cache.companies && Date.now() - cache.at < CACHE_MS) return cache.companies;
  try {
    const res = await fetch(`/api/earnings?symbols=${encodeURIComponent(key)}`, { credentials: 'same-origin' });
    if (!res.ok) { problem = await reasonOf(res); return cache.key === key ? cache.companies : null; }
    const { companies } = await res.json();
    if (!Array.isArray(companies)) return null;
    // Each coming quarter's forecast, kept for when the actual figures land.
    rememberForecasts(companies);
    cache = { key, at: Date.now(), companies };
    return companies;
  } catch (err) {
    problem = err.message;
    return cache.key === key ? cache.companies : null;
  }
}

/** Every company on Nasdaq, the NYSE and NYSE American, alphabetical: `[{s, n, x, c?}]`, or null. */
export async function companyList() {
  if (listCache) return listCache;
  if (!cloudEnabled()) return null;
  try {
    const res = await fetch('/api/earnings?list=companies', { credentials: 'same-origin' });
    if (!res.ok) { problem = await reasonOf(res); return null; }
    const { companies } = await res.json();
    if (Array.isArray(companies) && companies.length) listCache = companies;
    return listCache;
  } catch (err) {
    problem = err.message;
    return null;
  }
}
