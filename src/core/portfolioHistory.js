/**
 * The daily portfolio history: what the account was actually worth, each day.
 *
 * One dataset, built once, and everything else reads from it. The percentage
 * curve and the index comparisons will be computed from this same timeline
 * rather than from parallel reconstructions that drift apart.
 *
 * ── The method, which is the broker's own ────────────────────────────────
 *
 * A broker's net asset value is not a clever quantity:
 *
 *   NAV(d) = Σ (quantity held on d × that day's mark) + cash(d)
 *
 * and their Change-in-NAV report is the same identity rolled forward:
 *
 *   NAV(d) = NAV(d−1) + mark-to-market + deposits + dividends + interest
 *            + fees + commissions
 *
 * So this walks **forward** from a stated opening balance, applying every dated
 * event in order. It never derives a past holding from today's.
 *
 * That distinction is the whole point. Walking backwards can only ever undo the
 * movements it knows about, so a purchase missing from the record silently
 * becomes a position that was "always there", and the error is spread across
 * every earlier day. Walking forward from a stated opening balance cannot do
 * that: if the events are wrong the closing value misses, loudly, and can be
 * checked against the statement.
 *
 * ── What a day's row carries ─────────────────────────────────────────────
 *
 * Deposits are kept as their own field rather than folded into the value. They
 * genuinely make the account bigger, so they belong in `totalAccountValue` —
 * and they are not performance, so a return has to be able to take them back
 * out. Both facts have to survive into the dataset for that to be possible.
 */

/** Every calendar day from `from` to `to` inclusive. Weekends included. */
export function eachDay(from, to) {
  const out = [];
  let at = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(at) || !Number.isFinite(end)) return out;
  while (at <= end && out.length < 4000) {
    out.push(new Date(at).toISOString().slice(0, 10));
    at += 86_400_000;
  }
  return out;
}

/**
 * Events that move shares rather than only cash.
 *
 * A transfer between two accounts of the same statement is one of these: the
 * shares move, the cash does not, and across a combined statement the two legs
 * cancel. Leaving them out would make one side of the book vanish on the day it
 * moved and reappear on the other.
 */
const MOVES_SHARES = new Set(['trade', 'transfer']);

/**
 * The daily history.
 *
 * `opening` is the stated starting point: a date, the cash balance on it, and
 * the quantity of each holding. `events` are every dated movement after it.
 * `priceOn(ticker, day)` returns that ticker's mark on or before the day.
 *
 * A holding with no price is carried at its last known mark rather than dropped:
 * a delisted stub worth a hundred dollars must not delete four months from a
 * twenty-six thousand dollar account. How much of the book was priced that way
 * is reported per day in `stalePositions`, so a caller can judge rather than
 * guess.
 */
