/**
 * The US releases worth watching, from ForexFactory's calendar feed.
 *
 * The feed is the one ForexFactory publishes itself, and it covers a single
 * week — there is no month or history endpoint, and asking for one returns a
 * 404. That shapes everything here: in any given week only two or three of the
 * releases below are actually scheduled, so what the feed hands over is merged
 * into what was last seen rather than replacing it. CPI does not vanish from
 * the panel for the three weeks between prints.
 *
 * Only the figures are kept — the name, when it lands, what is expected, and
 * what it was last time. No commentary, no headlines.
 */

/**
 * What to watch, in the order it should read.
 *
 * Matched on the feed's own titles. GDP is a pattern rather than a list because
 * the same quarter arrives three times under three names — advance, prelim,
 * final — and all three are worth seeing.
 */
export const WATCHLIST = [
  { id: 'cpi-m', label: 'CPI m/m', match: /^CPI m\/m$/i },
  { id: 'cpi-y', label: 'CPI y/y', match: /^CPI y\/y$/i },
  { id: 'core-cpi-m', label: 'Core CPI m/m', match: /^Core CPI m\/m$/i },
  { id: 'core-cpi-y', label: 'Core CPI y/y', match: /^Core CPI y\/y$/i },
  { id: 'ppi-m', label: 'PPI m/m', match: /^PPI m\/m$/i },
  { id: 'core-ppi-m', label: 'Core PPI m/m', match: /^Core PPI m\/m$/i },
  { id: 'retail-m', label: 'Retail Sales m/m', match: /^Retail Sales m\/m$/i },
  { id: 'core-retail-m', label: 'Core Retail Sales m/m', match: /^Core Retail Sales m\/m$/i },
  { id: 'claims', label: 'Unemployment Claims', match: /^Unemployment Claims$/i },
  { id: 'unemployment', label: 'Unemployment Rate', match: /^Unemployment Rate$/i },
  { id: 'gdp', label: 'GDP', match: /\bGDP\b/i, keepTitle: true },
];

/** The feed says USD for the United States. */
const US = 'USD';

/**
 * Pick the rows worth keeping out of a week of the calendar.
 *
 * A release with neither a forecast nor a previous is dropped: it is a diary
 * entry rather than a number, and a row of two dashes is not information.
 */
export function selectReleases(events, watchlist = WATCHLIST) {
  const found = [];

  for (const entry of watchlist) {
    const matches = (events || [])
      .filter((e) => e && e.country === US && typeof e.title === 'string' && entry.match.test(e.title))
      .filter((e) => clean(e.forecast) || clean(e.previous));

    for (const e of matches) {
      found.push({
        id: entry.keepTitle ? `${entry.id}:${slug(e.title)}` : entry.id,
        label: entry.keepTitle ? e.title : entry.label,
        date: typeof e.date === 'string' ? e.date.slice(0, 10) : null,
        impact: e.impact || null,
        forecast: clean(e.forecast),
        previous: clean(e.previous),
      });
    }
  }

  return found;
}

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && s !== '-' ? s : null;
};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Fold this week's releases into what was already known.
 *
 * A release seen again replaces its earlier copy — the newer print is the one
 * that matters, and its "previous" is the older one's actual. Anything not in
 * this week's feed is carried through untouched, which is the whole point.
 */
export function mergeReleases(stored, fresh) {
  const byId = new Map((stored || []).map((r) => [r.id, r]));
  for (const r of fresh) {
    const existing = byId.get(r.id);
    // Only move forward. A late-arriving feed must not rewind a newer print.
    if (existing && existing.date && r.date && r.date < existing.date) continue;
    byId.set(r.id, r);
  }
  return [...byId.values()];
}

/**
 * Order for display: the watchlist's own order, and within a repeated entry —
 * the GDP releases — the most recent first.
 */
export function orderReleases(rows, watchlist = WATCHLIST) {
  const rank = new Map(watchlist.map((w, i) => [w.id, i]));
  const baseId = (id) => id.split(':')[0];
  return [...rows].sort((a, b) => {
    const ra = rank.get(baseId(a.id)) ?? 999;
    const rb = rank.get(baseId(b.id)) ?? 999;
    if (ra !== rb) return ra - rb;
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
}
