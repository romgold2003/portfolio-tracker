/**
 * Spot ETF flows for Bitcoin and Ethereum.
 *
 * Two series, fetched together. The parsing and the choice of source are
 * explained in _lib/etfflows.js; this is the part that talks to the network.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { parseFlows, summarise, SERIES } from './_lib/etfflows.js';

const SESSION_COOKIE = 'pt_session';
const ENDPOINT = 'https://api.sosovalue.xyz/openapi/v2/etf/historicalInflowChart';

async function flowsFor(type) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'portfolio-tracker',
    },
    body: JSON.stringify({ type }),
  });
  if (!res.ok) return null;
  return parseFlows(await res.json());
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const ids = Object.keys(SERIES);
  const settled = await Promise.allSettled(ids.map((id) => flowsFor(SERIES[id].type)));

  const out = {};
  ids.forEach((id, i) => {
    const r = settled[i];
    const flows = r.status === 'fulfilled' ? r.value : null;
    if (!flows) return;
    out[id] = { label: SERIES[id].label, flows, summary: summarise(flows) };
  });

  if (!Object.keys(out).length) return fail(res, 503, 'ETF flows are not available.');

  /**
   * An hour. The funds report once a day, after the US close, and a figure that
   * arrives at six in the evening is not improved by asking for it at noon.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out));
}
