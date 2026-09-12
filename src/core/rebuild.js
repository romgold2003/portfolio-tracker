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
 *   value(d) = what was held at that day's closes
 *            + the cash that had not yet been spent or had already come back
 *
 * Both halves are walked backwards from today, which is the only day whose
 * figures are known exactly.
 *
 * ── The holding that is not in the statement ─────────────────────────────
 *
 * The trap here, and it is a big one: a position bought in an earlier year has
 * no purchase inside the statement that imported it. The importer marks those
 * by leaving `open` null, deliberately, and an earlier version of this file
 * read a null open as "never held" and dropped them.
 *
 * On the book this was written against that was sixteen holdings worth
 * $23,687.78 on the first of January — ninety per cent of a $26,365.95 account.
 * The reconstruction showed January at cash alone, about $2.5K, climbing
 * through February as this year's positions opened. A crash that never happened
 * and a recovery that never happened, from the same missing rows.
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

/**
 * True when a position was already held before the window this app knows about.
 *
 * Either the importer said so, or there is simply no opening date — which means
 * the same thing. Such a position has no purchase to undo: the money left the
 * account before any day being reconstructed, so the cash walk must not add it
 * back and the holding must not appear from nowhere partway through.
 */
export const carriedIn = (position) => position?.carriedIn === true || !position?.open;

/** What one exit paid back: the capital it released plus what it made on it. */
const proceedsOf = (position, exit) => position.entry * exit.qty + (exit.pnl ?? 0);

/** The exits of a position, or the single implied one for a closed trade. */
export function exitsOf(position) {
  if (position.exits?.length) return position.exits;
  if (position.status !== 'Closed' || !position.close) return [];
  const qty = baseQtyOf(position);
  const pnl = position.dir === 'Short'
    ? (position.entry - position.cur) * qty
    : (position.cur - position.entry) * qty;
  return [{ d: position.close, qty, price: position.cur, pnl }];
}

/** True when the position was on the books at the close of `day`. */
export function heldOn(position, day) {
  if (!carriedIn(position) && position.open > day) return false;
  if (position.status === 'Closed') return !position.close || position.close > day;
  return true;
}

/** What a closed tranche was sold for: its capital back plus what it made. */
export const proceedsTotal = (position) =>
  exitsOf(position).reduce((sum, e) => sum + proceedsOf(position, e), 0);

/**
 * What one position was worth on a past day.
 *
 * Two shapes, because the book holds two.
 *
 * An open position carries real share counts, so it is quantity times that
 * day's close — plus anything sold out of it since, which was still held then.
 *
 * A closed trade out of an IBKR statement does not carry share counts at all.
 * The importer stores each realised tranche as a single synthetic unit whose
 * entry is the whole cost basis, because the broker reports realised profit in
 * money rather than shares and recomputing lots here would only invent a second
 * opinion. Asking it "how many shares" gives one, for a tranche that was really
 * eleven shares of AMD.
 *
 * What is known exactly is what it sold for and when. So it is valued backwards
 * along the ticker's own price path: worth its proceeds on the day it was sold,
 * and on any earlier day that scaled by how the price has moved since. On a
 * position that does carry real quantities the same formula reduces to quantity
 * times the close, so one rule covers both.
 */
export function valueOn(position, day, priceOn) {
  if (!heldOn(position, day)) return null;
  const price = priceOn(position.ticker, day);

  if (position.status === 'Open') {
    const sold = exitsOf(position)
      .filter((e) => e?.d && e.d > day)
      .reduce((sum, e) => sum + (e.qty ?? 0), 0);
    const qty = (position.qty ?? 0) + sold;
    if (!(price > 0)) return { value: position.entry * qty, stale: true };
    return position.dir === 'Short'
      ? { value: position.entry * qty + (position.entry - price) * qty, stale: false }
      : { value: price * qty, stale: false };
  }

  const proceeds = proceedsTotal(position);
  const atExit = priceOn(position.ticker, position.close);
  if (!(price > 0) || !(atExit > 0)) {
    // No price path to scale along: hold it at cost, which is flat but right in
    // order of magnitude, and say the value is stale.
    return { value: position.entry * baseQtyOf(position), stale: true };
  }
  const moved = price / atExit;
  return position.dir === 'Short'
    ? { value: proceeds * (2 - moved), stale: false }
    : { value: proceeds * moved, stale: false };
}

