/**
 * The journal behind the demo account.
 *
 * A book to show the app with, not a fixture. Everything in here is generated
 * to be internally consistent with the same rules the app enforces on a real
 * journal — cash is the deposits minus what was staked plus what came back, the
 * closed trades' exits sum to their P&L, the equity curve ends exactly on the
 * account value the positions imply — because a demo that does not add up is a
 * demo that gets asked about the one number that is wrong.
 *
 * The prices are real and fetched live at seed time. Entry prices are then
 * worked *backwards* from a designed return, so that a position meant to be
 * eleven percent up is eleven percent up against today's actual market rather
 * than against a made-up quote that the app's next refresh would overwrite —
 * which is what a book of invented prices turns into within thirty seconds of
 * being opened.
 *
 * Deterministic: the same seed gives the same book, so re-seeding the demo
 * after someone has clicked around it restores exactly what was there.
 */

/** mulberry32 — small, fast, and repeatable across machines. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Ten open positions across ten sectors.
 *
 * `ret` is where the position stands right now, in percent, and is what the
 * entry price is solved from. The spread is deliberate rather than random: a
 * demo book of all winners is not believable and a book of all losers is not
 * worth showing, so it runs from a 60% winner down to a 34% loser with most of
 * the weight in the unremarkable middle, which is what a real book looks like.
 *
 * `cost` is roughly what was staked, in dollars. Sizes vary because they do.
 */
const OPEN = [
  { ticker: 'NVDA', cls: 'Stocks', ret: 62.4, cost: 6200 },   // Technology
  { ticker: 'MSFT', cls: 'Stocks', ret: 14.8, cost: 5400 },   // Technology
  { ticker: 'GOOGL', cls: 'Stocks', ret: 23.1, cost: 4100 },  // Communication services
  { ticker: 'JPM', cls: 'Stocks', ret: 7.9, cost: 3800 },     // Financials
  { ticker: 'LLY', cls: 'Stocks', ret: -12.6, cost: 3300 },   // Healthcare
  { ticker: 'XOM', cls: 'Stocks', ret: -4.2, cost: 2600 },    // Energy
  { ticker: 'CAT', cls: 'Stocks', ret: 9.6, cost: 2900 },     // Industrials
  { ticker: 'RIVN', cls: 'Stocks', ret: -33.7, cost: 1500 },  // Consumer discretionary
  { ticker: 'SPY', cls: 'Stocks', ret: 11.2, cost: 7500 },    // Broad market
  { ticker: 'GLD', cls: 'Commodities', ret: 18.4, cost: 3400 },
  { ticker: 'BTC', cls: 'Crypto', ret: 29.5, cost: 5800 },
  { ticker: 'ETH', cls: 'Crypto', ret: -8.3, cost: 2200 },
];

/** When each was opened. Spread through the year so the cards are not all one date. */
const OPENED = [
  '2026-01-12', '2026-02-03', '2026-01-27', '2026-03-09', '2026-04-14',
  '2026-05-06', '2026-03-24', '2026-06-02', '2026-01-08', '2026-02-18',
  '2026-01-15', '2026-07-07',
];

/**
 * Fourteen finished trades.
 *
 * Seven up, seven down, which is close to the win rate a real journal shows
 * before survivorship gets at it — and the losers are deliberately smaller on
 * average than the winners, because that asymmetry is the whole thing the app
 * exists to make visible.
 *
 * One is a short, and one exits in three slices, so the demo shows those cards
 * rather than only the plain long-in-long-out.
 */
