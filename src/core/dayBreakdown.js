/**
 * One day's move, holding by holding — what opens when a day in the daily log
 * is clicked.
 *
 * The same walk the chart and the log are built from, so the holdings add up
 * to the day's figure: shares held at the previous trading day's close and at
 * this one's, both priced as traded, with anything bought or sold in between
 * counted at the price paid. Whatever the holdings do not explain — interest,
 * a dividend, a fee — is left as the remainder rather than spread about.
 */

/** Shares held after every event up to `upTo`, and each ticker's trading cash after `after`. */
function walkTo({ opening, events }, after, upTo) {
  const start = new Map(Object.entries(opening?.holdings ?? {}));
  const end = new Map(start);
  const cash = new Map();
  const bought = new Map();
  const ordered = [...(events ?? [])].filter((e) => e?.date && e.date >= opening.date && e.date <= upTo)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const e of ordered) {
    if (!e.ticker) continue;
    // Before this event: a trade the same way as what is held (or into
    // nothing) puts money in; one against it takes money out.
    const prior = end.get(e.ticker) ?? 0;
    const books = e.date <= after ? [start, end] : [end];
    for (const h of books) {
      if (e.kind === 'split' && e.k > 0) { if (h.has(e.ticker)) h.set(e.ticker, h.get(e.ticker) * e.k); continue; }
      if (e.kind === 'trade' || e.kind === 'transfer') h.set(e.ticker, (h.get(e.ticker) ?? 0) + (Number(e.qty) || 0));
    }
    if (e.date > after && (e.kind === 'trade' || e.kind === 'transfer')) {
      const c = Number(e.cash) || 0;
      cash.set(e.ticker, (cash.get(e.ticker) ?? 0) + c);
      // Money put to work in the position that day, for its percentage.
      const opens = Math.abs(prior) < 1e-9 || Math.sign(Number(e.qty) || 0) === Math.sign(prior);
      if (opens) bought.set(e.ticker, (bought.get(e.ticker) ?? 0) + Math.abs(c));
    }
  }
  return { start, end, cash, bought };
}

/**
 * `walks`: one { opening, events } per account. `prev` is the trading day the
 * move is measured from, `day` the one it ends on; `priceOn(ticker, day)` the
 * close as traded. Returns holdings best first, and the day's remainder.
 */
export function dayBreakdown({ walks, priceOn, prev, day, dayPnl = null }) {
  const by = new Map();
  for (const walk of walks ?? []) {
    if (!walk?.opening?.date) continue;
    const { start, end, cash, bought } = walkTo(walk, prev, day);
    for (const t of new Set([...start.keys(), ...end.keys(), ...cash.keys()])) {
      const q0 = start.get(t) ?? 0;
      const q1 = end.get(t) ?? 0;
      if (Math.abs(q0) < 1e-9 && Math.abs(q1) < 1e-9 && !cash.has(t)) continue;
      const p0 = Math.abs(q0) > 1e-9 ? priceOn(t, prev) : 0;
      const p1 = Math.abs(q1) > 1e-9 ? priceOn(t, day) : 0;
      if (p0 == null || p1 == null || !Number.isFinite(p0) || !Number.isFinite(p1)) continue;
      const row = by.get(t) ?? { ticker: t, pnl: 0, base: 0, value: 0, shares: 0 };
      row.pnl += q1 * p1 - q0 * p0 + (cash.get(t) ?? 0);
      row.base += Math.abs(q0 * p0) + (bought.get(t) ?? 0);
      row.value += q1 * p1;
      row.shares += q1;
      by.set(t, row);
    }
  }
  const holdings = [...by.values()]
    .map((r) => ({ ...r, pct: r.base > 0 ? (r.pnl / r.base) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct || b.pnl - a.pnl);
  const explained = holdings.reduce((s, r) => s + r.pnl, 0);
  return { holdings, rest: Number.isFinite(dayPnl) ? dayPnl - explained : null };
}
