/**
 * Daily closing prices, fetched server-side.
 *
 * A browser cannot get this. The free sources that carry deep history either
 * send no CORS header or now sit behind a bot check, and the one that does
 * allow cross-origin reads caps a free key at twenty-five requests a day —
 * which a couple of page reloads exhausts, leaving the comparison blank for the
 * rest of the day.
 *
 * A server has no CORS to satisfy, so this fetches the history and hands the
 * browser back the two things it actually needs: dates and closes.
 *
 * Only reachable by someone signed in. The data is public, but an open proxy
 * on someone else's Vercel account is not a thing to leave lying around.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

/** Tickers, not paths. Anything else is not a symbol and is not forwarded. */
const SYMBOL = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

const SOURCE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const url = new URL(req.url, 'http://localhost');
  const symbol = url.searchParams.get('symbol') || '';
  if (!SYMBOL.test(symbol)) return fail(res, 400, 'That is not a symbol.');

  // Whole years, so one response answers every timeframe the app offers.
  const years = Math.min(Math.max(Number(url.searchParams.get('years')) || 2, 1), 10);
  const to = Math.floor(Date.now() / 1000);
  const from = to - Math.round(years * 365.25 * 86400);

  try {
    const upstream = await fetch(
      `${SOURCE}/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1d`,
      { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' } },
    );
    if (!upstream.ok) return fail(res, 502, `Price history unavailable (${upstream.status}).`);

    const json = await upstream.json();
    const result = json?.chart?.result?.[0];
    const stamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(stamps) || !Array.isArray(closes)) {
      return fail(res, 502, 'Price history came back in an unexpected shape.');
    }

    const rows = [];
    for (let i = 0; i < stamps.length; i++) {
      const close = closes[i];
      if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) continue;
      rows.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close });
    }
    if (rows.length < 2) return fail(res, 502, 'Price history was empty.');

    // A daily close does not change during the day, so let Vercel's edge serve
    // this to everyone for an hour rather than calling upstream each time.
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ symbol, rows }));
  } catch (err) {
    fail(res, 502, `Could not reach the price history service (${err.message}).`);
  }
}
