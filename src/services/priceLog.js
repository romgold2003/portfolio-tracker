/**
 * A small rolling price history — one close per ticker per day — kept purely so
 * the app can show a genuine 7-day change rather than a relabelled daily change.
 */
import { STORAGE_KEYS, PRICE_LOG_DAYS } from '../config/constants.js';

/** @type {Record<string, {d:string,p:number}[]>} ticker -> ascending daily closes */
let log = {};

const dateNDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

export function loadPriceLog() {
  try { log = JSON.parse(localStorage.getItem(STORAGE_KEYS.priceLog)) || {}; }
  catch { log = {}; }
}

function save() {
  try { localStorage.setItem(STORAGE_KEYS.priceLog, JSON.stringify(log)); }
  catch { /* storage unavailable — history simply will not persist */ }
}

/** The stored history, for callers that need to derive returns from it. */
export function priceHistory(ticker) {
  return log[ticker] ?? [];
}

/** Record today's price for a ticker, keeping at most PRICE_LOG_DAYS entries. */
export function logPrice(ticker, price) {
  if (!price || !Number.isFinite(price)) return;
  const today = dateNDaysAgo(0);
  if (!log[ticker]) log[ticker] = [];
  const entries = log[ticker];
  const existing = entries.find((e) => e.d === today);
  if (existing) existing.p = price;
  else entries.push({ d: today, p: price });
  entries.sort((a, b) => a.d.localeCompare(b.d));
  if (entries.length > PRICE_LOG_DAYS) log[ticker] = entries.slice(-PRICE_LOG_DAYS);
  save();
}

/** Back-fill yesterday from the broker's previous close, so history builds faster. */
export function seedPrevClose(ticker, prevClose) {
  if (!prevClose || !Number.isFinite(prevClose)) return;
  const yesterday = dateNDaysAgo(1);
  if (!log[ticker]) log[ticker] = [];
  if (log[ticker].some((e) => e.d === yesterday)) return;
  log[ticker].push({ d: yesterday, p: prevClose });
  log[ticker].sort((a, b) => a.d.localeCompare(b.d));
  save();
}

/**
 * True rolling 7-day change.
 *
 * Returns null until a price at least 5 days old is on file — otherwise the
 * figure would just be a copy of the daily change, which is misleading.
 */
export function get7DChg(ticker, currentPrice) {
  const entries = log[ticker];
  if (!entries || entries.length < 2) return null;
  const cutoff = dateNDaysAgo(7);
  const minAge = dateNDaysAgo(5);

  let ref = entries.filter((e) => e.d <= cutoff).sort((a, b) => b.d.localeCompare(a.d))[0];
  if (!ref) {
    const oldest = entries[0];
    if (oldest && oldest.d <= minAge) ref = oldest;
  }
  if (!ref || !ref.p) return null;
  return ((currentPrice - ref.p) / ref.p) * 100;
}
