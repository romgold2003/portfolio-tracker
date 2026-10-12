/**
 * Spot ETF flows for Bitcoin and Ethereum.
 *
 * Two series, fetched together. The parsing and the order of the sources are
 * explained in _lib/etfflows.js; this is the part that talks to the network.
 *
 * Cached by the CDN for an hour, so the source is asked a couple of dozen
 * times a day at most, and a day's total appears within the hour after the
 * funds report it in the evening.
 */
import { fail, methodIs, readCookies } from '../_lib/http.js';
import { userForToken } from '../_lib/accounts.js';
import { parseFlows, parseCmc, summarise, SERIES } from '../_lib/etfflows.js';

const SESSION_COOKIE = 'pt_session';
const NAME = 'portfolio-tracker';

async function get(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': NAME, ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res;
}

/** Each source, best first: { daily, weekly?, monthly? } or null. */
const SOURCES = [
  {
    name: 'CoinMarketCap',
    /**
     * Daily only reaches back 90 days, so the weekly and monthly views take
     * the source's own weekly and monthly totals, which reach back further.
     */
    read: async (s) => {
      const range = async (r) => parseCmc(await (await get(
        `https://api.coinmarketcap.com/data-api/v3/etf/overview/netflow/chart?category=${s.cmc}&range=${r}`,
        { headers: { Accept: 'application/json' } },
      )).json());
      const [daily, weekly, monthly] = await Promise.all([range('90d'), range('1y'), range('all').catch(() => null)]);
      return daily && { daily, weekly, monthly };
    },
  },
  {
    name: 'SoSoValue',
    /**
     * Keyed since October 2026, when its open API began answering 404. Set
     * SOSO_API_KEY on Vercel to use it; the key goes in x-soso-api-key, the
     * only header it answered "verify the value" to rather than "no key".
     */
    read: async (s) => {
      const key = process.env.SOSO_API_KEY;
      if (!key) return null;
      const res = await get('https://openapi.sosovalue.com/openapi/v2/etf/historicalInflowChart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-soso-api-key': key },
        body: JSON.stringify({ type: s.type }),
      });
      const daily = parseFlows(await res.json());
      return daily && { daily };
    },
  },
];

/** The first source with rows for this fund group, and its name. */
export async function flowsFor(series) {
  const failures = [];
  for (const source of SOURCES) {
    try {
      const got = await source.read(series);
      if (got?.daily?.length) return { ...got, source: source.name };
    } catch (err) {
      failures.push(err.message);
    }
  }
  throw new Error(failures.join('; ') || 'no source had any rows');
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const ids = Object.keys(SERIES);
  const settled = await Promise.allSettled(ids.map((id) => flowsFor(SERIES[id])));

  const out = {};
  ids.forEach((id, i) => {
    const r = settled[i];
    if (r.status !== 'fulfilled') return;
    const { daily, weekly, monthly, source } = r.value;
    out[id] = { label: SERIES[id].label, flows: daily, weekly, monthly, summary: summarise(daily), source };
  });

  if (!Object.keys(out).length) {
    const why = settled.find((r) => r.status === 'rejected')?.reason?.message;
    return fail(res, 503, `ETF flows are not available right now${why ? ` (${why})` : ''}.`);
  }

  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out));
}
