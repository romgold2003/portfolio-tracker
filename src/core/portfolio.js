/**
 * Pure portfolio mathematics. No DOM, no storage, no network — every function
 * here is a plain input/output calculation, which is what makes the P&L rules
 * below readable and testable.
 */
import { BETA } from '../config/constants.js';

/** Today as YYYY-MM-DD, the key format used throughout the app. */
export function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function costOf(p) { return p.entry * p.qty; }
export function curValOf(p) { return p.cur * p.qty; }

/** Open P&L. Shorts profit when the price falls, so the sign flips. */
export function unreal(p) {
  const cost = costOf(p);
  const value = curValOf(p);
  return p.dir === 'Long' ? value - cost : cost - value;
}

/** Banked P&L. Zero until the position is fully closed. */
export function realized(p) {
  if (p.status !== 'Closed') return 0;
  const cost = costOf(p);
  const value = curValOf(p);
  return p.dir === 'Long' ? value - cost : cost - value;
}

/**
 * What the position is worth right now.
 *   Long : entry*qty + (cur-entry)*qty = cur*qty
 *   Short: entry*qty + (entry-cur)*qty = collateral +/- P&L
 */
export function posValue(p) { return costOf(p) + unreal(p); }

/**
 * Today's P&L in dollars for one position.
 *
 * The day starts at whichever price you actually owned the shares from:
 *
 *   held since before today  ->  yesterday's close
 *   bought today             ->  the price you paid
 *
 * Yesterday's close is not stored, so it is recovered from the quoted change:
 *   dailyChg% = (cur - prevClose) / prevClose  =>  prevClose = cur / (1 + chg/100)
 *
 * Returns null when the starting price cannot be established, which for a
 * position held from before today means no quote has arrived yet.
 */
export function dailyDollar(p, today = todayStr()) {
  // Shares bought today were not owned at yesterday's close, so their day
  // starts at the price paid, not at the previous close. Counting the whole
  // day's move for them credits the portfolio with a gain it never had, and the
  // daily figure then fails to reconcile with the account value.
  //
  // This case needs no quote at all: the entry price and the current price are
  // both already known.
  if (p.open === today) {
    const move = (p.cur - p.entry) * p.qty;
    return p.dir === 'Long' ? move : -move;
  }

  if (p.dailyChg == null || !Number.isFinite(p.dailyChg)) return null;
  const factor = 1 + p.dailyChg / 100;
  if (factor <= 0) return null;
  const prevClose = p.cur / factor;
  const move = (p.cur - prevClose) * p.qty;
  return p.dir === 'Long' ? move : -move;
}

/**
 * P&L booked TODAY by selling — measured from the asset's previous close to the
 * exit price. Shares sold today still moved today, so they belong in the day's
 * total. Without this, closing a winner makes the daily figure collapse.
 */
export function dailyDollarExits(p, today = todayStr()) {
  if (!p.exits || !p.exits.length) return 0;
  // Shares bought and sold on the same day started at the price paid, so their
  // move is knowable even when no quote was ever recorded for them.
  const boughtToday = p.open === today;

  return p.exits.reduce((sum, e) => {
    if (e.d !== today) return sum;
    const validPrevClose = e.prevClose != null && Number.isFinite(e.prevClose) && e.prevClose > 0;
    const from = boughtToday ? p.entry : (validPrevClose ? e.prevClose : null);
    // Without a starting price there is nothing honest to attribute to today.
    if (from == null) return sum;
    const move = (e.price - from) * e.qty;
    return sum + (p.dir === 'Long' ? move : -move);
  }, 0);
}

/** Everything one position contributed today: the part still held, plus anything sold today. */
export function dailyDollarTotal(p, today = todayStr()) {
  const held = p.status === 'Open' ? (dailyDollar(p, today) || 0) : 0;
  return held + dailyDollarExits(p, today);
}

/** True when a position has no daily figure at all — neither held nor sold today. */
export function hasDailyFigure(p, today = todayStr()) {
  return dailyDollar(p, today) != null || dailyDollarExits(p, today) !== 0;
}

