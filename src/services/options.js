/**
 * Options exposure and ETF flows, from the browser's side.
 *
 * Both need the server: the chains are megabytes and neither source would be
 * reachable from a page under this app's content security policy.
 */
import { cloudEnabled } from './cloud.js';

/** Open interest is struck once a day; the spot behind it moves through it. */
const OPTIONS_CACHE_MS = 10 * 60 * 1000;
/** The funds report once, after the close. */
const ETF_CACHE_MS = 30 * 60 * 1000;

const optionsCache = new Map();
let etfCache = { at: 0, data: null };

export function resetMarketCaches() {
  optionsCache.clear();
  etfCache = { at: 0, data: null };
}

/** The strike profile for one market. Null if it cannot be had; never throws. */
export async function optionsProfile(market) {
  if (!cloudEnabled()) return null;
  const key = String(market || 'BTC').toUpperCase();
  const hit = optionsCache.get(key);
  if (hit && Date.now() - hit.at < OPTIONS_CACHE_MS) return hit.data;

  try {
    const res = await fetch(`/api/options?market=${encodeURIComponent(key)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return hit?.data ?? null;
    const data = await res.json();
    if (!Array.isArray(data?.strikes) || !data.strikes.length) return hit?.data ?? null;
    optionsCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return hit?.data ?? null;
  }
}

/** Daily ETF flows for both coins. */
export async function etfFlows() {
  if (!cloudEnabled()) return null;
  if (etfCache.data && Date.now() - etfCache.at < ETF_CACHE_MS) return etfCache.data;

  try {
    const res = await fetch('/api/etf', { credentials: 'same-origin' });
    if (!res.ok) return etfCache.data;
    const data = await res.json();
    if (!data?.BTC && !data?.ETH) return etfCache.data;
    etfCache = { at: Date.now(), data };
    return data;
  } catch {
    return etfCache.data;
  }
}
