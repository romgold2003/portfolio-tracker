/**
 * Earnings for the News page, from the browser's side (api/_panels/earnings.js).
 *
 * Needs the server, like the Fed panel: without one there is nothing to show.
 * Never throws — a panel on a page about something else.
 */
import { cloudEnabled } from './cloud.js';

/** The endpoint keeps each company five minutes; asking faster returns the same. */
const CACHE_MS = 2 * 60 * 1000;
let cache = { key: '', at: 0, companies: null };
let listCache = null;

/** Each company's last report and next date, in the order asked, or null. */
export async function earningsFor(symbols) {
  if (!cloudEnabled() || !symbols?.length) return symbols?.length ? null : [];
  const key = [...symbols].sort().join(',');
  if (cache.key === key && cache.companies && Date.now() - cache.at < CACHE_MS) return cache.companies;
  try {
    const res = await fetch(`/api/earnings?symbols=${encodeURIComponent(key)}`, { credentials: 'same-origin' });
    if (!res.ok) return cache.key === key ? cache.companies : null;
    const { companies } = await res.json();
    if (!Array.isArray(companies)) return null;
    for (const c of companies) rememberEstimate(c);
    cache = { key, at: Date.now(), companies };
    return companies;
  } catch {
    return cache.key === key ? cache.companies : null;
  }
}

/** Every company listed on Nasdaq, alphabetical: `[{s, n, c?}]`, or null. */
export async function nasdaqList() {
  if (listCache) return listCache;
  if (!cloudEnabled()) return null;
  try {
    const res = await fetch('/api/earnings?list=nasdaq', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const { companies } = await res.json();
    if (Array.isArray(companies) && companies.length) listCache = companies;
    return listCache;
  } catch {
    return null;
  }
}

/**
 * The estimates a quarter was expected to come in at, remembered on this device.
 *
 * Yahoo drops a quarter's revenue estimate the moment it reports, so the panel
 * notes what the coming quarter is expected to bring and, once it has
 * reported, compares the figures with that. A company followed only after it
 * reported has none, and its revenue is shown against the year before only.
 */
const EST_KEY = 'earn-est';

function readEstimates() {
  try { return JSON.parse(localStorage.getItem(EST_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

function rememberEstimate(company) {
  const next = company?.next;
  if (!next?.periodEnd || (next.revenueEst == null && next.epsEst == null)) return;
  const all = readEstimates();
  all[`${company.symbol}|${next.periodEnd}`] = { rev: next.revenueEst, eps: next.epsEst };
  // Two years of quarters for forty companies is plenty; the oldest go first.
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 320))) delete all[k];
  try { localStorage.setItem(EST_KEY, JSON.stringify(all)); } catch { /* private window */ }
}

/** What the quarter just reported was expected to bring, if this device saw it coming. */
export function estimateFor(symbol, periodEnd) {
  return periodEnd ? readEstimates()[`${symbol}|${periodEnd}`] ?? null : null;
}
