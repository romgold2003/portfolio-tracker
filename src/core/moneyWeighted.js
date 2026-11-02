/**
 * The money-weighted return (November 2026): the second of the two ways
 * brokers measure an account, for the brokers that use it.
 *
 * Time-weighted (portfolioHistory.js, dayGrowth) compounds each day's return
 * and so ignores how much money was in the account when: it is what
 * Interactive Brokers reports, and how funds and indexes are measured.
 * Money-weighted is the one rate that, earned on every dollar for as long as it
 * was in the account, turns the opening balance and every deposit and
 * withdrawal into the closing balance — the internal rate of return. A good
 * month with a large deposit just before it counts for more. Fidelity
 * ("personal rate of return") and Vanguard say so in their own disclosures,
 * and Trading 212's "Rate of return" has used it since 2025.
 *
 * With no deposit or withdrawal in the window the two are the same number.
 *
 * Money moving in or out lands at mid-day, as in dayGrowth, so a one-day
 * window here agrees with that day's time-weighted return; money that joined at
 * the close (a combined account's opening balance) lands at the close.
 *
 * Pure: no DOM, no storage.
 */

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * The window's opening balance, its flows as [day, amount] from the opening,
 * its length in days and its closing balance — the same window
 * periodReturnFromHistory measures: from the day before `from` (or the first
 * day with money in it) to `to`.
 */
function windowOf(rows, from, to) {
  const list = rows ?? [];
  // A window reaching back past where a history that already held money begins cannot be measured.
  const first = list[0];
  if (from && first && first.date > from && first.totalAccountValue > 0) return null;

  let start = -1;
  for (let i = 1; i < list.length; i++) {
    if (from && list[i].date < from) continue;
    if (to && list[i].date > to) break;
    if (list[i - 1].totalAccountValue > 0) { start = i - 1; break; }
  }
  if (start < 0) return null;

  const opened = list[start].date;
  const flows = [];
  let paidIn = 0;
  let end = start;
  for (let i = start + 1; i < list.length; i++) {
    const row = list[i];
    if (to && row.date > to) break;
    const flow = Number(row.externalCashFlow) || 0;
    const atClose = Number(row.joinedAtClose) || 0;
    const day = daysBetween(opened, row.date);
    if (flow - atClose) flows.push([day - 0.5, flow - atClose]);
    if (atClose) flows.push([day, atClose]);
    paidIn += flow;
    end = i;
  }
  if (end === start) return null;
  return {
    startValue: list[start].totalAccountValue,
    endValue: list[end].totalAccountValue,
    days: daysBetween(opened, list[end].date),
    flows,
    paidIn,
  };
}

/**
 * The growth G of a dollar held for the whole window — the return is G − 1 —
 * such that the opening balance and every flow, each grown for the part of
 * the window it was in, add up to the closing balance:
 *
 *   start·G + Σ flow·G^((days − day)/days) = end
 *
 * Found by bisection on log G, which is safe where Newton is not: the left side
 * only rises with G whenever money went in rather than out. Null when no rate
 * fits (a window that ends with nothing in it, or withdrawals larger than
 * everything that was ever there).
 */
function solveGrowth({ startValue, endValue, days, flows }) {
  const value = (y) => startValue * Math.exp(y)
    + flows.reduce((sum, [day, amount]) => sum + amount * Math.exp((y * (days - day)) / days), 0)
    - endValue;
  let lo = -30;
  let hi = 30;
  const fLo = value(lo);
  const fHi = value(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let k = 0; k < 200 && hi - lo > 1e-12; k++) {
    const mid = (lo + hi) / 2;
    const f = value(mid);
    if ((f > 0) === (fHi > 0)) hi = mid;
    else lo = mid;
  }
  return Math.exp((lo + hi) / 2);
}

/**
 * The window's money-weighted return, shaped like periodReturnFromHistory's:
 * `{ returnPct, pnl, startValue, endValue, paidIn }`, or null when the history
 * cannot measure it. The dollar profit is the same under either method.
 *
 * Should no single rate fit, the Modified Dietz estimate stands in: the profit
 * over the average money in the account. It is what money-weighted returns
 * were computed as before computers made the exact one cheap, and is within a
 * fraction of a point of it in ordinary windows.
 */
export function moneyWeightedReturn(rows, from = null, to = null) {
  const w = windowOf(rows, from, to);
  if (!w) return null;
  const pnl = w.endValue - w.startValue - w.paidIn;
  const growth = solveGrowth(w);
  let returnPct;
  if (growth != null) returnPct = (growth - 1) * 100;
  else {
    const average = w.startValue + w.flows.reduce((sum, [day, amount]) => sum + (amount * (w.days - day)) / w.days, 0);
    if (!(average > 0)) return null;
    returnPct = (pnl / average) * 100;
  }
  return {
    returnPct, pnl, startValue: w.startValue, endValue: w.endValue, paidIn: w.paidIn,
  };
}

/**
 * The % chart, money-weighted: each day's point is the return from the
 * account's first day to that one, as a broker using this method would show
 * it on that day. Same shape as returnCurve's points.
 */
export function moneyWeightedCurve(rows) {
  const list = rows ?? [];
  const start = list.findIndex((r) => r.totalAccountValue > 0);
  if (start < 0) return [];
  const out = [{ date: list[start].date, pct: 0, value: list[start].totalAccountValue }];
  const tail = list.slice(start);
  for (let i = 1; i < tail.length; i++) {
    const measured = moneyWeightedReturn(tail.slice(0, i + 1));
    const last = out[out.length - 1].pct;
    out.push({ date: tail[i].date, pct: measured ? measured.returnPct : last, value: tail[i].totalAccountValue });
  }
  return out;
}
