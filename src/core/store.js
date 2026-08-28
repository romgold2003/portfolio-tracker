/**
 * The single source of truth for portfolio data, plus its localStorage mirror.
 *
 * Everything lives on one exported `state` object rather than as loose `let`
 * bindings, so that modules importing it always observe the current value even
 * when a collection is replaced wholesale (e.g. after a delete).
 *
 * This module never touches the DOM.
 */
import { STORAGE_KEYS, ASSET_CLASSES } from '../config/constants.js';

export const state = {
  /** @type {Position[]} every trade, open and closed */
  positions: [],
  /** Uninvested cash, updated automatically as positions open and close. */
  cash: 0,
  /** @type {{date:string,value:number}[]} daily account-value points */
  snapshots: [],
  /** Finnhub key for stock/ETF quotes. Stays on this device. */
  apiKey: '',
};

/** localStorage can throw (private mode, disabled storage) — never let it break a render. */
function readRaw(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeRaw(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable — stay in memory */ }
}
function readJson(key, fallback) {
  const raw = readRaw(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
}

/**
 * Coerce one stored or imported position into the shape the rest of the app
 * guarantees.
 *
 * Positions do not only come from the New-trade form. They also arrive from an
 * imported backup file and from an IBKR sync, neither of which is under our
 * control, and every P&L rule and every template assumes the fields hold what
 * their names say. Two things go wrong without this:
 *
 *   - one row with a non-numeric `entry` or `qty` turns the whole account value
 *     into NaN, because the totals are a single reduce over every position
 *   - a string `id` lands inside an inline `onclick` handler, and a string date
 *     lands in an HTML text node, so a crafted backup can run script in this
 *     origin and read the journal and API key out of localStorage
 *
 * Returns null when a row is too broken to repair, so the caller drops it.
 */
function sanitizePosition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const text = (v) => (typeof v === 'string' ? v : null);
  /** Dates are rendered as HTML and must never carry markup. */
  const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

  const entry = num(raw.entry);
  const qty = num(raw.qty);
  const ticker = text(raw.ticker);
  // Without a symbol, a price, and a size there is no trade to speak of.
  if (!ticker || entry == null || qty == null) return null;

  const cur = num(raw.cur);
  const status = oneOf(raw.status, ['Open', 'Closed'], 'Open');
  const exits = Array.isArray(raw.exits)
    ? raw.exits.map((e) => {
      if (!e || typeof e !== 'object') return null;
      const eQty = num(e.qty);
      const ePrice = num(e.price);
      if (eQty == null || ePrice == null) return null;
      return {
        d: date(e.d),
        qty: eQty,
        price: ePrice,
        pnl: num(e.pnl) ?? 0,
        pct: num(e.pct),
        prevClose: num(e.prevClose),
      };
    }).filter(Boolean)
    : undefined;

  const clean = {
    id: num(raw.id) ?? newLocalId(),
    ticker: ticker.trim().toUpperCase(),
    cls: oneOf(raw.cls, ASSET_CLASSES, 'Stocks'),
    dir: oneOf(raw.dir, ['Long', 'Short'], 'Long'),
    status,
    open: date(raw.open),
    close: status === 'Closed' ? date(raw.close) : null,
    entry,
    cur: cur ?? entry,
    qty,
    amount: num(raw.amount) ?? entry * qty,
    reason: text(raw.reason),
  };

  // Optional fields are only carried over when they hold a usable value, so a
  // missing one stays absent rather than becoming a misleading zero.
  if (exits && exits.length) clean.exits = exits;
  const origQty = num(raw.origQty);
  if (origQty != null) clean.origQty = origQty;
  const dailyChg = num(raw.dailyChg);
  if (dailyChg != null) clean.dailyChg = dailyChg;
  const weeklyChg = num(raw.weeklyChg);
  if (weeklyChg != null) clean.weeklyChg = weeklyChg;
  const firstExit = date(raw.firstExit);
  if (firstExit) clean.firstExit = firstExit;
  if (raw.ibkrId != null) clean.ibkrId = String(raw.ibkrId);

  return clean;
}

/** Fallback id for a row that arrived without a usable one. */
let localIdCounter = 0;
function newLocalId() {
  localIdCounter += 1;
  return Date.now() * 1000 + localIdCounter;
}

/** Sanitize a whole book, dropping rows that cannot be repaired. */
export function sanitizePositions(list) {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizePosition).filter(Boolean);
}

export function loadState() {
  const stored = readJson(STORAGE_KEYS.positions, null);
  // Only an absent key seeds the demo book — an empty array means the user
  // deleted everything, and must stay empty. Everything that comes off disk is
  // sanitized, since a previous import may have written junk.
  state.positions = Array.isArray(stored) ? sanitizePositions(stored) : seedDemo();
  state.apiKey = readRaw(STORAGE_KEYS.apiKey) || '';
  state.snapshots = readJson(STORAGE_KEYS.snapshots, []);
  state.cash = parseFloat(readRaw(STORAGE_KEYS.cash)) || 0;
}

export function savePositions() {
  writeRaw(STORAGE_KEYS.positions, JSON.stringify(state.positions));
}
export function saveSnapshots() {
  writeRaw(STORAGE_KEYS.snapshots, JSON.stringify(state.snapshots));
}
export function saveCash() {
  writeRaw(STORAGE_KEYS.cash, String(state.cash));
}
export function saveApiKey(key) {
  state.apiKey = key;
  writeRaw(STORAGE_KEYS.apiKey, key);
}

/** The key is re-read on every quote so a change in another tab takes effect. */
export function currentApiKey() {
  return readRaw(STORAGE_KEYS.apiKey) || state.apiKey;
}

export function openPositions() {
  return state.positions.filter((p) => p.status === 'Open');
}
export function closedPositions() {
  return state.positions.filter((p) => p.status === 'Closed');
}
export function findPosition(id) {
  return state.positions.find((p) => p.id === id);
}

/**
 * First-run sample book, so a brand-new install has something to look at
 * instead of four empty pages.
 */
function seedDemo() {
  const today = new Date();
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  };
  return [
    { id: 1, ticker: 'BTC', cls: 'Crypto', dir: 'Long', open: daysAgo(120), close: null, entry: 82000, cur: 105000, qty: 0.05, amount: 4100, status: 'Open' },
    { id: 2, ticker: 'IAU', cls: 'Commodities', dir: 'Long', open: daysAgo(28), close: null, entry: 50, cur: 53, qty: 20, amount: 1000, status: 'Open' },
    { id: 3, ticker: 'MSFT', cls: 'Stocks', dir: 'Short', open: daysAgo(95), close: daysAgo(30), entry: 430, cur: 390, qty: 5, amount: 2150, status: 'Closed' },
    { id: 4, ticker: 'IBM', cls: 'Stocks', dir: 'Long', open: daysAgo(70), close: daysAgo(45), entry: 210, cur: 195, qty: 10, amount: 2100, status: 'Closed' },
  ];
}
