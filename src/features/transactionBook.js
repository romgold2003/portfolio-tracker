/**
 * A book rebuilt from a broker's plain transaction history.
 *
 * An Interactive Brokers statement states its own positions, cost basis and
 * profit, and this app takes them as stated. Other brokers mostly export only
 * the transactions — buys, sells, dividends, fees, deposits — so here the book
 * is worked out by replaying them, in order, across every year imported:
 *
 *   holdings     what was bought less what was sold
 *   cost         first in, first out — the lots a sale takes are the oldest
 *                still held, which is the default most brokers and tax
 *                authorities use
 *   profit       what a sale brought in less the cost of the lots it took
 *   cash         every cash movement added up from the first file
 *
 * Replaying all the years together is the point. A sale in 2025 of shares
 * bought in 2024 can only be costed if 2024 is in the same walk, so a year's
 * transactions are stored as they were read and the book is rebuilt from all
 * of them each time a year is added or removed.
 *
 * Two things the files cannot say, and the warnings name: shares held before
 * the earliest file (a sale of them has no purchase to cost against), and cash
 * held before it (a trade-only export starts from zero and can run negative).
 */
import { CG_IDS } from '../config/constants.js';

const EMPTY = 1e-9;

/**
 * Within one moment, money arrives before it is spent and shares are bought
 * before they are sold. Exports without times put a day trade's two legs on
 * the same instant, and taking the sale first would sell shares not yet bought.
 */
const RANK = { deposit: 0, buy: 1, dividend: 2, interest: 2, fee: 2, sell: 3, withdrawal: 4 };

