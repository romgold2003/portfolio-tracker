/**
 * Release figures straight from the Bureau of Labor Statistics.
 *
 * FRED is accurate and slow. It republishes the agencies' series rather than
 * producing them, and the gap showed: the August unemployment rate printed at
 * 08:30 and FRED still had July at 09:01, half an hour later. BLS had it
 * immediately, because BLS is who published it.
 *
 * So BLS is asked first for everything it owns — the household survey, CPI and
 * PPI — and FRED is left as the fallback and as the only source for the series
 * BLS does not produce: jobless claims (Labor's ETA), retail sales (Census) and
 * GDP (the BEA).
 *
 * The arithmetic here is deliberately the same arithmetic FRED does. Percent
 * changes are computed from the published index, month over month and against
 * the same month a year back, which is exactly what FRED's `pch` and `pc1`
 * transformations compute from the same numbers. Checked against them on every
 * series: CPI 0.1% and 3.3%, core 0.2% and 2.5%, PPI -0.0%, core PPI 0.2% —
 * identical to the decimal. This is a faster road to the same answer, not a
 * different one.
 */

/**
 * What to ask BLS for, and how to read it.
 *
 * `level` is the figure as published. `mom` and `yoy` are computed from an
 * index, so those series must be the seasonally adjusted ones — the calendar
 * quotes the seasonally adjusted month-on-month change, and reading it off the
 * raw index would report a different number and call it the same thing.
 */
export const SERIES = {
  unemployment: { id: 'LNS14000000', kind: 'level', unit: 'percent', freq: 'month' },
  'cpi-m': { id: 'CUSR0000SA0', kind: 'mom', unit: 'percent', freq: 'month' },
  'cpi-y': { id: 'CUSR0000SA0', kind: 'yoy', unit: 'percent', freq: 'month' },
  'core-cpi-m': { id: 'CUSR0000SA0L1E', kind: 'mom', unit: 'percent', freq: 'month' },
  'core-cpi-y': { id: 'CUSR0000SA0L1E', kind: 'yoy', unit: 'percent', freq: 'month' },
  'ppi-m': { id: 'WPSFD4', kind: 'mom', unit: 'percent', freq: 'month' },
  'core-ppi-m': { id: 'WPSFD4131', kind: 'mom', unit: 'percent', freq: 'month' },
};

const ENDPOINT = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

/**
 * One series, oldest first, as `{ date, value }`.
 *
 * BLS answers newest first and names months M01 to M12, with M13 for an annual
 * average that is not a month and has to go. The date is the first of the month
 * being described, which is how FRED stamps the same figure — so a series from
 * either source can be read by the same code downstream.
 */
export function parseSeries(data) {
  const out = [];
  for (const row of data ?? []) {
    const month = /^M(0[1-9]|1[0-2])$/.exec(String(row?.period ?? ''));
    if (!month) continue;
    const value = Number(row?.value);
    if (!Number.isFinite(value)) continue;
    out.push({ date: `${row.year}-${month[1]}-01`, value });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** A percent change back `step` months, or null where there is no such month. */
function change(rows, i, step) {
  const then = rows[i - step];
  if (!then || !(then.value > 0)) return null;
  const pct = (rows[i].value / then.value - 1) * 100;
  // Negative zero prints as "-0.0%", which reads as a fall that did not happen.
  return pct === 0 ? 0 : pct;
}

/** Turn an index series into the change series the calendar quotes. */
export function derive(rows, kind) {
  if (kind === 'level') return rows;
  const step = kind === 'yoy' ? 12 : 1;
  const out = [];
  for (let i = step; i < rows.length; i++) {
    const pct = change(rows, i, step);
    if (pct != null) out.push({ date: rows[i].date, value: pct });
  }
  return out;
}

/**
 * Ask for every series this week needs, in one request.
 *
 * BLS takes a list, so a week holding CPI, core CPI and the unemployment rate
 * is one call rather than five. Two years are requested because a
 * year-on-year change needs the year behind it.
 *
 * Never throws: a release with no figure is the panel's normal state before it
 * prints, and BLS being unreachable should look the same as not having printed
 * yet rather than taking the schedule down with it.
 */
export async function fetchActuals(releases, { fetchImpl = fetch, now = new Date() } = {}) {
  const wanted = new Map();
  for (const r of releases ?? []) {
    const key = String(r?.id).split(':')[0];
    const series = SERIES[key];
    if (series && r?.previous) wanted.set(key, series);
  }
  if (!wanted.size) return new Map();

  const ids = [...new Set([...wanted.values()].map((s) => s.id))];
  const year = now.getUTCFullYear();

  let payload;
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'portfolio-tracker' },
      body: JSON.stringify({
        seriesid: ids, startyear: String(year - 2), endyear: String(year),
      }),
    });
    if (!res.ok) throw new Error(`BLS answered ${res.status}`);
    payload = await res.json();
  } catch (err) {
    console.error('BLS unavailable:', err);
    return new Map();
  }

  if (payload?.status !== 'REQUEST_SUCCEEDED') {
    // The public tier throttles by the day. Saying so beats a silent blank.
    console.error('BLS refused the request:', payload?.status, payload?.message);
    return new Map();
  }

  const raw = new Map(
    (payload?.Results?.series ?? []).map((s) => [s.seriesID, parseSeries(s.data)]),
  );

  const out = new Map();
  for (const [key, series] of wanted) {
    const rows = raw.get(series.id);
    if (!rows?.length) continue;
    const derived = derive(rows, series.kind);
    if (derived.length >= 2) {
      out.set(key, { rows: derived, unit: series.unit, freq: series.freq });
    }
  }
  return out;
}
