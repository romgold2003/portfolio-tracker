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
import { SECTOR_NAMES } from '../config/sectors.js';

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
 * imported backup file, which is not under our control, and every P&L rule and
 * every template assumes the fields hold what their names say. Two things go
 * wrong without this:
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

  // A sector chosen by hand overrides the ticker lookup, so it is carried
  // through, but only when it names a sector the app actually knows.
  if (raw.sector && SECTOR_NAMES.includes(raw.sector)) clean.sector = raw.sector;

  // Entered from a statement as a result rather than as prices. Carried through
  // because the card reads it: without it a reload would start presenting the
  // amount staked as though it were an entry price.
  if (raw.summary === true) clean.summary = true;

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
 * Read the plaintext journal written by every version before accounts existed.
 * Returns null when there is nothing to migrate.
 */
export function readLegacyJournal() {
  const stored = readJson(STORAGE_KEYS.positions, null);
  if (!Array.isArray(stored) || !stored.length) return null;
  return {
    positions: sanitizePositions(stored),
    cash: parseFloat(readRaw(STORAGE_KEYS.cash)) || 0,
    snapshots: readJson(STORAGE_KEYS.snapshots, []),
    apiKey: readRaw(STORAGE_KEYS.apiKey) || '',
  };
}

/** Remove the plaintext copy once it is safely inside an encrypted vault. */
export function clearLegacyJournal() {
  [STORAGE_KEYS.positions, STORAGE_KEYS.cash, STORAGE_KEYS.snapshots, STORAGE_KEYS.apiKey]
    .forEach((key) => { try { localStorage.removeItem(key); } catch { /* already gone */ } });
}

/** Populate `state` from a decrypted vault. */
export function loadState(journal) {
  const source = journal ?? {};
  state.positions = sanitizePositions(source.positions ?? []);
  state.cash = Number(source.cash) || 0;
  state.snapshots = Array.isArray(source.snapshots) ? source.snapshots : [];
  state.apiKey = typeof source.apiKey === 'string' ? source.apiKey : '';
}

/** Everything the vault holds, ready to be encrypted. */
export function journalSnapshot() {
  return {
    positions: state.positions,
    cash: state.cash,
    snapshots: state.snapshots,
    apiKey: state.apiKey,
  };
}

/** Drop everything in memory. Called on sign out. */
export function clearState() {
  state.positions = [];
  state.cash = 0;
  state.snapshots = [];
  state.apiKey = '';
}

/**
 * Encryption is asynchronous, but the twenty-odd callers of savePositions() are
 * not, and making them async would ripple through the whole action layer for no
 * benefit. Instead a save marks the vault dirty and a flush encrypts shortly
 * after, coalescing a burst of changes into one write.
 *
 * The window is deliberately small, and a flush is forced when the tab is
 * hidden or closed, so the amount that can be lost is a few hundred milliseconds
 * of the very last edit.
 */
const FLUSH_DELAY_MS = 150;
let flushTimer = null;
let persist = null;

/**
 * One save at a time.
 *
 * Writing to localStorage was instant, so overlapping saves were impossible and
 * nothing guarded against them. Writing to a server takes a few hundred
 * milliseconds, and in that window a price refresh, a tab switch or a snapshot
 * can each start a second save. Both then send the *same* base version, the
 * server correctly rejects the loser as a conflict, and the app reported a
 * clash between devices that never happened — every thirty seconds.
 *
 * So a save in flight is awaited rather than raced, and any change that arrives
 * meanwhile sets a flag that triggers one more save afterwards. Nothing is
 * dropped and nothing overlaps.
 */
let inFlight = null;
let changedWhileSaving = false;

/** Wired at boot by the profile layer. Until then, saves are no-ops. */
export function setPersistHandler(fn) {
  persist = fn;
  inFlight = null;
  changedWhileSaving = false;
  storageFailureReported = false;
}

function scheduleFlush() {
  if (!persist || flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, FLUSH_DELAY_MS);
}

function reportFailure(err) {
  console.error('Could not save the journal:', err);
  if (storageFailureReported) return;
  storageFailureReported = true;

  // A clash with another device is a different situation from storage being
  // refused, and telling someone to check for private browsing when their
  // phone simply saved first would send them looking for the wrong problem.
  alert(err?.conflict
    ? 'This journal was changed somewhere else.\n\n'
      + 'Another device signed into this account saved while you were working, '
      + 'and that version could not be merged with yours automatically.\n\n'
      + 'Reload the page to load the newer version. Export a backup first if '
      + 'you have made changes here you want to keep.'
    : 'Your journal could not be saved.\n\n'
      + 'Changes you make now may be lost when you reload. This usually means '
      + 'no connection, private browsing, blocked site data, or a full storage '
      + 'quota.\n\n'
      + 'Export a backup from Live price settings before closing this tab.');
}

/** Force an immediate write. Safe to call when nothing is pending. */
export async function flushNow() {
  if (!persist) return;
  clearTimeout(flushTimer);
  flushTimer = null;

  // Already saving: note that there is more to write and let that one finish.
  if (inFlight) {
    changedWhileSaving = true;
    return inFlight;
  }

  inFlight = (async () => {
    try {
      await persist(journalSnapshot());
      storageFailureReported = false;
    } catch (err) {
      reportFailure(err);
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }

  // Something changed while that was in the air, so write once more.
  if (changedWhileSaving) {
    changedWhileSaving = false;
    await flushNow();
  }
  return undefined;
}

// All four save entry points write the same vault; they stay separate only so
// the call sites keep reading as what they mean.
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

