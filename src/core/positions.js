/**
 * Every write to the position book lives here: create, edit, DCA, close,
 * reopen, delete.
 *
 * These functions mutate state and persist it, then RETURN a plain description
 * of what happened. They never render and never call alert(), so the messaging
 * and re-render live in the action layer where the user's intent is known.
 */
import { state, savePositions, saveCash, findPosition } from './store.js';
import { closeMath, costOf, baseQtyOf, bookedPnl, todayStr } from './portfolio.js';

/**
 * Strictly increasing id, so two trades on the same ticker created in the same
 * millisecond can never collide.
 */
let lastId = 0;
export function newId() {
  let id = Date.now() * 1000;
  if (id <= lastId) id = lastId + 1;
  lastId = id;
  return id;
}

/** BRK B / BRK-B -> BRK.B, and always upper case. */
export function normalizeTicker(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(' ', '.')
    .replace(/-([A-Z])$/, '.$1');
}

/** Buying spends cash, but only down to zero — cash is never driven negative. */
function spendCash(amount) {
  if (state.cash <= 0) return;
  state.cash = Math.max(0, state.cash - amount);
  saveCash();
}

export function addPosition({ ticker, cls, dir, open, entry, amount, reason }) {
  const position = {
    id: newId(),
    ticker,
    cls,
    dir,
    open,
    close: null,
    entry,
    cur: entry,
    qty: amount / entry,
    amount,
    status: 'Open',
    reason: reason || null,
  };
  state.positions.unshift(position);
  spendCash(amount);
  savePositions();
  return position;
}

/**
 * Apply an edit. Changing the invested amount moves cash by the difference, so
 * the account value stays consistent with what was actually deployed.
 */
export function updatePosition(id, fields) {
  const p = findPosition(id);
  if (!p) return null;
  const previousCost = costOf(p);

  p.ticker = fields.ticker;
  p.cls = fields.cls;
  p.dir = fields.dir;
  p.open = fields.open;
  p.entry = fields.entry;
  p.qty = fields.amount / fields.entry;
  p.amount = fields.amount;
  p.reason = fields.reason || null;
  if (fields.exit != null) p.cur = fields.exit;
  if (fields.close) p.close = fields.close;

  const cashDelta = fields.amount - previousCost;
  if (cashDelta !== 0) {
    state.cash = Math.max(0, state.cash - cashDelta);
    saveCash();
  }
  savePositions();
  return { position: p, cashDelta };
}

/** What a DCA would produce, without committing to it. */
export function previewDca(p, amount, price) {
  const addQty = amount / price;
  const qty = p.qty + addQty;
  const cost = costOf(p) + amount;
  return { addQty, qty, cost, avgEntry: cost / qty };
}

export function applyDca(id, amount, price) {
  const p = findPosition(id);
  if (!p) return null;
  const next = previewDca(p, amount, price);
  p.entry = next.avgEntry;
  p.qty = next.qty;
  p.amount = next.cost;
  spendCash(amount);
  savePositions();
  return { position: p, ...next };
}

export function setCurrentPrice(id, price) {
  const p = findPosition(id);
  if (!p) return null;
  p.cur = price;
  savePositions();
  return p;
}

/**
 * Close all or part of a position.
 *
 * A partial exit is recorded on the position and nothing is booked to Monthly —
 * the trade is not finished yet. The final exit collapses every partial into ONE
 * blended closed trade: qty returns to the original size and `cur` becomes the
 * quantity-weighted average exit, so that
 *   realized() = (avgExit - entry) * origQty = the sum of every exit's P&L.
 */
export function closePosition(id, price, requestedQty) {
  const p = findPosition(id);
  if (!p) return null;

  const qty = Math.min(requestedQty, p.qty);
  if (p.origQty == null) p.origQty = p.qty;
  if (!p.exits) p.exits = [];

  const base = p.origQty;
  const math = closeMath(p, price, qty);
  const today = todayStr();
  const remaining = p.qty - qty;
  const isFinal = remaining <= 1e-9;
  const slicePct = base > 0 ? (qty / base) * 100 : 0;

  // Capture what the asset closed at YESTERDAY, so this exit still counts
  // toward today's portfolio move even after the shares are gone.
  const prevClose = p.dailyChg != null && Number.isFinite(p.dailyChg) && 1 + p.dailyChg / 100 > 0
    ? p.cur / (1 + p.dailyChg / 100)
    : null;

  p.exits.push({
    d: today,
    qty: +qty.toFixed(10),
    price,
    pnl: +math.pnl.toFixed(6),
    pct: +slicePct.toFixed(4),
    prevClose,
  });

  state.cash += math.proceeds;
  saveCash();

  if (isFinal) {
    const totalQty = p.exits.reduce((sum, e) => sum + e.qty, 0);
    const avgExit = p.exits.reduce((sum, e) => sum + e.price * e.qty, 0) / totalQty;
    p.qty = totalQty;
    p.cur = avgExit;
    p.amount = p.entry * totalQty;
    p.status = 'Closed';
    p.close = today;
    p.firstExit = p.exits[0].d;
    savePositions();
    const totalPnl = bookedPnl(p);
    return {
      position: p, isFinal: true, exitPnl: math.pnl, retPct: math.retPct,
      slicePct, avgExit, totalPnl, totalRetPct: p.amount ? (totalPnl / p.amount) * 100 : 0,
      exitCount: p.exits.length, cash: state.cash,
    };
  }

  p.qty = remaining;
  p.amount = p.entry * remaining;
  savePositions();
  return {
    position: p, isFinal: false, exitPnl: math.pnl, retPct: math.retPct,
    slicePct, banked: bookedPnl(p), closedPct: ((base - remaining) / base) * 100,
    exitCount: p.exits.length, cash: state.cash,
  };
}

/** Total cash that reopening a position would have to claw back. */
export function exitProceedsOf(p) {
  return (p.exits || []).reduce((sum, e) => sum + p.entry * e.qty + e.pnl, 0);
}

export function reopenPosition(id) {
  const p = findPosition(id);
  if (!p) return null;
  if (p.exits && p.exits.length) {
    state.cash = Math.max(0, state.cash - exitProceedsOf(p));
    saveCash();
    p.qty = baseQtyOf(p);
    p.amount = p.entry * p.qty;
    p.exits = [];
    p.origQty = null;
    p.firstExit = null;
  }
  p.status = 'Open';
  p.close = null;
  savePositions();
  return p;
}

export function deletePosition(id) {
  state.positions = state.positions.filter((p) => p.id !== id);
  savePositions();
}
