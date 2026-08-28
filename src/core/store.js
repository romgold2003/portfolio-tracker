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
/**
 * A failed write means the journal on screen is not the journal on disk, and
 * the next reload silently loses the trade. That is the one storage failure the
 * user has to hear about, so it is reported once per session rather than
 * swallowed. Everything else (theme, price log) degrades quietly on purpose.
 */
let storageFailureReported = false;

function reportStorageFailure() {
  if (storageFailureReported) return;
  storageFailureReported = true;
  // Deliberately blocking: carrying on as if the trade were saved is worse.
  alert('This browser refused to save your journal.\n\n'
    + 'Changes you make now will be lost when you reload. This usually means '
    + 'private browsing, blocked site data, or a full storage quota.\n\n'
    + 'Export a backup from Live price settings before closing this tab.');
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.error(`Could not save "${key}" to localStorage:`, err);
    reportStorageFailure();
    return false;
  }
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

/**
 * The journal as it sits on disk when no password has been set.
 * Returns null when this browser has never held one.
 */
export function readPlaintextJournal() {
  const stored = readJson(STORAGE_KEYS.positions, null);
  if (stored == null) return null;
  return {
    // An empty array means the user deleted everything, and must stay empty.
    // Everything off disk is sanitized: a past import may have written junk.
    positions: sanitizePositions(Array.isArray(stored) ? stored : []),
    cash: parseFloat(readRaw(STORAGE_KEYS.cash)) || 0,
    snapshots: readJson(STORAGE_KEYS.snapshots, []),
    apiKey: readRaw(STORAGE_KEYS.apiKey) || '',
  };
}

/** The default persistence: straight to localStorage, no encryption. */
export function savePlaintextJournal(journal) {
  writeRaw(STORAGE_KEYS.positions, JSON.stringify(journal.positions));
  writeRaw(STORAGE_KEYS.snapshots, JSON.stringify(journal.snapshots));
  writeRaw(STORAGE_KEYS.cash, String(journal.cash));
  writeRaw(STORAGE_KEYS.apiKey, journal.apiKey || '');
}

/** Erase the readable copy, once the journal is safely inside a vault. */
export function clearPlaintextJournal() {
  [STORAGE_KEYS.positions, STORAGE_KEYS.cash, STORAGE_KEYS.snapshots, STORAGE_KEYS.apiKey]
    .forEach((key) => { try { localStorage.removeItem(key); } catch { /* already gone */ } });
}

/** A brand-new browser gets the sample book, so the app is not four empty pages. */
export function firstRunJournal() {
  return { positions: seedDemo(), cash: 0, snapshots: [], apiKey: '' };
}

export function loadState(journal) {
  const source = journal ?? {};
  state.positions = sanitizePositions(source.positions ?? []);
  state.cash = Number(source.cash) || 0;
  state.snapshots = Array.isArray(source.snapshots) ? source.snapshots : [];
  state.apiKey = typeof source.apiKey === 'string' ? source.apiKey : '';
}

/** Everything worth persisting, in one object. */
export function journalSnapshot() {
  return {
    positions: state.positions,
    cash: state.cash,
    snapshots: state.snapshots,
    apiKey: state.apiKey,
  };
}

/**
 * Where a save goes is decided at boot: straight to localStorage normally, or
 * through the encrypted vault once a password is set.
 *
 * Encrypting is asynchronous while the twenty-odd callers of savePositions()
 * are not, so a save marks the journal dirty and a flush writes it shortly
 * after, coalescing a burst of edits into one write. The window is small, and a
 * flush is forced when the tab is hidden or closed.
 */
const FLUSH_DELAY_MS = 150;
let flushTimer = null;
let persist = savePlaintextJournal;

export function setPersistHandler(fn) { persist = fn || savePlaintextJournal; }

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, FLUSH_DELAY_MS);
}

/** Force an immediate write. Safe when nothing is pending. */
export async function flushNow() {
  clearTimeout(flushTimer);
  flushTimer = null;
  try {
    await persist(journalSnapshot());
  } catch (err) {
    console.error('Could not save the journal:', err);
    reportStorageFailure();
  }
}

// The four entry points all write the same journal; they stay separate so the
// call sites keep reading as what they mean.
export function savePositions() { scheduleFlush(); }
export function saveSnapshots() { scheduleFlush(); }
export function saveCash() { scheduleFlush(); }
export function saveApiKey(key) {
  state.apiKey = key;
  scheduleFlush();
}

export function currentApiKey() {
  return state.apiKey;
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
