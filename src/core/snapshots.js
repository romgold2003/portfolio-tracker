/**
 * The account-value curve: a daily point of net liquidation value, and the
 * series the chart draws from it.
 */
import { state, saveSnapshots } from './store.js';
import { spliceHistory } from './rebuild.js';
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
 * The reconstructed days before the recording began.
 *
 * Held here rather than recomputed on every draw: it needs a price history per
 * ticker and renderHome runs on every tick. Set once the histories land, and
 * empty until then — so the curve starts as the recording alone and lengthens
 * when the back-cast arrives, rather than blocking on the network.
 */
let backfill = [];

/**
 * The full daily dataset behind the curve, when one has been built.
 *
 * Kept whole rather than reduced to date-and-value because the chart needs the
 * cash-flow fields to mark deposits, and the percentage and index curves will
 * need the same rows rather than a second reconstruction of their own.
 */
let history = [];

/**
 * The forward-walked history, when the book has a statement behind it.
 *
 * Separate from `backfill` because the two earn different treatment: a forward
 * walk is authoritative and used as it stands, a back-cast is an estimate that
 * gets spliced under the recording.
 */
let forward = [];

export function setBackfill(rows, { authoritative = false } = {}) {
  history = Array.isArray(rows) ? rows : [];
  forward = authoritative ? history : [];
  /**
   * The per-day money fields travel with the balance into the splice.
   *
   * Reducing each row to a date and a value here is what left the splice with
   * nothing but balances to join, so the percentage curve downstream had to go
   * looking for the deposits elsewhere and match them by date against days that
   * might not be there. Carried along, they stay attached to the day they
   * happened on and get scaled with it.
   */
  backfill = history.map((r) => {
    const row = { date: r.date, value: r.totalAccountValue ?? r.value };
    for (const field of ['externalCashFlow', 'marketPnl', 'deposit', 'withdrawal']) {
      if (Number.isFinite(r[field])) row[field] = r[field];
    }
    return row;
  });
}

export function backfillRows() { return backfill; }

/** The daily portfolio history: value, cash, positions and external flows. */
export function portfolioHistory() { return history; }

/**
 * Money paid in or taken out, by day, for marking on the chart.
 *
 * Two sources, and the second is the one that matters. The daily history knows
 * its own flows — but only the forward walk produces those fields, and that
 * needs a statement imported since the ledger existed. A book imported before
 * then still *has* its deposits, in `cashFlows`, and they are just as real.
 *
 * Reading only the history meant a real account with five recorded transfers
 * showed no markers at all, which reads as "I never deposited" rather than
 * "this build cannot see them".
 */
