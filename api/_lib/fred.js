/**
 * The number a release actually printed, from the Federal Reserve's own series.
 *
 * ForexFactory's calendar feed carries the schedule, the forecast and the
 * previous reading, and nothing else — there is no actual field on any row of
 * it, which is why the panel had nothing to show after a release landed. The
 * figure has to come from somewhere that publishes the statistic rather than
 * the diary.
 *
 * FRED is that: the St. Louis Fed re-publishes every series on this watchlist,
 * the CSV endpoint takes no API key, and it is the agencies' own data rather
 * than a scrape of somebody's table. The cost is a lag — FRED posts within
 * roughly an hour of the 08:30 release, not at the tone.
 */

/**
 * Where each watched release lives, and how it is quoted.
 *
 * The transformation is FRED's, not ours: `pch` is the month-on-month percent
 * change and `pc1` the year-on-year. Deriving those here from the index would
 * mean rounding the arithmetic a second time and drifting from the published
 * figure.
 */
export const SERIES = {
  'cpi-m': { id: 'CPIAUCSL', transform: 'pch', unit: 'percent', freq: 'month' },
  'cpi-y': { id: 'CPIAUCSL', transform: 'pc1', unit: 'percent', freq: 'month' },
  'core-cpi-m': { id: 'CPILFESL', transform: 'pch', unit: 'percent', freq: 'month' },
  'core-cpi-y': { id: 'CPILFESL', transform: 'pc1', unit: 'percent', freq: 'month' },
  'ppi-m': { id: 'PPIFIS', transform: 'pch', unit: 'percent', freq: 'month' },
  'core-ppi-m': { id: 'WPSFD4131', transform: 'pch', unit: 'percent', freq: 'month' },
  'retail-m': { id: 'RSAFS', transform: 'pch', unit: 'percent', freq: 'month' },
  'core-retail-m': { id: 'RSFSXMV', transform: 'pch', unit: 'percent', freq: 'month' },
  claims: { id: 'ICSA', transform: '', unit: 'thousands', freq: 'week' },
  unemployment: { id: 'UNRATE', transform: '', unit: 'percent', freq: 'month' },
  // Real GDP, annualised percent change — the number the calendar quotes for
  // every one of the advance, second and third estimates.
  gdp: { id: 'A191RL1Q225SBEA', transform: '', unit: 'percent', freq: 'quarter' },
};

const BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

/**
 * Two years back, which is all this needs and keeps the response small.
 *
 * The whole of ICSA is three thousand weeks and sixty kilobytes; only the last
 * two observations are ever read. FRED applies the window after transforming,
 * so a year-on-year change at the start of it is still correct.
 */
export function seriesUrl({ id, transform }, now = new Date()) {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 2);
  const params = new URLSearchParams({ id, cosd: from.toISOString().slice(0, 10) });
  if (transform) params.set('transformation', transform);
  return `${BASE}?${params}`;
}

