/**
 * Trades entered in the app after the last statement, as events for the
 * daily history.
 *
 * The history walks forward from the statements, and they stop at their
 * closing date. Every buy, top-up and sale entered here after it was missing
 * from the walk, which went on holding the statement's shares — so the day the
 * walk handed over to the live account took all the difference at once. On
 * 15 October 2026 that read −2.5% for a day IBKR had up +0.86%. Built from the
 * last statement, the day reads right; built from one a few weeks old, it was
 * out by anything from −4.7% to −19%.
 *
 * Each position already keeps what is needed: the day it was opened, every
 * top-up (`adds`) and every sale (`exits`), with shares and prices. Only those
 * dated after the statement are taken, so nothing the statement already holds
 * is counted twice. Money in and out needs nothing here: a withdrawal is
 * written into the ledger when it is recorded.
 */

const sum = (list, f) => (list ?? []).reduce((s, x) => s + f(x), 0);

/** A holding change: buying a long or covering a short adds shares and costs cash. */
function trade(date, ticker, shares, price, dir) {
  const signed = dir === 'Short' ? -shares : shares;
  return { date, ticker, qty: signed, price, cash: -signed * price, kind: 'trade' };
}

/**
 * `after` is the last statement's closing date. Returns events dated after it,
 * in the ledger's shape: { date, ticker, qty, price, cash, kind: 'trade' }.
 */
export function appTradeEvents(positions, after) {
  if (!after) return [];
  const out = [];
  for (const p of positions ?? []) {
    if (!p?.ticker || !(p.entry > 0)) continue;
    const adds = (p.adds ?? []).filter((a) => a.qty > 0 && a.price > 0);
    const exits = (p.exits ?? []).filter((e) => e.qty > 0 && e.price > 0);

    // Opened after the statement: the first purchase, before any top-up. Its
    // size is what is held now plus what was sold less what was added since;
    // a closed position's qty is already everything it ever sold.
    if (p.open > after && !p.carriedIn) {
      const held = p.status === 'Closed' ? 0 : p.qty;
      const first = held + sum(exits, (e) => e.qty) - sum(adds, (a) => a.qty);
      // The entry is the average over the first purchase and the top-ups.
      const firstPrice = first > 0 ? (p.entry * (first + sum(adds, (a) => a.qty)) - sum(adds, (a) => a.qty * a.price)) / first : 0;
      if (first > 1e-9 && firstPrice > 0) out.push(trade(p.open, p.ticker, first, firstPrice, p.dir));
    }
    for (const a of adds) if (a.d > after) out.push(trade(a.d, p.ticker, a.qty, a.price, p.dir));
    for (const e of exits) if (e.d > after) out.push(trade(e.d, p.ticker, -e.qty, e.price, p.dir));
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}
