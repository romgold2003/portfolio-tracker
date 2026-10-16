/**
 * Every trading day's return, for the daily log beside the chart.
 *
 * Read off the same daily history the chart draws, so the two can never
 * disagree. A day is the move from the previous trading day's close to this
 * one's, less any money paid in or taken out in between — a deposit is not a
 * gain — measured the way every return here is: (value − flow) / previous − 1.
 *
 * Only days the market traded count. A weekend or holiday row carries Friday's
 * prices and moves nothing; money that landed on one is carried to the next
 * trading day rather than lost. A day joins the log once its session has
 * closed (`through`), so today appears by itself after four in New York.
 */
import { marketHoliday } from '../config/marketCalendar.js';

const valueOf = (row) => Number(row?.totalAccountValue ?? row?.value);

/**
 * `rows` oldest first: { date, totalAccountValue | value, externalCashFlow? }.
 * Returns oldest first: { date, value, pnl, pct, flow }.
 */
export function dailyReturns(rows, { through } = {}) {
  const out = [];
  let prev = null;
  let flow = 0;
  for (const row of rows ?? []) {
    const date = row?.date;
    const value = valueOf(row);
    if (!date || !Number.isFinite(value)) continue;
    if (through && date > through) break;
    flow += Number(row.externalCashFlow) || 0;
    if (marketHoliday(date)) {
      // The history opens on 1 January, a holiday, at the year's opening
      // balance — which is what the first trading day is measured from.
      if (prev == null) { prev = value; flow = 0; }
      continue;
    }
    if (prev != null && prev > 0) {
      const pnl = value - prev - flow;
      out.push({ date, value, pnl, pct: (pnl / prev) * 100, flow });
    }
    prev = value;
    flow = 0;
  }
  return out;
}

/** The years with at least one day, newest first. */
export function yearsOf(days) {
  return [...new Set((days ?? []).map((d) => Number(d.date.slice(0, 4))))].sort((a, b) => b - a);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Compounded, as returns are: two +10% days are +21%, not +20%. */
const compound = (days) => (days.reduce((g, d) => g * (1 + d.pct / 100), 1) - 1) * 100;
const total = (days) => days.reduce((s, d) => s + d.pnl, 0);

/**
 * One year, for the window: its months newest first, each with its days newest
 * first and its own total, and the year's summary.
 */
export function yearView(days, year) {
  const inYear = (days ?? []).filter((d) => d.date.startsWith(`${year}-`));
  const byMonth = new Map();
  for (const d of inYear) {
    const key = d.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(d);
  }
  const months = [...byMonth].sort(([a], [b]) => b.localeCompare(a)).map(([key, list]) => ({
    key,
    label: MONTH_NAMES[Number(key.slice(5, 7)) - 1],
    pct: compound(list),
    pnl: total(list),
    days: [...list].reverse(),
  }));
  const best = inYear.reduce((b, d) => (!b || d.pct > b.pct ? d : b), null);
  const worst = inYear.reduce((w, d) => (!w || d.pct < w.pct ? d : w), null);
  return {
    year,
    months,
    pct: compound(inYear),
    pnl: total(inYear),
    up: inYear.filter((d) => d.pnl > 0).length,
    down: inYear.filter((d) => d.pnl < 0).length,
    best,
    worst,
    // The bars in each row are drawn against the year's largest move.
    scale: Math.max(...inYear.map((d) => Math.abs(d.pct)), 0.01),
  };
}