/** Date and value per row, dropping FRED's dot for a period with no figure. */
export function parseSeries(csv) {
  const out = [];
  for (const line of String(csv ?? '').trim().split('\n').slice(1)) {
    const [date, raw] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) continue;
    const value = Number(raw);
    if (raw === '.' || raw === '' || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

/** Quoted the way the calendar quotes it, so the two can be compared as text. */
export function formatValue(value, unit) {
  if (!Number.isFinite(value)) return null;
  if (unit === 'thousands') return `${Math.round(value / 1000)}K`;
  return `${value.toFixed(1)}%`;
}

/**
 * The earliest observation date that could only have come from this release.
 *
 * There is no key joining a calendar row to a FRED observation, and the dates
 * do not line up: a Thursday claims release reports the week that ended the
 * Saturday before, and an August CPI is published in September. But every
 * release covers the period immediately before the one it lands in, so the
 * period start is derivable from the release date alone — and an observation
 * at least that recent is one the agency can only have posted today.
 *
 * That is the check this exists for. Before the agency posts, FRED's newest
 * observation is still the *last* release; shown unchecked it would sit under
 * today's date looking like today's news.
 */
export function coverageStart(releaseDate, freq) {
  const d = new Date(`${releaseDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;

  if (freq === 'week') {
    // Weekly claims are stamped with the Saturday the week ended, which is at
    // most eight days back from any day the release can land on.
    d.setUTCDate(d.getUTCDate() - 8);
    return d.toISOString().slice(0, 10);
  }
  if (freq === 'quarter') {
    // Whichever quarter finished before the month this landed in.
    const q = Math.floor(d.getUTCMonth() / 3) - 1;
    const year = d.getUTCFullYear() + (q < 0 ? -1 : 0);
    const month = ((q % 4) + 4) % 4 * 3;
    return `${year}-${String(month + 1).padStart(2, '0')}-01`;
  }
  // Monthly figures are stamped with the first of the month they describe.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A last guard on units, and only on units.
 *
 * Deliberately loose. The previous reading is *not* required to equal what the
 * calendar calls the previous, because the agencies revise: FRED restated last
 * week's claims from 203K to 204K within an hour of this being written, and an
 * equality check would have blanked the column from then on. What it does catch
 * is an order-of-magnitude mismatch — a level read as thousands, an index read
 * as a percentage change — which is the way a wrong mapping actually shows up.
 */
function plausible(before, previousText, unit) {
  const shown = Number(String(formatValue(before, unit)).replace(/[^\d.-]/g, ''));
  const expected = Number(String(previousText).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(shown) || !Number.isFinite(expected)) return false;
  const scale = Math.max(Math.abs(shown), Math.abs(expected));
  return scale < 1 || Math.abs(shown - expected) <= scale * 0.5 + 1;
}

/**
 * The figure a release printed — but only when it can be shown to be that one.
 *
 * Two things have to hold: FRED's newest observation must be recent enough to
 * belong to this release rather than the last one, and it must be quoted on the
 * same scale as the calendar. Neither alone is enough, and when either fails
 * nothing is returned — a blank is honest and a wrong number is not.
 */
export function actualFor(rows, release, unit, freq) {
  if (!Array.isArray(rows) || rows.length < 2 || !release?.previous || !release?.date) return null;
  const latest = rows[rows.length - 1];
  const before = rows[rows.length - 2];

  const earliest = coverageStart(release.date, freq);
  if (!earliest || latest.date < earliest) return null;
  if (!plausible(before.value, release.previous, unit)) return null;

  const actual = formatValue(latest.value, unit);
  return actual ? { actual, observed: latest.date } : null;
}

/**
 * Fetch the series each of this week's releases needs, once per series.
 *
 * CPI month-on-month and year-on-year are two rows of the panel but one FRED
 * id under two transformations, and a week rarely holds more than a handful of
 * these at all. Nothing here is fatal: a series that will not answer costs its
 * own actual and no more, which is why every fetch is settled rather than
 * awaited together.
 */
export async function fetchActuals(releases, { fetchImpl = fetch, now = new Date() } = {}) {
  const wanted = new Map();
  for (const r of releases) {
    // GDP ids carry the release title after a colon so the three estimates stay
    // apart on the panel; they all read the same series.
    const key = String(r.id).split(':')[0];
    const series = SERIES[key];
    if (!series || !r.previous) continue;
    wanted.set(`${series.id}|${series.transform}`, series);
  }
  if (!wanted.size) return new Map();

  const results = await Promise.allSettled([...wanted].map(async ([key, series]) => {
    const res = await fetchImpl(seriesUrl(series, now), {
      headers: { 'User-Agent': 'portfolio-tracker', Accept: 'text/csv' },
    });
    if (!res.ok) throw new Error(`FRED ${series.id} answered ${res.status}`);
    return [key, parseSeries(await res.text())];
  }));

  const bySeries = new Map();
  for (const r of results) if (r.status === 'fulfilled') bySeries.set(r.value[0], r.value[1]);
  return bySeries;
}

/** Put the printed figure on each release the check clears. */
export function attachActuals(releases, bySeries) {
  return releases.map((r) => {
    const series = SERIES[String(r.id).split(':')[0]];
    const rows = series && bySeries.get(`${series.id}|${series.transform}`);
    const hit = rows ? actualFor(rows, r, series.unit, series.freq) : null;
    return { ...r, actual: hit?.actual ?? null, observed: hit?.observed ?? null };
  });
}
