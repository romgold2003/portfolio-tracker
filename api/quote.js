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
import { guestFor } from './_lib/guest.js';

const SESSION_COOKIE = 'pt_session';
const SOURCE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SYMBOL = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

/** Enough for any realistic book, and a bound on what one request can cost. */
const MAX_SYMBOLS = 40;

/** Every window of one session kind across the days asked for (one per day). */
function windowsOf(periods, name) {
  const raw = periods?.[name];
  if (!Array.isArray(raw)) return raw && typeof raw.start === 'number' ? [raw] : [];
  return raw.flat(2).filter((w) => w && typeof w.start === 'number');
}

/** Which part of the day a timestamp falls in, per the exchange's own hours. */
export function phaseOf(at, periods) {
  for (const name of ['pre', 'regular', 'post']) {
    if (windowsOf(periods, name).some((w) => at >= w.start && at < w.end)) return name;
  }
  return 'closed';
}

/**
 * The session the market is in now, and so what the latest trade means.
 *
 * In the first part of pre-market most stocks have not traded yet, and the
 * latest trade is last night's after-hours print. That is the price a broker
 * shows (Interactive Brokers did, +1.5% on the day, while this read the
 * four o'clock close; November 2026), so any trade since the last regular
 * close counts as the extended session now running.
 */
export function phaseNow(last, meta, nowS = Date.now() / 1000) {
  const current = meta?.currentTradingPeriod;
  const inside = (w) => w && typeof w.start === 'number' && nowS >= w.start && nowS < w.end;
  const closedAt = Number(meta?.regularMarketTime) || 0;
  const phase = phaseOf(last.at, meta?.tradingPeriods);
  if (last.at > closedAt) {
    if (inside(current?.pre)) return 'pre';
    if (inside(current?.post)) return 'post';
  }
  return phase;
}

/**
 * A share class is a dash here, whatever it is elsewhere.
 *
 * Statements write Berkshire's B class as "BRK B" and the app stores it as
 * BRK.B; this source only answers to BRK-B. Asking with the dot returns
 * nothing, which is why that holding alone sat with no day's move at all while
 * every other one had one.
 */
const upstreamSymbol = (symbol) => symbol.replace(/\./g, '-');

export async function quoteFor(symbol) {
  const res = await fetch(
    // Two days, not one: early in pre-market "today" has no bars at all, and
    // the latest trade is in yesterday's after-hours.
    `${SOURCE}/${encodeURIComponent(upstreamSymbol(symbol))}?interval=1m&range=2d&includePrePost=true`,
    { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' } },
  );
  if (!res.ok) return null;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  const closes = result?.indicators?.quote?.[0]?.close;
  const stamps = result?.timestamp;
  if (!meta) return null;

  /**
   * A mutual fund prices once a day, after the close, so it has no minute bars
   * at all — SWPPX came back with none, and the ticker could not be found. Its
   * daily price is the quote.
   */
  if (!Array.isArray(closes) || !Array.isArray(stamps)) {
    const price = meta.regularMarketPrice;
    if (!(typeof price === 'number' && price > 0)) return null;
    const previous = meta.previousClose ?? meta.chartPreviousClose;
    return {
      symbol,
      price,
      at: Number(meta.regularMarketTime) || null,
      phase: 'closed',
      regularClose: price,
      previousClose: typeof previous === 'number' ? previous : null,
    };
  }

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
    phase: phaseNow(last, meta),
    /** Where the regular session finished, which is what a day's move is measured to. */
    regularClose: typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null,
    /** The session before this one — the base a daily percentage is measured from. */
    previousClose: typeof meta.previousClose === 'number' ? meta.previousClose : null,
  };
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  // Signed in, or a guest's pass (api/_lib/guest.js): market data is open to both.
  const viewer = (await userForToken(readCookies(req)[SESSION_COOKIE])) ?? guestFor(req);
  if (!viewer) return fail(res, 401, 'Not signed in.');

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

  /**
   * Short, because this is what the day's move is measured from.
   *
   * It used to be a minute of hard caching with five more of
   * stale-while-revalidate, which permits the edge to answer with a six-minute
   * old quote and refresh itself afterwards. Across the half past nine boundary
   * that is the difference between a price and yesterday's news, and it was
   * most of why the figures took so long to catch up. Twenty seconds still
   * spares the upstream nearly every request from a page polling every thirty.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=40');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ quotes }));
}