const CLOSED = [
  { ticker: 'META', cls: 'Stocks', dir: 'Long', open: '2026-01-06', close: '2026-02-20', entry: 604.5, ret: 21.4, cost: 4200, reason: 'Ad revenue re-rating after Q4.' },
  { ticker: 'TSLA', cls: 'Stocks', dir: 'Long', open: '2026-01-20', close: '2026-03-11', entry: 342.8, ret: -17.6, cost: 3100, reason: 'Delivery miss. Cut it rather than average down.' },
  { ticker: 'COIN', cls: 'Crypto', dir: 'Long', open: '2026-02-02', close: '2026-04-08', entry: 248.3, ret: 44.9, cost: 2800, reason: 'Levered to the ETF flows.' },
  { ticker: 'PFE', cls: 'Stocks', dir: 'Long', open: '2026-02-11', close: '2026-04-22', entry: 27.4, ret: -9.8, cost: 2400, reason: 'Pipeline read-out disappointed.' },
  { ticker: 'SOL', cls: 'Crypto', dir: 'Long', open: '2026-03-02', close: '2026-05-15', entry: 186.2, ret: 33.6, cost: 2100, reason: 'Rode it into the upgrade.' },
  { ticker: 'AMD', cls: 'Stocks', dir: 'Long', open: '2026-03-17', close: '2026-05-29', entry: 168.9, ret: -14.2, cost: 2700, reason: 'Lost the share story to NVDA.' },
  { ticker: 'BA', cls: 'Stocks', dir: 'Long', open: '2026-04-06', close: '2026-06-12', entry: 214.6, ret: -21.3, cost: 1900, reason: 'Another certification delay.' },
  { ticker: 'AMZN', cls: 'Stocks', dir: 'Long', open: '2026-04-21', close: '2026-06-30', entry: 219.7, ret: 16.8, cost: 3600, reason: 'AWS margin beat.' },
  { ticker: 'SLV', cls: 'Commodities', dir: 'Long', open: '2026-05-04', close: '2026-07-09', entry: 31.85, ret: 12.4, cost: 1800, reason: 'Industrial demand plus the metals bid.' },
  { ticker: 'NEE', cls: 'Stocks', dir: 'Long', open: '2026-05-19', close: '2026-07-21', entry: 78.4, ret: -6.1, cost: 2200, reason: 'Rates went against it.' },
  { ticker: 'MSTR', cls: 'Crypto', dir: 'Long', open: '2026-06-08', close: '2026-07-30', entry: 412.6, ret: -26.4, cost: 1700, reason: 'Premium to NAV collapsed. Sized too big.' },
  { ticker: 'COST', cls: 'Stocks', dir: 'Long', open: '2026-06-24', close: '2026-08-14', entry: 968.3, ret: 8.7, cost: 3300, reason: 'Membership fee increase flowed through.' },
  // The short. Profits when the price falls, which is worth having on screen.
  { ticker: 'GME', cls: 'Stocks', dir: 'Short', open: '2026-07-02', close: '2026-08-05', entry: 31.2, ret: 18.9, cost: 1600, reason: 'Faded the squeeze.' },
  // The scaled exit: a third out into strength, a third on the retrace, the
  // rest at the close. Slices are quantity-weighted, which is what makes the
  // blended exit price on the card mean anything.
  {
    ticker: 'AAPL',
    cls: 'Stocks',
    dir: 'Long',
    open: '2026-05-11',
    close: '2026-08-27',
    entry: 232.4,
    cost: 4600,
    reason: 'Scaled out of it rather than guessing the top.',
    slices: [
      { d: '2026-07-15', share: 0.35, ret: 9.2 },
      { d: '2026-08-06', share: 0.35, ret: 15.6 },
      { d: '2026-08-27', share: 0.30, ret: 11.8 },
    ],
  },
];

/** Money in and out. A demo with no deposits reports its whole balance as profit. */
const CASH_FLOWS = [
  { date: '2026-01-05', amount: 42000, description: 'Opening transfer' },
  { date: '2026-03-16', amount: 9000, description: 'Monthly contribution' },
  { date: '2026-06-22', amount: 6000, description: 'Bonus' },
  { date: '2026-08-10', amount: -4000, description: 'Withdrawal' },
];

const INCOME = { dividends: 412.55, interest: 96.2, commissions: 148.3, tax: 71.4 };

/** Fallback quotes, used only for a ticker the price fetch could not answer. */
export const FALLBACK_PRICES = {
  NVDA: 189.4, MSFT: 512.3, GOOGL: 232.8, JPM: 308.6, LLY: 742.1,
  XOM: 114.2, CAT: 428.9, RIVN: 12.6, SPY: 668.4, GLD: 342.7,
  BTC: 111800, ETH: 4180,
};

/**
 * One finished trade, in the shape closePosition() leaves behind.
 *
 * The invariant that has to hold is realized() === the sum of the exits' P&L,
 * and it holds because both are computed from the same blended exit: qty comes
 * back to the original size and `cur` becomes the quantity-weighted average of
 * what the slices actually got.
 */
function closedPosition(spec, id) {
  const qty = round(spec.cost / spec.entry, 6);
  const amount = round(spec.entry * qty, 2);
  const sign = spec.dir === 'Short' ? -1 : 1;
  const priceFor = (ret) => round(spec.entry * (1 + (sign * ret) / 100), 4);

  const slices = spec.slices ?? [{ d: spec.close, share: 1, ret: spec.ret }];
  let taken = 0;
  const exits = slices.map((s, i) => {
    // The last slice takes whatever is left, so rounding cannot strand a share.
    const sliceQty = i === slices.length - 1
      ? round(qty - taken, 6)
      : round(qty * s.share, 6);
    taken = round(taken + sliceQty, 6);
    const price = priceFor(s.ret);
    const pnl = round((spec.dir === 'Long' ? price - spec.entry : spec.entry - price) * sliceQty, 6);
    return {
      d: s.d,
      qty: sliceQty,
      price,
      pnl,
      pct: round((sliceQty / qty) * 100, 4),
      // A closed trade must not be dragged into today's move by a stale
      // previous close, so there is none. See addClosedPosition().
      prevClose: null,
    };
  });

  const avgExit = exits.reduce((sum, e) => sum + e.price * e.qty, 0) / qty;

  return {
    id,
    ticker: spec.ticker,
    cls: spec.cls,
    dir: spec.dir,
    status: 'Closed',
    open: spec.open,
    close: spec.close,
    entry: spec.entry,
    cur: round(avgExit, 6),
    qty,
    origQty: qty,
    amount,
    reason: spec.reason ?? null,
    firstExit: exits[0].d,
    exits,
  };
}

