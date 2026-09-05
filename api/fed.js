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
import { fromPolymarket, fromKalshi, blend, spread } from './_lib/fedsources.js';

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

/**
 * The rate the next meeting opens at: whatever the Fed is paying today.
 *
 * The effective rate is published daily and never expires, which the futures
 * anchor it replaces could not say — that read the previous month's contract,
 * and a contract for a month that has ended is settled and delisted. Null on
 * any failure, which puts readDecision back on the old anchor rather than
 * taking the panel down.
 */
async function effectiveRate() {
  try {
    const from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const res = await fetch(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=EFFR&cosd=${from}`,
      { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'text/csv' } },
    );
    if (!res.ok) return null;
    const lines = (await res.text()).trim().split('\n').slice(1);
    for (let i = lines.length - 1; i >= 0; i--) {
      const value = Number(lines[i].split(',')[1]);
      // A day with no fixing prints a dot; the most recent real one is wanted.
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Polymarket's book on the meeting.
 *
 * The open events, most traded first — the Fed decision sits near the top of
 * that list whenever it is live, and asking for it by slug would break the
 * first time they renamed one.
 */
async function polymarketOdds(meeting) {
  try {
    const res = await fetch(
      'https://gamma-api.polymarket.com/events?closed=false&limit=200&order=volume24hr&ascending=false',
      { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    return fromPolymarket(await res.json(), meeting);
  } catch {
    return null;
  }
}

/** Kalshi's ladder for the meeting, addressed by its own month ticker. */
async function kalshiOdds(meeting, effr) {
  if (!(effr > 0)) return null;
  const [year, month] = meeting.split('-');
  const ticker = `KXFED-${year.slice(2)}${
    ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(month) - 1]
  }`;
  try {
    const res = await fetch(
      `https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=${ticker}&status=open&limit=50`,
      { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    return fromKalshi((await res.json())?.markets, effr);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const today = new Date().toISOString().slice(0, 10);
  const wanted = requiredContracts(today);
  if (!wanted.length) return fail(res, 503, 'No scheduled meeting is known.');

  const [settled, effr] = await Promise.all([
    Promise.allSettled(wanted.map(priceOf)),
    effectiveRate(),
  ]);
  const prices = {};
  wanted.forEach((symbol, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value != null) prices[symbol] = r.value;
  });

  const decision = readDecision({ today, prices, effr });
  if (!decision) {
    // The contracts did not answer. Better to say so than to publish odds
    // derived from a rate nobody quoted.
    return fail(res, 503, 'Rate futures are not quoting right now.');
  }

  /**
   * The same question, asked of two prediction markets as well.
   *
   * Both are settled independently and both disagreed with the futures on the
   * day this was written — 50% and 51% against the futures' 58%, agreeing with
   * each other. Neither is allowed to take the panel down: a source that does
   * not answer simply drops out of the blend, and the futures alone reproduce
   * exactly what this showed before.
   */
  const [poly, kalshi] = await Promise.all([
    polymarketOdds(decision.meeting),
    kalshiOdds(decision.meeting, effr),
  ]);

  const sources = [
    { id: 'futures', label: 'Fed funds futures', odds: decision.odds },
    poly && { id: 'polymarket', label: 'Polymarket', odds: poly },
    kalshi && { id: 'kalshi', label: 'Kalshi', odds: kalshi },
  ].filter(Boolean);

  const consensus = blend(sources);

  /**
   * A minute. These move on the futures tape, which is continuous, but the
   * odds shift in fractions of a percent over an hour — this is not a price
   * ticking, and nobody is trading off the panel.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ...decision,
    // The blend is what the panel draws; the sources are what it can show
    // underneath, so an average is never mistaken for an agreement.
    odds: consensus ?? decision.odds,
    futuresOdds: decision.odds,
    sources,
    spread: spread(sources),
  }));
}
