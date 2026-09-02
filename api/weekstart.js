/**
 * The closing price each symbol carried into this week.
 *
 * A week-to-date change is measured from the last close before Monday — for a
 * US equity that is Friday's close, and on a shortened week whatever the last
 * session before it was. This finds that price, so "this week" means the same
 * thing on Wednesday as it does on Friday.
 *
 * Kept apart from the quote endpoint because it changes once a week rather than
 * once a minute. One fetch of daily bars per symbol, cached at the edge for
 * hours, against a quote endpoint hit every twenty seconds.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { weekOf, newYorkDay } from './_lib/week.js';

const SESSION_COOKIE = 'pt_session';
const SOURCE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SYMBOL = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;
const MAX_SYMBOLS = 40;

/** Share classes are a dash upstream, whatever the statement called them. */
const upstreamSymbol = (symbol) => symbol.replace(/\./g, '-');

/** A daily bar's timestamp is its session; read it as a New York date. */
const dayOf = (seconds) => newYorkDay(new Date(seconds * 1000));

async function weekStartFor(symbol, monday) {
  const res = await fetch(
    `${SOURCE}/${encodeURIComponent(upstreamSymbol(symbol))}?interval=1d&range=1mo`,
    { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' } },
  );
  if (!res.ok) return null;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return null;

  // The last session that finished before this week opened. Walking backwards
  // skips holidays and half-weeks without needing a calendar of them.
  for (let i = stamps.length - 1; i >= 0; i--) {
    const price = closes[i];
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
    if (dayOf(stamps[i]) < monday) return price;
  }
  return null;
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

  if (!symbols.length) return fail(res, 400, 'No symbols to price.');

  const { from: monday } = weekOf(newYorkDay());

  const settled = await Promise.allSettled(symbols.map((s) => weekStartFor(s, monday)));
  const closes = {};
  symbols.forEach((symbol, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value != null) closes[symbol.toUpperCase()] = r.value;
  });

  /**
   * Six hours. The number changes once, on Monday morning, and a stale answer
   * inside the same week is not stale at all — it is the same close.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=43200');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ monday, closes }));
}
