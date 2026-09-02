/**
 * Daily net flows into the spot Bitcoin and Ethereum ETFs.
 *
 * From SoSoValue's open API, which publishes the series the trackers all quote:
 * one row a day, the net dollars in or out across every issuer.
 *
 * The obvious source was Farside, whose table is where most of this data is
 * read from — but it sits behind a bot check that refuses a server request
 * whatever headers it carries, and getting round that is not something to do.
 * This API is offered for the purpose and its figures match Farside's to the
 * decimal: −236,463,473 against their (236.5)m for the same day.
 *
 * Flows arrive in dollars and are carried in millions, which is the unit these
 * are always quoted in and keeps the numbers on the chart short.
 */

/** What the API calls each fund group. */
export const SERIES = {
  BTC: { label: 'Bitcoin', type: 'us-btc-spot' },
  ETH: { label: 'Ethereum', type: 'us-eth-spot' },
};

/**
 * The daily totals, oldest first and in millions.
 *
 * A day with no number is dropped rather than counted as a zero: a fund that
 * has not reported has not reported nothing.
 */
export function parseFlows(payload, { days = 60 } = {}) {
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
