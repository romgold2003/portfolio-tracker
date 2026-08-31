/**
 * The odds on the Fed's next decision.
 *
 * Fetches the 30-day fed funds contracts the next meeting depends on and hands
 * back what they imply. The arithmetic lives in _lib/fedwatch.js; this is the
 * part that talks to the network.
 *
 * Server-side for the same reason the quote endpoint is: the browser cannot
 * reach the source, and the content security policy is not going to be opened
 * up to a futures exchange so that it can.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { requiredContracts, readDecision } from './_lib/fedwatch.js';

const SESSION_COOKIE = 'pt_session';
const SOURCE = 'https://query1.finance.yahoo.com/v8/finance/chart';

async function priceOf(symbol) {
  const res = await fetch(
    `${SOURCE}/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
    { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const json = await res.json();
  const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof price === 'number' && price > 0 ? price : null;
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const today = new Date().toISOString().slice(0, 10);
  const wanted = requiredContracts(today);
  if (!wanted.length) return fail(res, 503, 'No scheduled meeting is known.');

  const settled = await Promise.allSettled(wanted.map(priceOf));
  const prices = {};
  wanted.forEach((symbol, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value != null) prices[symbol] = r.value;
  });

  const decision = readDecision({ today, prices });
  if (!decision) {
    // The contracts did not answer. Better to say so than to publish odds
    // derived from a rate nobody quoted.
    return fail(res, 503, 'Rate futures are not quoting right now.');
  }

  /**
   * A minute. These move on the futures tape, which is continuous, but the
   * odds shift in fractions of a percent over an hour — this is not a price
   * ticking, and nobody is trading off the panel.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(decision));
}