export function externalFlows() {
  const fromHistory = history
    .filter((r) => r?.date && r.externalCashFlow)
    .map((r) => ({ date: r.date, amount: r.externalCashFlow }));
  if (fromHistory.length) return fromHistory;

  // Netted per day, so two transfers on one date are one marker.
  const byDay = new Map();
  for (const flow of state.cashFlows ?? []) {
    if (!flow?.date || !Number.isFinite(flow.amount)) continue;
    byDay.set(flow.date, (byDay.get(flow.date) ?? 0) + flow.amount);
  }
  return [...byDay.entries()]
    .filter(([, amount]) => amount)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Every account value known, recorded or reconstructed, oldest first.
 *
 * This is what every window is cut from. It is the whole reason "YTD" can mean
 * the year rather than "since the app was installed".
 */
export function accountHistory() {
  /**
   * A forward-walked history wins outright, and is not spliced under the
   * recording.
   *
   * The splice exists to join a *back-cast* onto the recorded days, scaling it
   * so the two meet without a step. That is the right treatment for an
   * estimate. It is the wrong treatment for this one: the forward walk is
   * checked against the statement it came from — exact on the opening balance,
   * exact on every closing quantity — and scaling it to land on the app's own
   * observations would bend the better number onto the worse one.
   *
   * It also already covers every day to today, so there is nothing left for the
   * recording to add.
   */
  if (forward.length) return forward;
  return spliceHistory(state.snapshots, backfill);
}

/**
 * The same window as a percentage, day by day, starting at zero.
 *
 *   r(d)     = ( value(d) − flow(d) − value(d−1) ) / value(d−1)
 *   index(d) = ( PROD( 1 + r ) − 1 ) × 100
 *
 * The day's gain over the balance that earned it, compounded. Subtracting the
 * flow is what keeps a deposit out: the money lands in value(d) and is taken
 * straight back out, so the balance steps up and the line does not.
 *
 * Chained rather than measured against the first day, because those are not the
 * same question. Measuring dollars gained against the starting balance credits
 * the whole year's profit to the money that began it — so paying more money in
 * earns more dollars, divided by the same base, and the percentage rises
 * without a single trade going better. Chaining divides each day's gain by the
 * balance that actually earned it, which is why it is the measure a broker
 * reports and why it is the one that a deposit genuinely cannot move.
 */
/**
 * How small a balance has to be, next to the money landing on it, before the
 * day is treated as the account being opened rather than added to.
 */
const FOUNDING_RATIO = 0.01;

/**
 * Money moved, attributed to the step of the curve it happened in.
 *
 * Where the rows carry their own flows, those are used and nothing is matched:
 * a row from the daily walk knows what moved that day because the walk applied
 * it, so the number cannot be mis-dated or missed.
 *
 * Otherwise the recorded list is placed by window. Each flow lands on the first
 * drawn day at or after it — not by exact date, because a recorded curve only
 * holds the days the app was open, and a deposit on any other day would match
 * nothing, never be subtracted, and be drawn as a gain. A flow at or before the
 * first day is already inside the opening balance and is not counted again.
 */
function flowsByStep(points, dates, synthetic) {
  const byStep = new Map();
  if (synthetic) return byStep;

  let carried = 0;
  for (let i = 0; i < points.length; i++) {
    const amount = Number(points[i]?.externalCashFlow) || 0;
    if (!amount) continue;
    if (i > 0) byStep.set(i, (byStep.get(i) ?? 0) + amount);
    carried += 1;
  }
  if (carried) return byStep;

  for (const flow of externalFlows()) {
    if (!flow?.date || !Number.isFinite(flow.amount)) continue;
    let step = -1;
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] >= flow.date) { step = i; break; }
    }
    if (step <= 0) continue;
    byStep.set(step, (byStep.get(step) ?? 0) + flow.amount);
  }
  return byStep;
}

