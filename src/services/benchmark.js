/**
 * The S&P 500 as a yardstick.
 *
 * Two things need a daily history of the index: the "am I beating the market"
 * line on the overview, and a beta that is measured rather than assumed.
 *
 * Getting that history into a page with no backend is the whole difficulty.
 * Stooq serves it free but sends no CORS header, so a browser cannot read it.
 * Yahoo rate-limits anonymous callers. Finnhub puts candles behind its paid
 * tier. Alpha Vantage allows cross-origin reads and has a free key, so that is
 * what this uses — and the app works without one, just with less to say.
 *
 * The series is cached for a day. A daily bar does not change intraday, and the
 * free tier allows only twenty-five calls a day.
 */
import { API, STORAGE_KEYS } from '../config/constants.js';
import { priceHistory } from './priceLog.js';
import { betaFromReturns } from '../core/portfolio.js';

export const BENCHMARK_SYMBOL = 'SPY';
export const BENCHMARK_NAME = 'S&P 500';

/** A trading day's worth of staleness is fine for a daily close. */
const CACHE_TTL_MS = 20 * 60 * 60 * 1000;

/** @type {{date:string, close:number}[] | null} ascending by date */
let series = null;

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.benchmark);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.fetchedAt || !Array.isArray(cached.series)) return null;
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
    return cached.series;
  } catch {
    return null;
  }
}

function writeCache(rows) {
  try {
    localStorage.setItem(STORAGE_KEYS.benchmark,
      JSON.stringify({ fetchedAt: Date.now(), series: rows }));
  } catch { /* the series simply will not persist */ }
}

export function benchmarkKey() {
  try { return localStorage.getItem(STORAGE_KEYS.benchmarkKey) || ''; } catch { return ''; }
}

export function saveBenchmarkKey(key) {
  try { localStorage.setItem(STORAGE_KEYS.benchmarkKey, key); } catch { /* ignore */ }
  // A new key means the old refusal is no longer the answer.
  series = null;
  try { localStorage.removeItem(STORAGE_KEYS.benchmark); } catch { /* ignore */ }
}

/**
 * Daily closes for the index, oldest first. Null when unavailable, which is the
 * normal state until a key is entered — callers fall back rather than fail.
 */
/**
 * Why the last attempt produced nothing, in the provider's own words.
 *
 * A silent null was the wrong thing to return here. "Market data unavailable"
 * covers a mistyped key, an exhausted daily quota and an endpoint that has
 * moved to a paid tier, and those need three different responses from the user
 * — so whatever the API said is kept and shown.
 */
let lastFailure = null;

export function benchmarkFailure() {
  return lastFailure;
}

/** Alpha Vantage answers refusals with prose and HTTP 200. */
function refusalIn(json) {
  const message = json?.Information || json?.Note || json?.['Error Message'];
  return typeof message === 'string' ? message : null;
}

function parseRows(json) {
  const raw = json?.['Time Series (Daily)'];
  if (!raw || typeof raw !== 'object') return null;
  const rows = Object.entries(raw)
    .map(([date, bar]) => ({ date, close: Number(bar['4. close']) }))
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return rows.length >= 2 ? rows : null;
}

async function fetchSeries(key, outputSize) {
  const url = `${API.alphaVantage}?function=TIME_SERIES_DAILY`
    + `&symbol=${BENCHMARK_SYMBOL}&outputsize=${outputSize}`
    + `&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return { rows: null, refusal: `The market data service returned ${res.status}.` };
  const json = await res.json();
  return { rows: parseRows(json), refusal: refusalIn(json) };
}

export async function benchmarkSeries() {
  if (series) return series;

  const cached = readCache();
  if (cached) { series = cached; return series; }

  const key = benchmarkKey();
  if (!key) { lastFailure = null; return null; }

  try {
    /**
     * Twenty years of history is asked for first, because a year-to-date
     * comparison needs more than the hundred days the compact response holds.
     * That size has been drifting into Alpha Vantage's paid tier, though, and a
     * free key gets prose instead of prices. So a refusal falls back to compact
     * rather than giving up: a hundred days still answers 1W through 3M, which
     * is most of what the buttons ask for.
     */
    let { rows, refusal } = await fetchSeries(key, 'full');
    if (!rows) {
      ({ rows, refusal } = await fetchSeries(key, 'compact'));
    }

    if (!rows) {
      lastFailure = refusal || 'The market data service sent no prices.';
      return null;
    }

    lastFailure = null;
    series = rows;
    writeCache(rows);
    return series;
  } catch (err) {
    lastFailure = `Could not reach the market data service (${err.message}).`;
    return null;
  }
}

/** Index level on a date, or the last close before it when markets were shut. */
export function closeOnOrBefore(rows, date) {
  let found = null;
  for (const row of rows) {
    if (row.date > date) break;
    found = row;
  }
  return found ? found.close : null;
}

/**
 * The index's return between two dates, as a percentage.
 * Null when the window falls outside the data.
 */
export function benchmarkReturn(rows, fromDate, toDate) {
  if (!rows?.length) return null;
  const start = closeOnOrBefore(rows, fromDate);
  const end = closeOnOrBefore(rows, toDate);
  if (!start || !end) return null;
  return ((end - start) / start) * 100;
}

/** Day-over-day returns as decimals, keyed by date, for the beta calculation. */
export function benchmarkDailyReturns(rows) {
  const out = new Map();
  if (!rows) return out;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].close;
    if (prev > 0) out.set(rows[i].date, (rows[i].close - prev) / prev);
  }
  return out;
}

/**
 * A measured beta for every holding with enough overlapping history.
 *
 * Only days where both the holding and the index have a return can be used, so
 * the pairs are built by matching dates rather than by lining up two arrays and
 * hoping. A holding quoted on a day the index was not, or the reverse, is
 * skipped instead of silently shifting every later pair by one.
 *
 * Tickers without enough overlap are simply absent, and the caller falls back
 * to the published assumption for those.
 */
export async function measuredBetas(tickers, minDays = 30) {
  const rows = await benchmarkSeries();
  if (!rows) return new Map();

  const marketByDate = benchmarkDailyReturns(rows);
  const out = new Map();

  tickers.forEach((rawTicker) => {
    const ticker = String(rawTicker).toUpperCase();
    const history = priceHistory(ticker);
    if (history.length < minDays + 1) return;

    const asset = [];
    const market = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1].p;
      if (!(prev > 0)) continue;
      const marketReturn = marketByDate.get(history[i].d);
      // No index return for that date means the pair cannot be formed.
      if (marketReturn === undefined) continue;
      asset.push((history[i].p - prev) / prev);
      market.push(marketReturn);
    }

    const beta = betaFromReturns(asset, market, minDays);
    if (beta != null) out.set(ticker, beta);
  });

  return out;
}
