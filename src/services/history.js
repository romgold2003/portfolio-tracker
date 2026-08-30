/**
 * Closing prices for any ticker on any past date.
 *
 * Needed to say what a position was worth when a window opened, which is what
 * separates "this month's gain" from "everything this holding has ever made".
 * A browser cannot fetch this — the free sources block cross-origin reads or
 * sit behind a bot check — so it goes through this deployment's own server, and
 * is simply unavailable on the builds that have none.
 *
 * A past close never changes, so resolved prices are cached permanently. The
 * series behind them is kept only for the session, since it is large and only
 * useful while several dates are being looked up at once.
 */
import { cloudEnabled } from './cloud.js';

const PRICE_CACHE_KEY = 'pt_historic_prices';

/** ticker -> rows, for this session only. */
const seriesCache = new Map();

function readResolved() {
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    return raw ? new Map(JSON.parse(raw)) : new Map();
  } catch {
    return new Map();
  }
}

function writeResolved(map) {
  try {
    // Bounded: a book of thirty tickers across a handful of window starts is
    // small, but this should not grow without limit over years of use.
    const entries = [...map].slice(-500);
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(entries));
  } catch { /* it will simply be fetched again */ }
}

/** Last close on or before a date. Rows must be ascending. */
export function closeOnOrBefore(rows, date) {
  let found = null;
  for (const row of rows) {
    if (row.date > date) break;
    found = row;
  }
  return found ? found.close : null;
}

async function seriesFor(ticker) {
  if (seriesCache.has(ticker)) return seriesCache.get(ticker);
  try {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(ticker)}&years=3`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rows = Array.isArray(json?.rows) ? json.rows : null;
    if (rows) seriesCache.set(ticker, rows);
    return rows;
  } catch {
    return null;
  }
}

/**
 * What each ticker closed at on or before `date`.
 *
 * Returns only what could be found. A symbol the history service does not carry
 * is simply absent, and the caller leaves that position out rather than
 * guessing at a price for it.
 */
export async function pricesOn(tickers, date) {
  const resolved = readResolved();
  const wanted = [...new Set(tickers)].filter(Boolean);
  const out = new Map();
  const missing = [];

  for (const ticker of wanted) {
    const key = `${ticker}@${date}`;
    if (resolved.has(key)) out.set(ticker, resolved.get(key));
    else missing.push(ticker);
  }

  if (!missing.length || !cloudEnabled()) return out;

  for (const ticker of missing) {
    const rows = await seriesFor(ticker);
    if (!rows) continue;
    const close = closeOnOrBefore(rows, date);
    if (close > 0) {
      out.set(ticker, close);
      resolved.set(`${ticker}@${date}`, close);
    }
  }

  writeResolved(resolved);
  return out;
}