/**
 * The cash balance on a past day, walked back from today's.
 *
 * Three things move it and all three are dated, so each can be undone: money
 * spent opening a position had not been spent yet, money returned by an exit
 * had not come back yet, and a deposit made later had not arrived.
 *
 * Getting the sign wrong on any of the three is invisible on today's figure and
 * wrong on every other day, which is why each is written out separately.
 */
export function cashOn(positions, cashToday, flows, day) {
  let cash = cashToday;

  for (const position of positions) {
    // Carried in: the money left the account before any day being rebuilt, so
    // there is nothing to add back.
    if (!carriedIn(position) && position.open > day) {
      cash += position.entry * baseQtyOf(position);
    }
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
 * How much of the book may be valued at a stale price before a day is unusable.
 *
 * A holding the price service has never heard of used to drop the whole day,
 * and that was the third bug: two hundred and fifty shares of a delisted NASDAQ
 * shell worth about a hundred dollars deleted January through April from a
 * twenty-six thousand dollar account. A stub valued at what it last cost moves
 * the total by nothing; a real holding valued at a stale price would, so past
 * this share the day is dropped after all.
 */
const STALE_LIMIT = 0.03;

/**
 * What the whole book was worth on each day of a range.
 *
 * `priceOn(ticker, day)` returns that ticker's last close on or before the day,
 * or null. A short is worth its collateral plus what it has made:
 *   entry × qty + (entry − price) × qty
 * which is the same shape as a long and the opposite sign on the move.
 */
export function rebuildDailyValue({
  positions = [], cash = 0, flows = [], priceOn, from, to,
}) {
  if (typeof priceOn !== 'function' || !from || !to) return [];

  const out = [];
  /**
   * What each position was worth on the last day that was actually emitted,
   * so the next one can be compared against it position by position.
   */
  let previous = null;

  for (const day of daysBetween(from, to)) {
    let held = 0;
    let stale = 0;
    const valued = new Map();

    for (const position of positions) {
      const priced = valueOn(position, day, priceOn);
      if (!priced) continue;
      held += priced.value;
      if (priced.stale) stale += Math.abs(priced.value);
      // Only positions carrying a real close are comparable day to day. A
      // stale one is held at a remembered mark, and the day that mark changes
      // is a trade date rather than a market move.
      if (position.id != null && !priced.stale) valued.set(position.id, priced.value);
    }

    const value = held + cashOn(positions, cash, flows, day);
    // A reconstructed value at or below zero means the walk-back has lost the
    // thread — a missing trade, a bad date — and drawing it would be worse
    // than leaving the day out.
    if (!(value > 0)) continue;
    // Too much of the book priced from memory rather than from the market.
    if (held > 0 && stale / Math.abs(held) > STALE_LIMIT) continue;

    /**
     * The day's performance, with no cash in it.
     *
     * Each position that was held on both days, revalued: what the market did
     * to money already invested. `valueOn` reads prices and quantities and
     * never reads cash or flows, so a deposit cannot reach this number — which
     * is the whole point of computing it, because the balance beside it does
     * move when money is paid in and every attempt to tell the two apart by
     * subtracting transfers back out depended on knowing every transfer and its
     * exact date.
     *
     * Positions appearing or disappearing between the two days are left out:
     * that difference is a trade, not a market move.
     */
    let marketPnl = 0;
    if (previous) {
      for (const [id, now] of valued) {
        const before = previous.get(id);
        if (before == null) continue;
        marketPnl += now - before;
      }
    }
    previous = valued;

    out.push({ date: day, value: +value.toFixed(2), marketPnl: +marketPnl.toFixed(2) });
  }

  return out;
}

/**
 * The account value each day, from the broker's own transaction ledger.
 *
 * Strictly better than reconstructing from the position model, and the reason
 * is a limit of that model rather than a bug in it. A statement records each
 * realised tranche as money — cost basis and profit — because that is how a
 * broker reports realised gains, so a partly sold holding comes back as one
 * open position and several closed rows with no share counts on them. And a
 * holding carried in from last year that was bought into again in May has no
 * record of that purchase anywhere in the positions at all.
 *
 * On the book this was written against, BSOL was 93 shares in January and 116
 * today; nothing in the positions says when the other 23 arrived. Valuing
 * January at today's quantity overstated it by nineteen per cent.
 *
 * The ledger has every one of those movements with a date on it, so any past
 * day is today's holdings with the year undone:
 *
 *   qty(ticker, d)  = qty today  −  every share bought or sold after d
 *   cash(d)         = cash today −  every cash movement after d
 *
 * Checked against the statement it came from, this lands on the closing net
 * asset value to within the accrued-dividend line and on the opening one to
 * within a fifth of a per cent.
 */
export function rebuildFromLedger({
  ledger, cash = 0, flows = [], priceOn, from, to,
}) {
  const trades = ledger?.trades ?? [];
  const holdings = ledger?.holdings ?? {};
  if (typeof priceOn !== 'function' || !from || !to || !trades.length) return [];

  const tickers = [...new Set([...Object.keys(holdings), ...trades.map((t) => t.ticker)])];
  /** Last resort price per ticker, so a delisted stub cannot delete a month. */
  const lastKnown = new Map();
  for (const t of trades) {
    if (t.price > 0) lastKnown.set(t.ticker, t.price);
  }

  const out = [];
  for (const day of daysBetween(from, to)) {
    let held = 0;
    let stale = 0;

    for (const ticker of tickers) {
      let qty = holdings[ticker] ?? 0;
      for (const t of trades) {
        if (t.ticker === ticker && t.date > day) qty -= t.qty;
      }
      if (Math.abs(qty) < 1e-9) continue;

      let price = priceOn(ticker, day);
      if (!(price > 0)) {
        price = lastKnown.get(ticker) ?? 0;
        stale += Math.abs(price * qty);
      }
      if (!(price > 0)) continue;
      held += price * qty;
    }

    let money = cash;
    for (const t of trades) if (t.date > day) money -= t.cash ?? 0;
    for (const f of flows ?? []) {
      if (f?.date && f.date > day && Number.isFinite(f.amount)) money -= f.amount;
    }

    const value = held + money;
    if (!(value > 0)) continue;
    if (held > 0 && stale / Math.abs(held) > STALE_LIMIT) continue;
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

  /**
   * Every money field is scaled by the same factor, not just the balance.
   *
   * The scale exists so the reconstruction meets the recording without a step
   * at the join. It is a change of units, and applying it to the balance alone
   * left the other fields in the old ones — so a $2,000 deposit sat beside a
   * balance that had been multiplied by, say, 1.2, and the percentage curve
   * subtracting $2,000 from a $2,400 step removed four fifths of it and drew
   * the rest as a day of extraordinary gains. Scaling all of them together
   * keeps the day's arithmetic self-consistent whatever the factor is.
   */
  const scaled = (row) => {
    const out = { date: row.date, value: +(row.value * scale).toFixed(2), rebuilt: true };
    for (const field of ['externalCashFlow', 'marketPnl', 'deposit', 'withdrawal']) {
      if (Number.isFinite(row[field])) out[field] = +(row[field] * scale).toFixed(2);
    }
    return out;
  };

  return [...before.map(scaled), ...snaps];
}
