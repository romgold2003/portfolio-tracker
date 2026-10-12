/**
 * Daily net flows into the spot Bitcoin and Ethereum ETFs.
 *
 * From CoinMarketCap's own chart data: daily for the last 90 days, weekly for a
 * year and monthly back to launch, so each of the panel's three views is drawn
 * from the source's own totals rather than from days it does not have.
 *
 * SoSoValue's open API, which this used to read, answered 404 from October
 * 2026 and the panel vanished. Its keyed API is used instead whenever
 * SOSO_API_KEY is set. Farside, whose table the trackers quote, serves a bot
 * check to any program — curl got through once, Node never — and getting round
 * that is not something to do.
 *
 * CoinMarketCap matched Farside to the decimal on nine of the twelve days
 * checked; on 2 October 2026 it read +29.7m against Farside's +189.9m, a fund
 * missing from the day.
 *
 * Flows are carried in millions, which is the unit these are always quoted in
 * and keeps the numbers on the chart short.
 */

/** What each source calls each fund group. */
export const SERIES = {
  BTC: { label: 'Bitcoin', type: 'us-btc-spot', cmc: 'btc' },
  ETH: { label: 'Ethereum', type: 'us-eth-spot', cmc: 'eth' },
};

/** CoinMarketCap's points: dollars, dated by a millisecond timestamp. */
export function parseCmc(payload) {
  const points = payload?.data?.points;
  if (!Array.isArray(points)) return null;
  const out = [];
  for (const p of points) {
    const at = Number(p?.timestamp);
    const value = p?.value;
    if (!Number.isFinite(at) || value === null || value === undefined || !Number.isFinite(Number(value))) continue;
    out.push({ date: new Date(at).toISOString().slice(0, 10), flow: +(Number(value) / 1e6).toFixed(1) });
  }
  if (!out.length) return null;
  out.sort((x, y) => x.date.localeCompare(y.date));
  return out;
}

/**
 * The daily totals, oldest first and in millions.
 *
 * Everything the source offers is kept — about three hundred days — because the
 * panel rolls them up into weeks and months as well, and a month bar needs the
 * days behind it. The browser decides how far back to draw.
 *
 * A day with no number is dropped rather than counted as a zero: a fund that
 * has not reported has not reported nothing.
 */
export function parseFlows(payload, { days = 400 } = {}) {
  const rows = payload?.data;
  if (!Array.isArray(rows) || !rows.length) return null;

  const out = [];
  for (const r of rows) {
    const date = String(r?.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // Number(null) is 0, so an absent figure has to be rejected before the
    // conversion or a day that never reported is charted as a flat zero.
    const value = r?.totalNetInflow;
    if (value === null || value === undefined || value === '') continue;
    const raw = Number(value);
    if (!Number.isFinite(raw)) continue;
    out.push({ date, flow: +(raw / 1e6).toFixed(1) });
  }

  if (!out.length) return null;
  // The API answers newest first; a chart reads the other way.
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.slice(-days);
}

/** Totals worth printing above the chart. */
export function summarise(flows) {
  if (!flows?.length) return null;
  const latest = flows[flows.length - 1];
  const sum = (n) => +flows.slice(-n).reduce((s, f) => s + f.flow, 0).toFixed(1);
  return {
    latest: latest.flow,
    latestDate: latest.date,
    week: sum(5),
    month: sum(21),
  };
}
