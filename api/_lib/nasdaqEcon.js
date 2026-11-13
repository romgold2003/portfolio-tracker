/**
 * Printed figures from Nasdaq's economic calendar (November 2026).
 *
 * ForexFactory's feed carries the schedule and never the actual, and FRED
 * republishes hours late — or, on 12 November, not within the next day:
 * jobless claims printed 200K at 08:30 and the panel still showed a dash more
 * than 24 hours later. Nasdaq posts each actual within a minute or two of the
 * release, written the way the calendar writes it ("200K", "0.4%"), with the
 * consensus and the previous beside it.
 *
 * Two quirks, both handled here:
 *  - Asked for a date, it answers with the day before (claims of Thursday the
 *    12th came back under the 13th), so both days are asked for and the rows
 *    are matched on what they say, not on the date.
 *  - A month-on-month and a year-on-year reading share one name ("CPI",
 *    "PPI"), so a row is matched to a release by its consensus and previous
 *    as well as its name.
 */
const BASE = 'https://api.nasdaq.com/api/calendar/economicevents';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

/** The watchlist's ids (api/_lib/econ.js) and the names Nasdaq files them under. */
const NAMES = {
  'cpi-m': ['CPI'],
  'cpi-y': ['CPI'],
  'core-cpi-m': ['Core CPI'],
  'core-cpi-y': ['Core CPI'],
  'core-pce-m': ['Core PCE Price Index', 'Core PCE Prices', 'Core PCE'],
  'ppi-m': ['PPI'],
  'core-ppi-m': ['Core PPI'],
  'retail-m': ['Retail Sales'],
  'core-retail-m': ['Core Retail Sales'],
  claims: ['Initial Jobless Claims'],
  unemployment: ['Unemployment Rate'],
  gdp: ['GDP', 'GDP (QoQ)', 'GDP Growth Rate'],
  'gdp-price': ['GDP Price Index'],
};

const blank = (v) => {
  const s = String(v ?? '').replace(/&nbsp;/g, ' ').trim();
  return s && s !== '-' ? s : null;
};
/** "1,697K" → 1697, "0.4%" → 0.4, "-5.5%" → -5.5; units are compared by shape, not converted. */
const numberOf = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && blank(v) ? n : null;
};
const sameShape = (a, b) => /%/.test(a) === /%/.test(b) && /K/i.test(a) === /K/i.test(b);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const dayAfter = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * How far a calendar row is from a release: the gaps between their consensus
 * and forecast, and between their previous figures. Null when the row cannot
 * be this release — a different unit, or neither figure anywhere close.
 */
export function distance(row, release) {
  const pairs = [[row.consensus, release.forecast], [row.previous, release.previous]]
    .filter(([a, b]) => blank(a) && blank(b) && sameShape(a, b));
  if (!pairs.length) return null;
  let total = 0;
  let close = false;
  for (const [a, b] of pairs) {
    const x = numberOf(a);
    const y = numberOf(b);
    if (x == null || y == null) continue;
    const gap = Math.abs(x - y);
    total += gap;
    // A revised previous moves a little; a month-on-month against a year-on-year does not.
    if (gap <= Math.max(0.15, Math.abs(y) * 0.06)) close = true;
  }
  return close ? total : null;
}

/** Each release's printed figure from a day's calendar rows: Map id → actual. */
export function matchActuals(rows, releases) {
  const us = (rows ?? []).filter((r) => /united states/i.test(r?.country ?? '') && blank(r?.actual));
  const out = new Map();
  for (const release of releases ?? []) {
    const names = (NAMES[String(release.id).split(':')[0]] ?? []).map(norm);
    if (!names.length) continue;
    let best = null;
    for (const row of us) {
      if (!names.includes(norm(row.eventName))) continue;
      const d = distance(row, release);
      if (d != null && (!best || d < best.d)) best = { d, actual: blank(row.actual) };
    }
    if (best) out.set(release.id, best.actual);
  }
  return out;
}

/**
 * The printed figure of every release in the list that Nasdaq has, as
 * Map id → "200K". Releases still to come, or Nasdaq not answering, are
 * simply absent: FRED and BLS stand behind this.
 */
export async function fetchActuals(releases, { fetchImpl = fetch, now = new Date(), timeoutMs = 5000 } = {}) {
  const today = now.toISOString().slice(0, 10);
  const due = (releases ?? []).filter((r) => r?.date && r.date <= today && NAMES[String(r.id).split(':')[0]]);
  if (!due.length) return new Map();
  const dates = [...new Set(due.flatMap((r) => [r.date, dayAfter(r.date)]))];
  const pages = await Promise.allSettled(dates.map(async (date) => {
    const res = await fetchImpl(`${BASE}?date=${date}`, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Nasdaq calendar answered ${res.status}`);
    return (await res.json())?.data?.rows ?? [];
  }));
  const rows = pages.flatMap((p) => (p.status === 'fulfilled' ? p.value : []));
  return matchActuals(rows, due);
}
