/**
 * The account's return over a window, day by day, for the % view of the chart.
 *
 * Asked for in October 2026: the same curve as the dollar one, read as the
 * percentage made since the window began. It is the time-weighted return the
 * broker reports — each day's change in value, less the money paid in or taken
 * out that day, over the day before, compounded — so a deposit lifts the dollar
 * curve and leaves this one where it was. Its last point is the window's return
 * in the KPI below the chart (periodReturnFromHistory), measured identically.
 *
 * Checked against every IBKR statement Romy downloaded from 28 August to 14
 * October: tests/return-curve.test.mjs.
 */

/**
 * `rows` are daily values `{date, totalAccountValue, externalCashFlow}`,
 * ascending. The base is the day before `from`, as in periodReturnFromHistory;
 * with no `from`, the first day with money in it. Each point is
 * `{date, pct, value}`, the first at 0%.
 */
export function returnCurve(rows, from = null) {
  const list = rows ?? [];
  let start = from ? list.findIndex((r) => r.date >= from) - 1 : list.findIndex((r) => r.totalAccountValue > 0);
  // The window opens on the first day held: that day is the base.
  if (from && start < 0) start = list.findIndex((r) => r.date >= from);
  if (start < 0 || start >= list.length) return [];
  while (start < list.length && !(list[start].totalAccountValue > 0)) start += 1;
  if (start >= list.length) return [];

  let growth = 1;
  const out = [{ date: list[start].date, pct: 0, value: list[start].totalAccountValue }];
  for (let i = start + 1; i < list.length; i++) {
    const prev = list[i - 1].totalAccountValue;
    const row = list[i];
    // A day the account held nothing has no return; the curve carries on flat.
    if (prev > 0) growth *= (row.totalAccountValue - (Number(row.externalCashFlow) || 0)) / prev;
    out.push({ date: row.date, pct: (growth - 1) * 100, value: row.totalAccountValue });
  }
  return out;
}
