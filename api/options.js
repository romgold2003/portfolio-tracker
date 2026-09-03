/**
 * Gamma and delta exposure by strike, for one of three markets.
 *
 * The arithmetic is in _lib/options.js; this fetches the chains. Server-side
 * because the payloads are large — the S&P chain is twelve megabytes — and
 * because neither source sends a CORS header a browser would accept.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { fromCboe, fromDeribit } from './_lib/options.js';
import { trackExposure } from './_lib/exposureHistory.js';

const SESSION_COOKIE = 'pt_session';

/**
 * `fresh` is how long an answer stands, in seconds, and it is set by what the
 * source can actually deliver rather than by how often anyone would like to
 * look.
 *
 * Deribit answers in a fifth of a second with under half a megabyte and reports
 * open interest as it changes, so a minute is a real minute of new information.
 * CBOE ships a thirteen-megabyte file from an endpoint with `delayed_quotes` in
 * its own path — the quotes are a quarter-hour behind and the open interest
 * behind them is struck once a day at the clearing house. Asking it more often
 * would move thirteen megabytes to be told the same thing.
 */
const MARKETS = {
  BTC: { label: 'Bitcoin', kind: 'deribit', fresh: 60, url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option' },
  SPX: { label: 'S&P 500', kind: 'cboe', fresh: 900, url: 'https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json' },
  NDX: { label: 'Nasdaq 100', kind: 'cboe', fresh: 900, url: 'https://cdn.cboe.com/api/global/delayed_quotes/options/_NDX.json' },
};

export const MARKET_LIST = Object.entries(MARKETS)
  .map(([id, m]) => ({ id, label: m.label }));

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const url = new URL(req.url, 'http://localhost');
  const id = String(url.searchParams.get('market') || 'BTC').toUpperCase();
  const market = MARKETS[id];
  if (!market) return fail(res, 400, 'Unknown market.');

  let payload;
  try {
    const chain = await fetch(market.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker)', Accept: 'application/json' },
    });
    if (!chain.ok) return fail(res, 503, 'The options feed is not answering.');
    payload = await chain.json();
  } catch {
    return fail(res, 503, 'The options feed is not answering.');
  }

  const profile = market.kind === 'cboe'
    ? fromCboe(payload)
    : fromDeribit(payload?.result);

  // A chain that arrived but priced to nothing usable. Better to say so than to
  // draw an empty axis and let it read as a flat market.
  if (!profile) return fail(res, 503, 'That chain could not be read.');

  /**
   * Today's net exposure is filed before the answer goes out, and the whole
   * recorded series comes back with it. Nobody sells this history for free, so
   * the only way to have a curve through time is to keep one — see
   * _lib/exposureHistory.js. Null where no database is attached, and the panel
   * then offers the strike profile alone.
   */
  const history = await trackExposure(id, profile);

  /**
   * The recording rides on the cache miss, so a market is written at most once
   * per fresh window however many people are looking. `refreshMs` tells the
   * browser the same interval, so it comes back when there is something new
   * rather than on a timer of its own choosing.
   */
  res.setHeader('Cache-Control',
    `public, s-maxage=${market.fresh}, stale-while-revalidate=${market.fresh * 2}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    market: id,
    label: market.label,
    markets: MARKET_LIST,
    refreshMs: market.fresh * 1000,
    ...profile,
    history,
  }));
}