/**
 * An equity curve that ends where the book actually is.
 *
 * Generated as a random walk and then bent onto its endpoints, because the
 * alternative — a walk left to wander — finishes somewhere near the account
 * value rather than on it, and the chart would disagree with the header by a
 * few hundred dollars on a screen where both are visible at once.
 *
 * Weekdays only. A flat Saturday in the middle of a curve reads as a data gap.
 */
function equityCurve({ from, to, start, end, random }) {
  const days = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    days.push(d.toISOString().slice(0, 10));
  }

  // A walk in log space, so the wobble scales with the balance rather than
  // being a fixed number of dollars that looks huge in January and tiny now.
  const steps = [0];
  for (let i = 1; i < days.length; i++) {
    steps.push(steps[i - 1] + (random() - 0.5) * 0.022);
  }

  const drift = Math.log(end / start);
  const last = steps[steps.length - 1] || 1;
  return days.map((date, i) => {
    // Subtract the walk's own endpoint and add the drift we want: the shape is
    // kept, the destination is imposed.
    const t = days.length > 1 ? i / (days.length - 1) : 1;
    const value = start * Math.exp(steps[i] - last * t + drift * t);
    return { date, value: round(value, 2) };
  });
}

/**
 * @param {object} options
 * @param {Record<string, number>} options.prices live quote per open ticker
 * @param {string} options.today the last day the curve runs to
 */
export function buildDemoJournal({ prices = {}, today = '2026-09-06', seed = 20260906 } = {}) {
  const random = rng(seed);
  let id = 1_760_000_000_000;
  const nextId = () => (id += 1000);

  const open = OPEN.map((spec, i) => {
    const cur = Number(prices[spec.ticker]) || FALLBACK_PRICES[spec.ticker];
    // The entry is solved from the live price and the designed return, not
    // invented: entry = cur / (1 + ret), so the position reads as intended
    // against the real market and keeps doing so after a refresh.
    const entry = round(cur / (1 + spec.ret / 100), spec.cls === 'Crypto' ? 2 : 4);
    const qty = round(spec.cost / entry, 6);
    return {
      id: nextId(),
      ticker: spec.ticker,
      cls: spec.cls,
      dir: 'Long',
      status: 'Open',
      open: OPENED[i] ?? OPENED[OPENED.length - 1],
      close: null,
      entry,
      cur: round(cur, 6),
      qty,
      amount: round(entry * qty, 2),
      reason: null,
    };
  });

  const closed = CLOSED.map((spec) => closedPosition(spec, nextId()));

  /**
   * Cash, derived rather than declared.
   *
   * Deposits, less what the open positions cost, plus what the finished ones
   * gave back, plus the income and less the costs. Writing a plausible-looking
   * number here instead would put the account total a few thousand away from
   * the trades that are supposed to explain it.
   */
  const deposits = CASH_FLOWS.reduce((sum, f) => sum + f.amount, 0);
  const staked = open.reduce((sum, p) => sum + p.entry * p.qty, 0);
  const banked = closed.reduce(
    (sum, p) => sum + p.exits.reduce((s, e) => s + e.pnl, 0),
    0,
  );
  const netIncome = INCOME.dividends + INCOME.interest - INCOME.commissions - INCOME.tax;
  const cash = round(deposits - staked + banked + netIncome, 2);

  const positionsValue = open.reduce((sum, p) => sum + p.cur * p.qty, 0);
  const account = round(positionsValue + cash, 2);

  return {
    // Newest first, the order the app itself keeps.
    positions: [...open].reverse().concat([...closed].reverse()),
    cash,
    cashFlows: CASH_FLOWS,
    income: INCOME,
    snapshots: equityCurve({
      from: CASH_FLOWS[0].date,
      to: today,
      start: CASH_FLOWS[0].amount,
      end: account,
      random,
    }),
    // No broker statement behind a demo, so nothing to anchor to. The return is
    // measured from the cash flows, which is the honest thing to show.
    openingNav: null,
    // Quotes come from the deployment's own endpoints; a demo must not ship
    // somebody's API key.
    apiKey: '',
  };
}

export const DEMO_TICKERS = OPEN.map((o) => o.ticker);
