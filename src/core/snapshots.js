/**
 * The account-value curve: a daily point of net liquidation value, and the
 * series the chart draws from it.
 */
import { state, saveSnapshots } from './store.js';
import { posValue, realized, costOf, unreal, todayStr } from './portfolio.js';
import { TIMEFRAME_DAYS } from '../config/constants.js';

/** Record (or overwrite) today's account value. Idempotent within a day. */
export function recordDailySnapshot() {
  const open = state.positions.filter((p) => p.status === 'Open');
  const account = open.reduce((sum, p) => sum + posValue(p), 0) + state.cash;
  const today = todayStr();
  const existing = state.snapshots.find((s) => s.date === today);
  if (existing) existing.value = account;
  else state.snapshots.push({ date: today, value: account });
  saveSnapshots();
}

export function daysForTimeframe(tf) {
  if (tf === 'YTD') return daysSinceJanuaryFirst();
  return TIMEFRAME_DAYS[tf] ?? TIMEFRAME_DAYS['3M'];
}

function daysSinceJanuaryFirst() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.max(1, Math.round((now - start) / 86400000));
}

/**
 * The date a timeframe begins.
 *
 * Every other window is "N days back from now". Year to date is a calendar
 * boundary instead — the first of January, whatever that happens to be today —
 * so counting days back would drift by one around midnight and around the turn
 * of the year. The boundary is used directly.
 *
 * It is built in UTC because snapshot dates are plain `YYYY-MM-DD` strings,
 * which `new Date()` parses as UTC midnight. A local-midnight boundary would sit
 * a few hours *after* the 1st of January west of Greenwich, and quietly drop
 * that day's point from the window.
 */
export function cutoffFor(timeframe, now = new Date()) {
  if (timeframe === 'YTD') {
    return new Date(Date.UTC(now.getFullYear(), 0, 1));
  }
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - daysForTimeframe(timeframe));
  return cutoff;
}

/**
 * Where a year-to-date window really begins for this account.
 *
 * The first of January, or the day the account started if that is later. An
 * account opened in August has no eight-month return, and inventing one by
 * treating the months before it as flat would report a number that never
 * happened.
 *
 * So until a full year has been recorded, "year to date" means "since you
 * started" — and the moment the calendar turns, it becomes a true year to date
 * on its own, with no switch to throw. An account opened in August 2026 reports
 * since-August for the rest of 2026, and from 1 January 2027 reports the year.
 */
export function periodStart(timeframe, firstRecorded, now = new Date()) {
  const cutoff = cutoffFor(timeframe, now);
  if (!firstRecorded) return cutoff;
  const inception = new Date(firstRecorded);
  return inception > cutoff ? inception : cutoff;
}

/**
 * The series for the account curve.
 *
 * A fresh install has no history, so with fewer than two real snapshots we draw
 * a smooth placeholder that ends on the true current value. It is illustrative
 * only, and is replaced by real points as the app is used day to day.
 */
/**
 * The same window as a percentage return, compounded, with deposits removed.
 *
 * A percentage read straight off the account curve is not a return. Money paid
 * in raises the account without earning anything, and dividing the new value by
 * the old one reports the deposit as performance — on this book a transfer of
 * 2,450 read as profit and put the yearly figure 5 points above what the broker
 * said.
 *
 * So the day's move is measured net of whatever moved in or out that day, taken
 * against the balance that was actually working the day before, and the daily
 * returns are chained:
 *
 *   r_i   = (v_i − v_i−1 − flow_i) / v_i−1
 *   index = Π (1 + r_i) − 1
 *
 * Chaining rather than dividing the ends is what makes it a *time-weighted*
 * return: each day is measured on the capital present that day, so the size and
 * timing of deposits change nothing. It is the same quantity a broker quotes,
 * and the same one the Monthly page's Portfolio % compounds to.
 *
 * The first point is zero by construction — every window starts from where it
 * starts, and the curve reads as growth from there.
 */
export function returnSeries(timeframe, flows = []) {
  const base = curveSeries(timeframe);
  const { data, dates } = base;

  /** Net moved in or out on each day, since two can land on one date. */
  const byDay = new Map();
  for (const f of flows ?? []) {
    if (!f?.date || !Number.isFinite(f.amount)) continue;
    byDay.set(f.date, (byDay.get(f.date) ?? 0) + f.amount);
  }

  const out = [0];
  let index = 1;
  for (let i = 1; i < data.length; i += 1) {
    const before = data[i - 1];
    const flow = byDay.get(dates[i]) ?? 0;
    // A day with no capital behind it has no return to speak of; it contributes
    // nothing rather than dividing by zero and poisoning the rest of the chain.
    const r = before > 0 ? (data[i] - before - flow) / before : 0;
    index *= 1 + r;
    out.push(+((index - 1) * 100).toFixed(4));
  }

  return {
    ...base,
    data: out,
    percent: true,
    /** What the whole window came to, which is the last point by construction. */
    returnPct: out[out.length - 1] ?? 0,
  };
}

export function curveSeries(timeframe) {
  const days = daysForTimeframe(timeframe);
  const cutoff = cutoffFor(timeframe);

  let points = state.snapshots.filter((s) => new Date(s.date) >= cutoff);
  const synthetic = points.length < 2;

  if (synthetic) {
    const open = state.positions.filter((p) => p.status === 'Open');
    const closed = state.positions.filter((p) => p.status === 'Closed');
    const base = open.reduce((sum, p) => sum + costOf(p) + unreal(p), 0)
      + closed.reduce((sum, p) => sum + realized(p), 0)
      || 10000;
    points = [];
    const n = Math.min(days, 60);
    for (let i = n; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const progress = 1 - i / n;
      const noise = Math.sin(i * 0.7) * base * 0.01;
      points.push({ date: date.toISOString().split('T')[0], value: base * (0.86 + 0.14 * progress) + noise });
    }
    points[points.length - 1].value = base;
  }

  const labels = points.map((s) => s.date.slice(5));
  const data = points.map((s) => +s.value.toFixed(2));
  // Kept alongside the values so a cash flow can be matched to the day it
  // landed on — a percentage curve is wrong without that.
  const dates = points.map((s) => s.date);
  const first = data[0];
  const last = data[data.length - 1];

  // The requested window is often longer than the history on file. Reporting
  // the span actually covered stops "1Y" from claiming a year of data that was
  // never recorded.
  const from = points[0].date;
  const to = points[points.length - 1].date;
  const coveredDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000));

  return {
    labels,
    data,
    dates,
    synthetic,
    from,
    to,
    coveredDays,
    /** What the account gained or lost across the window, in currency. */
    gain: last - first,
    returnPct: first ? ((last - first) / first) * 100 : 0,
  };
}
