/**
 * A small rolling price history — one close per ticker per day — kept so the
 * app can show a real week-to-date change rather than a relabelled daily one,
 * on builds that have no server to ask for last week's closing price.
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
 * Change since this week began, from whatever history is on file.
 *
 * The fallback for when the server cannot supply the real closing price of the
 * last session before Monday. It takes the newest logged price from before this
 * Monday, which is the same thing whenever the app was open that day, and close
 * enough when it was not.
 *
 * Returns null with nothing from before Monday on file, rather than measuring
 * from some point inside the week and calling that the week.
 */
export function getWeekChg(ticker, currentPrice, monday = mondayOfWeek()) {
  const entries = log[ticker];
  if (!entries || !entries.length || !currentPrice) return null;

  const before = entries.filter((e) => e.d < monday && e.p > 0);
  const ref = before[before.length - 1];
  if (!ref) return null;
  return ((currentPrice - ref.p) / ref.p) * 100;
}

/**
 * The Monday of the current week, in New York.
 *
 * The market's week, not the browser's: in Israel it is already Tuesday for
 * seven hours before New York agrees, and using the local date there would move
 * the reference a day early every week.
 */
export function mondayOfWeek(now = new Date()) {
  const nyDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const date = new Date(`${nyDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