export function buildPortfolioHistory({
  opening, events = [], priceOn, from, to, lastKnown = {},
}) {
  if (typeof priceOn !== 'function' || !opening?.date || !to) return [];
  const start = from && from > opening.date ? from : opening.date;

  const byDay = new Map();
  for (const event of events) {
    if (!event?.date) continue;
    const list = byDay.get(event.date);
    if (list) list.push(event); else byDay.set(event.date, [event]);
  }

  const holdings = new Map(Object.entries(opening.holdings ?? {}));
  let cash = Number(opening.cash) || 0;

  const out = [];

  /**
   * The walk always begins at the opening date, even when the window asked for
   * starts later: a day's value depends on every event before it, so the state
   * has to be rolled forward through them whether or not those days are drawn.
   *
   * Events dated before the opening date are ignored entirely. A statement can
   * carry an adjustment from an earlier year, and applying it here would put
   * last year's tax on this year's first day.
   */
  /** A price and whether it came from the market, with the dated-mark fallback. */
  const priceFor = (ticker, day) => {
    const quoted = priceOn(ticker, day);
    if (quoted > 0) return { value: quoted, fresh: true };
    return { value: lastKnownOn(lastKnown[ticker], day), fresh: false };
  };

  /** Yesterday, for repricing the shares that were held through the night. */
  let prevDay = null;
  let prevHoldings = new Map();
  /** The prices yesterday actually used, so today can be compared against them. */
  let prevPrices = new Map();

  for (const day of eachDay(opening.date, to)) {
    // Captured before today's trades, so it is genuinely what was held
    // overnight rather than what the day ended up holding.
    prevHoldings = new Map(holdings);

    const todays = byDay.get(day);
    let deposit = 0;
    let withdrawal = 0;
    /**
     * Cash that is neither a transfer nor the other half of a trade: dividends,
     * interest, commissions, withholding tax. It is performance — money the
     * holdings earned or cost — so it belongs in the day's return, and unlike a
     * deposit it is not money you put in.
     */
    let income = 0;

    for (const event of todays ?? []) {
      if (MOVES_SHARES.has(event.kind) && event.ticker) {
        holdings.set(event.ticker, (holdings.get(event.ticker) ?? 0) + (Number(event.qty) || 0));
      }
      if (event.kind === 'flow') {
        const amount = Number(event.cash) || 0;
        if (amount >= 0) deposit += amount; else withdrawal += amount;
      } else if (!MOVES_SHARES.has(event.kind)) {
        // Not a transfer and not the cash leg of a trade, so it is income or a
        // cost: the account earned or paid it.
        income += Number(event.cash) || 0;
      }
      cash += Number(event.cash) || 0;
    }

    if (day < start) continue;

    let positionsValue = 0;
    let stale = 0;
    const todayPrices = new Map();
    for (const [ticker, qty] of holdings) {
      if (Math.abs(qty) < 1e-9) continue;
      const price = priceFor(ticker, day);
      if (!(price.value > 0)) continue;
      todayPrices.set(ticker, price);
      const value = qty * price.value;
      positionsValue += value;
      if (!price.fresh) stale += Math.abs(value);
    }

    /**
     * What the market did to money already invested, and nothing else.
     *
     * Yesterday's shares at today's prices against yesterday's. No cash term,
     * no trade term, no flow term — a deposit does not change a price or a
     * quantity held overnight, so it cannot appear here.
     *
     * Read from the prices each day already worked out, rather than looking
     * them up a second time.
     *
     * Only pairs of real closes count. A holding the price service cannot quote
     * is carried at the marks the statement supplies, and those are trade
     * prices — so the mark changes on the day it was traded, and differencing
     * it against the day before turns the gap between two fills into a price
     * move applied to the whole holding. That is not a market move and is not
     * counted as one.
     */
    let marketPnl = 0;
    if (prevDay) {
      for (const [ticker, qty] of prevHoldings) {
        if (Math.abs(qty) < 1e-9) continue;
        const now = todayPrices.get(ticker);
        const before = prevPrices.get(ticker);
        if (!now?.fresh || !before?.fresh) continue;
        marketPnl += qty * (now.value - before.value);
      }
    }

    out.push({
      date: day,
      totalAccountValue: round(positionsValue + cash),
      cashValue: round(cash),
      positionsValue: round(positionsValue),
      externalCashFlow: round(deposit + withdrawal),
      deposit: round(deposit),
      withdrawal: round(withdrawal),
      /**
       * The day's performance: price moves on shares already held, plus what
       * the holdings earned or cost in cash. No deposit can reach it.
       */
      marketPnl: round(marketPnl + income),
      /** Value carried at a last-known mark rather than a real close. */
      stalePositions: round(stale),
    });
    prevDay = day;
    prevPrices = todayPrices;
  }

  return out;
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * The last price actually seen for a ticker on or before a day.
 *
 * `marks` is a list of `{date, price}` — the opening mark from the statement
 * and the price of every trade in it. A ticker the price service has never
 * heard of still has these, and they are dated, which matters: taking simply
 * "the last price we ever saw" values the holding on every past day at a price
 * from its future. A delisted stub marked at 0.40 on the thirty-first of
 * December and eventually sold at 0.70 was being carried at 0.70 all year,
 * putting the opening balance seventy-five dollars out.
 */
function lastKnownOn(marks, day) {
  if (typeof marks === 'number') return marks > 0 ? marks : 0;
  if (!Array.isArray(marks)) return 0;
  let price = 0;
  for (const mark of marks) {
    if (!mark?.date || mark.date > day) continue;
    if (mark.price > 0) price = mark.price;
  }
  return price;
}

/**
 * The deposits and withdrawals in a history, one entry per day that had any.
 *
 * Two transfers on one day are one marker, because two triangles a pixel apart
 * are one smudge — the combined amount is what the day actually did.
 */
export function cashFlowMarkers(history) {
  const out = [];
  for (const row of history ?? []) {
    if (!row || !row.externalCashFlow) continue;
    out.push({
      date: row.date,
      amount: row.externalCashFlow,
      deposit: row.externalCashFlow > 0,
      value: row.totalAccountValue,
    });
  }
  return out;
}