function percentCurve(values, dates, synthetic, points = []) {
  /**
   * Where the days know what they earned, that is the measure.
   *
   *   r(d) = marketPnl(d) / ( value(d−1) − unpriceable(d−1) )
   *
   * The numerator is price moves on shares held overnight plus dividends and
   * fees. No cash term, so a deposit cannot enter it — and no mark term, so a
   * holding the price service cannot quote cannot enter it either. That second
   * one is what the balance-based measure could never survive: the marks are
   * trade prices, so an unquotable holding's mark steps on the day it was
   * traded, and the balance steps with it. On a book carrying one such holding
   * that drew a twenty-four point jump in a single day and left the year nearly
   * ten points high.
   *
   * The base drops the unpriceable part too, so a real numerator is not divided
   * by a larger denominator. What is left is a true statement about the part of
   * the book that can be measured, and `pricedShare` says how much of it that
   * is — because a figure covering half an account should not be read as
   * covering all of it.
   */
  const measured = !synthetic && points.some((p) => Number.isFinite(p?.marketPnl));
  if (measured) {
    let growth = 1;
    let netted = 0;
    let priced = 0;
    let counted = 0;

    const curve = points.map((row, i) => {
      if (i === 0) return 0;
      const prev = points[i - 1];
      const total = values[i - 1] || 0;
      const base = total - (Number(prev?.stalePositions) || 0);
      if (total > 0) { priced += base / total; counted += 1; }
      if (base > 0) growth *= 1 + (Number(row?.marketPnl) || 0) / base;
      netted += Math.abs(Number(row?.externalCashFlow) || 0);
      return +((growth - 1) * 100).toFixed(4);
    });

    return { curve, netted, pricedShare: counted ? priced / counted : 1 };
  }

  const flows = flowsByStep(points, dates, synthetic);
  // Gross rather than net: a deposit and a withdrawal of the same size are two
  // movements kept out of the return, not zero.
  let netted = 0;
  let growth = 1;

  const curve = values.map((value, i) => {
    if (i === 0) return 0;
    const prev = values[i - 1];
    const flow = flows.get(i) ?? 0;
    /**
     * The day an account is founded has no balance behind it to measure
     * against. A book opened with $42,000 against $287 of residue divided that
     * residue by itself, came out at −100%, and one multiplication by zero
     * flattened every day of the year that followed.
     */
    const founding = Math.abs(flow) > 0 && prev < Math.abs(flow) * FOUNDING_RATIO;
    if (prev > 0 && !founding) {
      growth *= 1 + (value - flow - prev) / prev;
      netted += Math.abs(flow);
    }
    return +((growth - 1) * 100).toFixed(4);
  });

  return { curve, netted, pricedShare: 1 };
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
  const cutoff = cutoffFor(timeframe);

  const history = accountHistory();
  let points = history.filter((s) => new Date(s.date) >= cutoff);
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
  /**
   * Two row shapes reach here and both are legitimate.
   *
   * A recorded snapshot is `{date, value}` — it only ever knew the one number.
   * A row from the daily portfolio history is `{date, totalAccountValue, ...}`,
   * because the percentage and index curves will need its cash and flow fields
   * too. Reading only `value` turned every day of the richer one into undefined.
   */
  const data = points.map((s) => +Number(s.totalAccountValue ?? s.value ?? 0).toFixed(2));
  // Kept alongside the values so a cash flow can be matched to the day it
  // landed on — a percentage curve is wrong without that.
  const dates = points.map((s) => s.date);
  const first = data[0];
  const last = data[data.length - 1];

  /**
   * Money paid in or taken out between the two endpoints.
   *
   * Strictly after the opening day: a deposit on the first day is already
   * inside `first`, so subtracting it too would count it twice.
   */
  const paidIn = synthetic ? 0 : externalFlows().reduce((sum, f) => (
    f.date > points[0].date && f.date <= points[points.length - 1].date
      ? sum + f.amount
      : sum
  ), 0);

  // The requested window is often longer than the history on file. Reporting
  // the span actually covered stops "1Y" from claiming a year of data that was
  // never recorded.
  const from = points[0].date;
  const to = points[points.length - 1].date;
  const coveredDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000));

  /**
   * Where the window was asked to begin, and whether the record got there.
   *
   * Account values are only written on days the app is open, so they begin the
   * day it was installed. Every window longer than that quietly becomes "since
   * you started" while still wearing the name of the window — a YTD curve drew
   * six weeks and reported 6.34% where the figure above it, counted from the
   * trades, said 25.49% for the actual year to date. Both were right about
   * different periods and neither said which.
   */
  const wanted = timeframe === 'All' ? null : cutoffFor(timeframe).toISOString().slice(0, 10);

  /**
   * Measured against the whole recording, not against the first point inside
   * the window.
   *
   * The cutoff carries a time of day and a snapshot date does not, so the first
   * point of any rolling window lands a day after it — which made every single
   * timeframe, including a fully covered 1W, report itself as truncated. What
   * actually matters is whether the record reaches back that far at all.
   */
  const firstRecorded = history.reduce(
    (earliest, s) => (s?.date && (earliest == null || s.date < earliest) ? s.date : earliest),
    null,
  );
  const short = !synthetic && wanted != null && firstRecorded != null && firstRecorded > wanted;
  const { curve: percent, netted: flowsNetted, pricedShare } = percentCurve(data, dates, synthetic, points);

  return {
    labels,
    data,
    percent,
    dates,
    synthetic,
    from,
    to,
    coveredDays,
    /** The date the window was asked to start at, or null for All. */
    wanted,
    /** True when the recording begins after that, so this is a shorter window. */
    short,
    /**
     * What the window earned, and what that was as a percentage.
     *
     * Both are net of money paid in or taken out inside the window. The raw
     * difference between the two endpoints is not a gain: a $10,000 deposit
     * makes the curve step up $10,000, and reading that as profit is the exact
     * error every return in this app is built to avoid. So the flows that
     * landed inside the window come off the top, and the base is the balance
     * the window opened with — a deposit is then out of both halves and cannot
     * move the percentage.
     *
     * `paidIn` is reported alongside so a caller can say why the curve rose
     * further than the return did.
     */
    gain: last - first - paidIn,
    paidIn,
    /**
     * External cash the percentage chain actually took out.
     *
     * Reported so the chart can state it rather than leave it to be trusted.
     * When this reads zero on a book that has had deposits, the return is
     * counting them as performance and the figure is wrong by roughly the
     * deposits over the opening balance — which is a thing worth seeing on the
     * screen rather than discovering by arithmetic.
     */
    flowsNetted,
    /** How much of the account the percentage line actually measures, 0 to 1. */
    pricedShare,
    /**
     * The return the drawn percentage line ends on, so the figure and the chart
     * can never disagree.
     *
     * Chained daily rather than measured end to end. Both are deposit-neutral,
     * but only the chained one survives a window whose first day is zero — an
     * account founded inside the window — where dividing by the opening balance
     * has nothing to divide by.
     */
    returnPct: percent[percent.length - 1] ?? 0,
  };
}