export function sortTransactions(list) {
  return [...list].sort((a, b) => a.at.localeCompare(b.at)
    || (RANK[a.kind] ?? 2) - (RANK[b.kind] ?? 2)
    || (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Transactions split into one record per calendar year, ready for the year
 * slots. With `year` given, only that year's are kept.
 */
export function transactionRecords(transactions, { year = null, source = '' } = {}) {
  const byYear = new Map();
  for (const t of transactions) {
    const y = Number(t.date.slice(0, 4));
    if (year && y !== year) continue;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(t);
  }
  return [...byYear.entries()].sort(([a], [b]) => a - b).map(([y, list]) => {
    const sorted = sortTransactions(list);
    return {
      kind: 'transactions',
      year: y,
      from: sorted[0].date,
      to: sorted[sorted.length - 1].date,
      periodStart: sorted[0].date,
      periodEnd: sorted[sorted.length - 1].date,
      source,
      accounts: [],
      twr: null,
      splits: [],
      transactions: sorted,
    };
  });
}

/** Every transaction replayed in order: lots, profit, cash and the dated events. */
export function replayTransactions(transactions) {
  const lots = new Map();
  const runStart = new Map();
  const lastPrice = new Map();
  const uncovered = new Map();
  const closed = [];
  const flows = [];
  const events = [];
  const income = { dividends: 0, interest: 0, commissions: 0, tax: 0 };
  let cash = 0;
  let lowest = { value: 0, date: null };

  const heldOf = (ticker) => (lots.get(ticker) ?? []).reduce((s, l) => s + l.qty, 0);

  for (const t of sortTransactions(transactions)) {
    if (t.kind === 'buy') {
      if (heldOf(t.ticker) <= EMPTY) runStart.set(t.ticker, t.date);
      if (!lots.has(t.ticker)) lots.set(t.ticker, []);
      // The fee is part of what the shares cost.
      lots.get(t.ticker).push({ qty: t.qty, unit: -t.cash / t.qty, date: t.date });
      lastPrice.set(t.ticker, t.price);
      events.push({ date: t.date, at: t.at, kind: 'trade', ticker: t.ticker, qty: t.qty, price: t.price, cash: t.cash });
    } else if (t.kind === 'sell') {
      const queue = lots.get(t.ticker) ?? [];
      let remaining = t.qty;
      let cost = 0;
      while (remaining > EMPTY && queue.length) {
        const lot = queue[0];
        const take = Math.min(lot.qty, remaining);
        cost += take * lot.unit;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= EMPTY) queue.shift();
      }
      if (remaining > EMPTY) {
        // Shares with no purchase in the files: costed at what they sold for,
        // so the sale shows and books no profit rather than an invented one.
        uncovered.set(t.ticker, (uncovered.get(t.ticker) ?? 0) + remaining);
        cost += remaining * (t.cash / t.qty);
      }
      closed.push({
        ticker: t.ticker,
        open: runStart.get(t.ticker) ?? t.date,
        close: t.date,
        cost,
        pnl: t.cash - cost,
        uncovered: remaining > EMPTY,
      });
      if (heldOf(t.ticker) <= EMPTY) runStart.delete(t.ticker);
      lastPrice.set(t.ticker, t.price);
      events.push({ date: t.date, at: t.at, kind: 'trade', ticker: t.ticker, qty: -t.qty, price: t.price, cash: t.cash });
    } else if (t.kind === 'deposit' || t.kind === 'withdrawal') {
      flows.push({ date: t.date, amount: t.cash, description: t.kind === 'deposit' ? 'Deposit' : 'Withdrawal' });
      events.push({ date: t.date, at: t.at, kind: 'flow', cash: t.cash });
    } else {
      if (t.kind === 'dividend') income.dividends += t.cash;
      else if (t.kind === 'interest') income.interest += t.cash;
      else if (t.kind === 'fee') income.commissions += t.cash;
      events.push({ date: t.date, at: t.at, kind: t.kind, ...(t.ticker ? { ticker: t.ticker } : {}), cash: t.cash });
    }

    cash += t.cash;
    if (cash < lowest.value) lowest = { value: cash, date: t.date };
  }

  return { lots, runStart, lastPrice, uncovered, closed, flows, events, income, cash, lowest };
}

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the files cannot tell, said before the import rather than discovered after. */
export function transactionWarnings(records) {
  const book = replayTransactions(records.flatMap((r) => r.transactions ?? []));
  const out = [];
  if (book.uncovered.size) {
    const names = [...book.uncovered.keys()];
    out.push(`${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}: `
      + 'more shares were sold than these files show being bought, so those sales count as no profit. '
      + 'Add the earlier years — back to when the shares were bought — to cost them properly.');
  }
  if (book.lowest.value < -0.01) {
    out.push(`Cash goes negative (${money(book.lowest.value)} on ${book.lowest.date}): the files probably leave out `
      + 'deposits, or the account held cash before the earliest file. Correct it with Edit cash after importing.');
  }

  const all = records.flatMap((r) => r.transactions ?? []);

  /**
   * The same transfer listed twice.
   *
   * Some exports carry money both as the transfer and again as a movement in a
   * cash ledger, and reading both deposits the money twice — the account comes
   * out richer by exactly that amount. Two genuine deposits of the same sum on
   * the same day are possible, so this is said rather than acted on.
   */
  const transfers = new Map();
  for (const t of all) {
    if (t.kind !== 'deposit' && t.kind !== 'withdrawal') continue;
    const key = `${t.kind}|${t.date}|${t.cash}`;
    transfers.set(key, (transfers.get(key) ?? 0) + 1);
  }
  const doubled = [...transfers].filter(([, n]) => n > 1);
  if (doubled.length) {
    const examples = doubled.slice(0, 3).map(([key, n]) => {
      const [kind, date, cash] = key.split('|');
      return `${n} ${kind}s of ${money(Math.abs(Number(cash)))} on ${date}`;
    });
    out.push(`${examples.join(', ')}${doubled.length > 3 ? ' and more' : ''}: if that is one transfer listed twice — `
      + 'once as a transfer and again as a cash movement — the account comes out that much too high. '
      + 'Delete the repeated rows from the file before importing.');
  }

  const trades = new Map();
  for (const t of all) {
    if (t.kind !== 'buy' && t.kind !== 'sell') continue;
    const key = `${t.at}|${t.kind}|${t.ticker}|${t.qty}|${t.price}`;
    trades.set(key, (trades.get(key) ?? 0) + 1);
  }
  const repeated = [...trades].filter(([, n]) => n > 1);
  if (repeated.length) {
    const [at, kind, ticker, qty] = repeated[0][0].split('|');
    out.push(`${repeated.length} trade${repeated.length === 1 ? ' appears' : 's appear'} more than once with the same time, `
      + `size and price (e.g. ${kind} ${qty} ${ticker} at ${at}). Partial fills can look like that; a trade listed twice `
      + 'would overstate the holding and the cash spent.');
  }

  const foreign = [...new Set(all.map((t) => t.currency).filter((c) => c && c !== 'USD'))];
  if (foreign.length) {
    out.push(`Amounts in ${foreign.join(', ')}: the app shows every amount as dollars and fetches live prices in US dollars, `
      + "so values can differ from your broker's.");
  }

  return out;
}

/**
 * How the account value is built from the files, line by line.
 *
 * Put in front of the person importing so that a wrong column shows up as a
 * wrong line — deposits of twice what they paid in, holdings a hundred times
 * too large — before it becomes a wrong account.
 */
export function transactionSummary(records) {
  const all = records.flatMap((r) => r.transactions ?? []);
  const book = replayTransactions(all);
  const total = (kinds, sign = 1) => all
    .filter((t) => kinds.includes(t.kind))
    .reduce((s, t) => s + sign * t.cash, 0);

  let holdings = 0;
  for (const [ticker, lots] of book.lots) {
    const qty = lots.reduce((s, l) => s + l.qty, 0);
    if (qty > EMPTY) holdings += qty * (book.lastPrice.get(ticker) ?? 0);
  }

  return {
    deposits: total(['deposit']),
    withdrawals: total(['withdrawal'], -1),
    bought: total(['buy'], -1),
    sold: total(['sell']),
    income: total(['dividend', 'interest']),
    fees: total(['fee'], -1),
    cash: book.cash,
    holdings,
    account: book.cash + holdings,
  };
}

/** A journal rebuilt from every year of transactions. */
export function journalFromTransactions(records, existing = {}) {
  const sorted = [...records].sort((a, b) => a.year - b.year);
  const book = replayTransactions(sorted.flatMap((r) => r.transactions ?? []));
  const stamp = Date.now() * 1000;
  let count = 0;
  const nextId = () => { count += 1; return stamp + count; };
  const cls = (ticker) => (CG_IDS[ticker] ? 'Crypto' : 'Stocks');

  const closed = book.closed.filter((c) => c.cost > 0).map((c) => ({
    id: nextId(),
    ticker: c.ticker,
    cls: cls(c.ticker),
    dir: 'Long',
    status: 'Closed',
    open: c.open,
    close: c.close,
    entry: c.cost,
    cur: c.cost + c.pnl,
    qty: 1,
    origQty: 1,
    amount: c.cost,
    summary: true,
    reason: null,
    exits: [{ d: c.close, qty: 1, price: c.cost + c.pnl, pnl: c.pnl, pct: 100, prevClose: null }],
  }));

  const open = [];
  for (const [ticker, lots] of book.lots) {
    const qty = lots.reduce((s, l) => s + l.qty, 0);
    if (qty <= EMPTY) continue;
    const cost = lots.reduce((s, l) => s + l.qty * l.unit, 0);
    open.push({
      id: nextId(),
      ticker,
      cls: cls(ticker),
      dir: 'Long',
      status: 'Open',
      open: book.runStart.get(ticker) ?? lots[0].date,
      close: null,
      entry: cost / qty,
      cur: book.lastPrice.get(ticker) ?? cost / qty,
      qty,
      amount: cost,
      reason: null,
    });
  }

  const last = sorted[sorted.length - 1];
  return {
    positions: [...closed, ...open],
    cash: book.cash,
    snapshots: existing.snapshots ?? [],
    cashFlows: book.flows,
    income: book.income,
    openingNav: null,
    ledger: {
      from: `${sorted[0].year}-01-01`,
      to: last.to,
      openingCash: 0,
      openingHoldings: {},
      openingMarks: {},
      events: book.events.map(({ at, ...rest }) => rest),
      holdings: Object.fromEntries(open.map((p) => [p.ticker, p.qty])),
    },
    apiKey: existing.apiKey ?? '',
    statements: sorted,
  };
}
