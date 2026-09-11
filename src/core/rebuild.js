/**
 * The account value on days nobody was watching.
 *
 * The recorded curve is a log of what this app observed on the days it was
 * open, and nothing backfills it — the IBKR importer says so in as many words
 * and leaves `snapshots` alone. So an account traded since January but opened
 * in this app in August has a curve that begins in August, and "YTD" drew six
 * weeks while every figure beside it counted the whole year.
 *
 * Everything needed to work out the missing days is already here, though. The
 * trades know what was held and when, the cash flows know what was paid in, and
 * the history service can price any ticker on any past date. So the value of
 * the book on a past day is not a guess:
 *
 *   value(d) = what the open positions were worth at that day's closes
 *            + the cash that had not yet been spent or had already come back
 *
 * Both halves are walked backwards from today, which is the only day whose
 * figures are known exactly.
 */

import { baseQtyOf } from './portfolio.js';

/** Every calendar day from `from` to `to` inclusive, as YYYY-MM-DD. */
export function daysBetween(from, to) {
  const out = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  let at = Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(at) || !Number.isFinite(end)) return out;
  // A year is 365 rows; the cap is there so a corrupt date cannot spin forever.
  while (at <= end && out.length < 4000) {
    out.push(new Date(at).toISOString().slice(0, 10));
    at += 86_400_000;
  }
  return out;
}

/** What one exit paid back: the capital it released plus what it made on it. */
const proceedsOf = (position, exit) => position.entry * exit.qty + (exit.pnl ?? 0);

/** The exits of a position, or the single implied one for a closed trade. */
function exitsOf(position) {
  if (position.exits?.length) return position.exits;
  if (position.status !== 'Closed' || !position.close) return [];
  const qty = baseQtyOf(position);
  const pnl = position.dir === 'Short'
    ? (position.entry - position.cur) * qty
    : (position.cur - position.entry) * qty;
  return [{ d: position.close, qty, price: position.cur, pnl }];
}

/**
 * How much was still held on a given day, after any exits up to and including it.
 *
 * Partial exits are the reason this is not simply "the quantity on the
 * position": a trade half sold in March was still whole in February, and
 * valuing February at the surviving half understates it.
 */
export function qtyHeldOn(position, day) {
  if (!position.open || position.open > day) return 0;
  const sold = exitsOf(position)
    .filter((e) => e?.d && e.d <= day)
    .reduce((sum, e) => sum + (e.qty ?? 0), 0);
  return Math.max(0, baseQtyOf(position) - sold);
}

/**
 * The cash balance on a past day, walked back from today's.
 *
 * Three things move it and all three are dated, so each can be undone:
 * money spent opening a position had not been spent yet, money returned by an
 * exit had not come back yet, and a deposit made later had not arrived.
 *
 * Getting the sign wrong on any of the three is invisible on today's figure and
 * wrong on every other day, which is why each is written out separately.
 */
export function cashOn(positions, cashToday, flows, day) {
  let cash = cashToday;

  for (const position of positions) {
    // Not yet bought: the money was still in the account.
    if (position.open && position.open > day) cash += position.entry * baseQtyOf(position);
    // Not yet sold: the proceeds had not arrived.
    for (const exit of exitsOf(position)) {
      if (exit?.d && exit.d > day) cash -= proceedsOf(position, exit);
    }
  }

  for (const flow of flows ?? []) {
    if (flow?.date && flow.date > day && Number.isFinite(flow.amount)) cash -= flow.amount;
  }

  return cash;
}

/**
 * What the whole book was worth on each day of a range.
 *
 * `priceOn(ticker, day)` returns that ticker's last close on or before the day,
 * or null. A day on which any held position cannot be priced is dropped rather
 * than valued at whatever the rest came to — a book reported without one of its
 * holdings is not a smaller book, it is a wrong number, and a dip to it would
 * read as a loss that never happened.
 *
 * A short is worth its collateral plus what it has made:
 *   entry × qty + (entry − price) × qty
 * which is the same shape as a long and the opposite sign on the move.
 */
export function rebuildDailyValue({
  positions = [], cash = 0, flows = [], priceOn, from, to,
}) {
  if (typeof priceOn !== 'function' || !from || !to) return [];
  const out = [];

  for (const day of daysBetween(from, to)) {
    let held = 0;
    let priced = true;

    for (const position of positions) {
      const qty = qtyHeldOn(position, day);
      if (qty <= 0) continue;
      const price = priceOn(position.ticker, day);
      if (!(price > 0)) { priced = false; break; }
      held += position.dir === 'Short'
        ? position.entry * qty + (position.entry - price) * qty
        : price * qty;
    }

    if (!priced) continue;
    const value = held + cashOn(positions, cash, flows, day);
    // A reconstructed value at or below zero means the walk-back has lost the
    // thread — a missing trade, a bad date — and drawing it would be worse
    // than leaving the day out.
    if (!(value > 0)) continue;
    out.push({ date: day, value: +value.toFixed(2) });
  }

  return out;
}

/**
 * Join a reconstructed history onto the recorded one.
 *
 * The recorded snapshots stay authoritative wherever they exist: they are what
 * the account was actually worth, including the dividends, interest and fees
 * the journal never modelled. The reconstruction only fills the days before
 * the recording started.
 *
 * Those two will not meet exactly, for precisely that reason — the gap is the
 * unmodelled cash. Left alone it draws as a step on the join date, which reads
 * as a day the account jumped and did not. So the reconstructed part is scaled
 * to land exactly on the first recorded value.
 *
 * Scaling rather than shifting, because a constant multiplier leaves every
 * daily return in the reconstructed stretch unchanged: the shape is what the
 * back-cast actually knows, and the level is what it is being told.
 */
export function spliceHistory(recorded, rebuilt) {
  const snaps = [...(recorded ?? [])]
    .filter((s) => s?.date && Number.isFinite(s.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const back = (rebuilt ?? []).filter((s) => s?.date && Number.isFinite(s.value));
  if (!back.length) return snaps;
  if (!snaps.length) return back;

  const joinDate = snaps[0].date;
  const before = back.filter((s) => s.date < joinDate);
  if (!before.length) return snaps;

  // The reconstruction's own value on the join date, or the last one before it.
  const atJoin = back.filter((s) => s.date <= joinDate).pop();
  const scale = atJoin && atJoin.value > 0 ? snaps[0].value / atJoin.value : 1;

  return [
    ...before.map((s) => ({ date: s.date, value: +(s.value * scale).toFixed(2), rebuilt: true })),
    ...snaps,
  ];
}
