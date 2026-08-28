/**
 * The single source of truth for portfolio data, plus its localStorage mirror.
 *
 * Everything lives on one exported `state` object rather than as loose `let`
 * bindings, so that modules importing it always observe the current value even
 * when a collection is replaced wholesale (e.g. after a delete).
 *
 * This module never touches the DOM.
 */
import { STORAGE_KEYS } from '../config/constants.js';

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

export function loadState() {
  const stored = readJson(STORAGE_KEYS.positions, null);
  // Only an absent key seeds the demo book — an empty array means the user
  // deleted everything, and must stay empty.
  state.positions = Array.isArray(stored) ? stored : seedDemo();
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
