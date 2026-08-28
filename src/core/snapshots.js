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

function daysForTimeframe(tf) {
  return TIMEFRAME_DAYS[tf] ?? TIMEFRAME_DAYS['3M'];
}

/**
 * The series for the account curve.
 *
 * A fresh install has no history, so with fewer than two real snapshots we draw
 * a smooth placeholder that ends on the true current value. It is illustrative
 * only, and is replaced by real points as the app is used day to day.
 */
export function curveSeries(timeframe) {
  const days = daysForTimeframe(timeframe);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

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
  const first = data[0];
  const last = data[data.length - 1];
  return { labels, data, synthetic, returnPct: first ? ((last - first) / first) * 100 : 0 };
}