function betaOf(ticker, cls) {
  const t = (ticker || '').toUpperCase();
  if (BETA[t] != null) return BETA[t];
  if (cls === 'Crypto') return BETA.DEFAULT_CRYPTO;
  if (cls === 'Commodities') return BETA.DEFAULT_COMMOD;
  return BETA.DEFAULT_STOCK;
}

/** Size-weighted portfolio beta. Shorts contribute negatively. */
export function portfolioBeta(open) {
  let weighted = 0;
  let total = 0;
  open.forEach((p) => {
    const w = Math.abs(curValOf(p));
    const sign = p.dir === 'Long' ? 1 : -1;
    weighted += betaOf(p.ticker, p.cls) * w * sign;
    total += w;
  });
  return total ? weighted / total : null;
}

/** The original position size, before any partial exits. */
export function baseQtyOf(p) { return p.origQty != null ? p.origQty : p.qty; }

/** What a given exit would book, without mutating anything. */
export function closeMath(p, price, qty) {
  const costPart = p.entry * qty;
  const pnl = (p.dir === 'Long' ? price - p.entry : p.entry - price) * qty;
  return { qty, costPart, pnl, proceeds: costPart + pnl, retPct: costPart ? (pnl / costPart) * 100 : 0 };
}

/** P&L already banked across a position's partial exits. */
export function bookedPnl(p) {
  return (p.exits || []).reduce((sum, e) => sum + e.pnl, 0);
}

export function pctD(pnl, base) { return base ? (pnl / base) * 100 : 0; }

/**
 * Sorting for the open-positions lists. Returns a new array.
 * The daily sorts are direction-aware by construction: dailyDollar() already
 * flips the sign for shorts, so a short whose stock fell ranks as a winner.
 */
export function sortPositions(list, sortKey) {
  const arr = [...list];
  switch (sortKey) {
    case 'size':
      return arr.sort((a, b) => Math.abs(curValOf(b)) - Math.abs(curValOf(a)));
    case 'dUp':
      return arr.sort((a, b) => (dailyDollar(b) ?? -Infinity) - (dailyDollar(a) ?? -Infinity));
    case 'dDown':
      return arr.sort((a, b) => (dailyDollar(a) ?? Infinity) - (dailyDollar(b) ?? Infinity));
    case 'pnl':
    default:
      return arr.sort((a, b) => unreal(b) - unreal(a));
  }
}

/**
 * Account totals for the whole book.
 *
 * Net liquidation value = equity value of open positions + cash.
 * Realised P&L is deliberately NOT added: closing a trade already paid its
 * proceeds into cash, so adding it again would double-count.
 */
export function accountTotals(positions, cash) {
  const open = positions.filter((p) => p.status === 'Open');
  const closed = positions.filter((p) => p.status === 'Closed');
  const unrealised = open.reduce((sum, p) => sum + unreal(p), 0);
  const realised = closed.reduce((sum, p) => sum + realized(p), 0);
  const invested = open.reduce((sum, p) => sum + costOf(p), 0);
  const positionsValue = open.reduce((sum, p) => sum + posValue(p), 0);
  const account = positionsValue + cash;
  const wins = closed.filter((p) => realized(p) > 0).length;
  return {
    open,
    closed,
    unrealised,
    realised,
    total: unrealised + realised,
    invested,
    positionsValue,
    account,
    wins,
    losses: closed.length - wins,
    winRate: closed.length ? Math.round((wins / closed.length) * 100) : 0,
  };
}

/**
 * The portfolio's move today.
 *   dollars = what the shares still held moved today
 *           + what the shares SOLD today moved before they were sold
 *   percent = dollars / YESTERDAY's NLV (today's NLV minus today's P&L)
 */
export function dailyPortfolioMove(positions, account, today = todayStr()) {
  const open = positions.filter((p) => p.status === 'Open');
  const quoted = open.filter((p) => dailyDollar(p, today) != null);
  const held = quoted.reduce((sum, p) => sum + dailyDollar(p, today), 0);
  const sold = positions.reduce((sum, p) => sum + dailyDollarExits(p, today), 0);
  const dollars = held + sold;
  const prevNLV = account - dollars;
  return {
    dollars,
    sold,
    percent: prevNLV > 0 ? (dollars / prevNLV) * 100 : 0,
    hasData: quoted.length > 0 || sold !== 0,
    pending: open.length - quoted.length,
  };
}
