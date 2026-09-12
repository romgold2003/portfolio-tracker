/**
 * The account against the indexes, all three as percentages from a common start.
 *
 * A comparison is only honest if every line answers the same question over the
 * same days, so all three are rebased to zero on the first day of the window and
 * accumulate from there. What you read off the right-hand end is how far ahead
 * of — or behind — the market the account finished.
 *
 * The account's line is a chained daily return, which is what makes it
 * comparable at all: an index has no deposits, and a line that stepped up every
 * time money was paid in would beat the market on funding rather than on
 * performance. That chaining happens in snapshots.js; this module takes the
 * finished percentages and lines the indexes up beside them.
 *
 * Pure: no network, no storage, no DOM. The rows come from whoever fetched them.
 */

/**
 * The last close on or before a date.
 *
 * Indexes only print on trading days, and the account has a value every day, so
 * a weekend or a holiday would otherwise leave a hole in the middle of the
 * index line. Carrying the previous close forward is what a market being shut
 * actually means: the level did not change, because nothing traded.
 *
 * `rows` must be ascending by date.
 */
export function closeOn(rows, date) {
  let found = null;
  for (const row of rows) {
    if (!row?.date || row.date > date) break;
    if (Number.isFinite(row.close) && row.close > 0) found = row.close;
  }
  return found;
}

/**
 * One index rebased to the window, as a percentage from its first day.
 *
 * Returns null when the index has no close at or before the window opens. That
 * happens when the history fetch came back short, and a line drawn from the
 * first day it *does* cover would be rebased to a different start than the
 * account beside it — which is the one thing a comparison chart must never do.
 * Better an absent line, named as absent, than two lines measured from
 * different mornings.
 */
export function rebase(rows, dates) {
  if (!Array.isArray(rows) || !rows.length || !dates.length) return null;

  const base = closeOn(rows, dates[0]);
  if (!(base > 0)) return null;

  let last = base;
  return dates.map((date) => {
    const close = closeOn(rows, date) ?? last;
    last = close;
    return +(((close / base) - 1) * 100).toFixed(4);
  });
}

/**
 * The account and every index it is being compared against, ready to draw.
 *
 * `indexes` is `[{ symbol, name, colour, rows }]`; anything whose history could
 * not be rebased is dropped from `lines` and named in `missing`, so the chart
 * can say which comparison is absent instead of quietly showing fewer lines.
 */
export function benchmarkLines({ dates, percent, indexes = [] }) {
  const lines = [{ key: 'account', name: 'Your portfolio', data: percent ?? [] }];
  const missing = [];

  for (const index of indexes) {
    const data = rebase(index?.rows, dates ?? []);
    if (!data) {
      missing.push(index?.name ?? index?.symbol ?? 'an index');
      continue;
    }
    lines.push({ key: index.symbol, name: index.name, colour: index.colour, data });
  }

  return { lines, missing };
}

/**
 * How far ahead of each index the account finished, in points.
 *
 * Stated as a difference of two percentages rather than a ratio, because that
 * is what the two lines on the chart are: the gap you can see between their
 * right-hand ends.
 */
export function leadOver(lines) {
  const account = lines.find((l) => l.key === 'account');
  const endOf = (line) => (line?.data?.length ? line.data[line.data.length - 1] : null);
  const mine = endOf(account);
  if (mine == null) return [];

  return lines
    .filter((l) => l.key !== 'account')
    .map((l) => {
      const theirs = endOf(l);
      return theirs == null ? null : { name: l.name, points: +(mine - theirs).toFixed(2) };
    })
    .filter(Boolean);
}
