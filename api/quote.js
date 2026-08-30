/**
 * Prices outside regular trading hours.
 *
 * The quote feed the app uses for stocks reports the regular session only, so
 * between four in the afternoon and half nine the next morning every holding
 * sits frozen at its closing price while the market it trades in carries on
 * moving. This fills that in.
 *
 * Server-side because a browser cannot reach the source, and free because it
 * needs no key: one-minute bars across the whole extended session, plus the
 * boundaries that say which part of it a given bar belongs to. That is what
 * lets the app label a price "pre" or "after" rather than quietly presenting an
 * eight o'clock print as though the market were open.
 *
 * Several symbols per request, because a book of fifteen positions should not
 * be fifteen round trips.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';
const SOURCE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SYMBOL = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

/** Enough for any realistic book, and a bound on what one request can cost. */
const MAX_SYMBOLS = 40;

/** Which part of the day a timestamp falls in, per the exchange's own hours. */
function phaseOf(at, periods) {
  const window = (name) => {
    const raw = periods?.[name];
    const w = Array.isArray(raw?.[0]) ? raw[0][0] : raw?.[0];
    return w && typeof w.start === 'number' ? w : null;
  };
  for (const name of ['pre', 'regular', 'post']) {
    const w = window(name);
    if (w && at >= w.start && at < w.end) return name;
  }
  return 'closed';
}

async function quoteFor(symbol) {
  const res = await fetch(
    `${SOURCE}/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`,
    { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' } },
  );
  if (!res.ok) return null;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  const closes = result?.indicators?.quote?.[0]?.close;
  const stamps = result?.timestamp;
  if (!meta || !Array.isArray(closes) || !Array.isArray(stamps)) return null;

  // The last bar that actually traded. Extended sessions are thin, so the tail
  // of the series is usually nulls and taking the last entry blindly gets one.
  let last = null;
  for (let i = closes.length - 1; i >= 0; i--) {
    const price = closes[i];
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      last = { price, at: stamps[i] };
      break;
    }
  }
  if (!last) return null;

  return {
    symbol,
    price: last.price,
    at: last.at,
    phase: phaseOf(last.at, meta.tradingPeriods),
    /** Where the regular session finished, which is what a day's move is measured to. */
    regularClose: typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null,
    /** The session before this one — the base a daily percentage is measured from. */
    previousClose: typeof meta.previousClose === 'number' ? meta.previousClose : null,
  };
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const url = new URL(req.url, 'http://localhost');
  const symbols = (url.searchParams.get('symbols') || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SYMBOL.test(s))
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) return fail(res, 400, 'No symbols to quote.');

  // One slow or missing symbol must not cost the rest their prices.
  const settled = await Promise.allSettled(symbols.map(quoteFor));
  const quotes = settled
    .filter((s) => s.status === 'fulfilled' && s.value)
    .map((s) => s.value);

  // Extended sessions move slowly and this is polled; a minute at the edge
  // spares the upstream a request per client per refresh.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ quotes }));
}
