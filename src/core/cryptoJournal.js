/**
 * The crypto journal: trades from a strategy being tried with money outside
 * the account, entered by hand and read like the Monthly page — profit, win
 * rate and the average trade, month by month.
 *
 * Asked for in October 2026 for backtesting a crypto strategy "with other
 * money". It is reference only: nothing here touches the account's value,
 * cash, returns or history.
 *
 * A trade is entered as what the exchange shows when it is over — the profit,
 * the average entry and the average exit — and the rest follows. The direction
 * is whichever makes the profit agree with the move: a gain on a price that
 * fell was a short. The percentage is the price move in the trade's favour;
 * the size is the position at entry that turns that move into that profit.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// A blank box is nothing entered, not a zero.
const num = (v) => {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A trade as stored: what was entered, nothing derived. Null when unusable. */
export function cleanTrade(raw) {
  const entry = num(raw?.entry);
  const exit = num(raw?.exit);
  const pnl = num(raw?.pnl);
  const d = typeof raw?.d === 'string' && DATE_ONLY.test(raw.d) ? raw.d : null;
  if (!d || !(entry > 0) || !(exit > 0) || pnl == null) return null;
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : newId(),
    d,
    coin: text(raw.coin, 16).toUpperCase(),
    entry,
    exit,
    pnl,
    // Chosen, or empty to be worked out from the P&L and the move.
    dir: raw.dir === 'Long' || raw.dir === 'Short' ? raw.dir : '',
    note: text(raw.note, 200),
  };
}

export function cleanTrades(list) {
  return (Array.isArray(list) ? list : []).map(cleanTrade).filter(Boolean);
}

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Direction, the move in the trade's favour (%), and the size at entry ($).
 *
 * The side as chosen; when it was left to work out, a profit on a fall or a
 * loss on a rise was a short. Choosing matters only when fees outweigh the
 * move — a short from 100 to 99.9 that paid more in fees than it made reads
 * as a losing long otherwise. Win and loss always follow the P&L itself.
 */
export function derive(t) {
  const move = (t.exit - t.entry) / t.entry;
  const inferred = t.pnl !== 0 && Math.sign(t.pnl) !== Math.sign(move) && move !== 0 ? 'Short' : 'Long';
  const dir = t.dir === 'Long' || t.dir === 'Short' ? t.dir : inferred;
  const pct = (dir === 'Long' ? move : -move) * 100;
  const size = move !== 0 ? Math.abs(t.pnl / move) : null;
  return { ...t, dir, pct, size, win: t.pnl > 0, loss: t.pnl < 0 };
}

function summary(list) {
  const trades = list.map(derive);
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => t.loss);
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
  const grossWin = sum(wins, (t) => t.pnl);
  const grossLoss = -sum(losses, (t) => t.pnl);
  return {
    trades,
    n: trades.length,
    pnl: sum(trades, (t) => t.pnl),
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    // Equal-weight, as on the Monthly page: how the typical trade did.
    avgPct: trades.length ? sum(trades, (t) => t.pct) / trades.length : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    best: trades.reduce((b, t) => (!b || t.pct > b.pct ? t : b), null),
    worst: trades.reduce((w, t) => (!w || t.pct < w.pct ? t : w), null),
  };
}

/** Every trade together. */
export const overall = (trades) => summary(cleanTrades(trades));

/** Each month with a trade, newest first, keyed YYYY-MM, its trades newest first. */
export function monthsOf(trades) {
  const by = new Map();
  for (const t of cleanTrades(trades)) {
    const key = t.d.slice(0, 7);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(t);
  }
  return [...by].sort(([a], [b]) => b.localeCompare(a)).map(([key, list]) => {
    const s = summary(list.sort((a, b) => b.d.localeCompare(a.d)));
    return { key, ...s };
  });
}

/** Profit in each of the twelve months of a year, for the bar chart. */
export function yearBars(trades, year) {
  const bars = new Array(12).fill(0);
  for (const t of cleanTrades(trades)) {
    if (t.d.startsWith(`${year}-`)) bars[Number(t.d.slice(5, 7)) - 1] += t.pnl;
  }
  return bars.map((v) => +v.toFixed(2));
}

/** The years with a trade, newest first. */
export function yearsOf(trades) {
  return [...new Set(cleanTrades(trades).map((t) => Number(t.d.slice(0, 4))))].sort((a, b) => b - a);
}
