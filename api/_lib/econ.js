/**
 * The US releases due this week, from ForexFactory's calendar feed.
 *
 * The feed ForexFactory publishes covers exactly one week, and that is the
 * window this panel wants: what is landing between now and Sunday. It rolls
 * over on its own every Monday, so nothing here has to schedule anything — ask
 * it on Monday and it answers about the new week.
 *
 * Which means the panel is short most weeks, and that is correct rather than a
 * gap to be filled. A week with only jobless claims in it is a week with only
 * jobless claims in it.
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
 * Order for display: through the week, earliest first.
 *
 * The panel is a schedule, so it reads like one. Two releases on the same day —
 * CPI and core CPI always arrive together — fall back to the watchlist's order
 * so the headline reading sits above its core.
 */
export function orderReleases(rows, watchlist = WATCHLIST) {
  const rank = new Map(watchlist.map((w, i) => [w.id, i]));
  const baseId = (id) => id.split(':')[0];
  return [...rows].sort((a, b) => {
    const byDate = String(a.date || '').localeCompare(String(b.date || ''));
    if (byDate !== 0) return byDate;
    return (rank.get(baseId(a.id)) ?? 999) - (rank.get(baseId(b.id)) ?? 999);
  });
}

/**
 * The Monday-to-Sunday week a date falls in, as ISO days.
 *
 * Only for labelling the panel. The feed decides what is in the week; this just
 * says which week that was, so a stale answer is recognisable as one.
 */
export function weekOf(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  // getUTCDay is 0 on Sunday, which belongs to the week that began six days ago.
  const shift = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - shift);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
