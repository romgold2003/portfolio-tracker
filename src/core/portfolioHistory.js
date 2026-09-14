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
  for (const day of eachDay(opening.date, to)) {
    const todays = byDay.get(day);
    let deposit = 0;
    let withdrawal = 0;

    for (const event of todays ?? []) {
      if (MOVES_SHARES.has(event.kind) && event.ticker) {
        holdings.set(event.ticker, (holdings.get(event.ticker) ?? 0) + (Number(event.qty) || 0));
      }
      if (event.kind === 'flow') {
        const amount = Number(event.cash) || 0;
        if (amount >= 0) deposit += amount; else withdrawal += amount;
      }
      cash += Number(event.cash) || 0;
    }

    if (day < start) continue;

    let positionsValue = 0;
    let stale = 0;
    for (const [ticker, qty] of holdings) {
      if (Math.abs(qty) < 1e-9) continue;
      let price = priceOn(ticker, day);
      const fresh = price > 0;
      if (!fresh) price = lastKnownOn(lastKnown[ticker], day);
      if (!(price > 0)) continue;
      const value = qty * price;
      positionsValue += value;
      if (!fresh) stale += Math.abs(value);
    }

    out.push({
      date: day,
      totalAccountValue: round(positionsValue + cash),
      cashValue: round(cash),
      positionsValue: round(positionsValue),
      externalCashFlow: round(deposit + withdrawal),
      deposit: round(deposit),
      withdrawal: round(withdrawal),
      /** Value carried at a last-known mark rather than a real close. */
      stalePositions: round(stale),
    });
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

/**
 * The return over a window, from the account valued every day.
 *
 *   r(d)  = ( value(d) − money paid in on d ) / value(d−1)
 *   total = PROD( r ) − 1
 *
 * The time-weighted return, which is what a broker reports: each day's move
 * over the balance that made it, so a deposit changes the balance and never the
 * percentage. Measured on this account's three years it reproduces IBKR's own
 * figures to within about half a point, where the estimate built from trades
 * alone was out by as much as forty-five.
 *
 * `from` is the first day inside the window, so the starting value is the close
 * before it; `from` null means the whole history. Null when the window holds no
 * day with a balance before it to measure from.
 */
export function periodReturnFromHistory(rows, from, to) {
  let growth = 1;
  let startValue = null;
  let endValue = null;
  let paidIn = 0;

  for (let i = 1; i < (rows?.length ?? 0); i++) {
    const row = rows[i];
    const prev = rows[i - 1];
    if (from && row.date < from) continue;
    if (to && row.date > to) break;
    if (!(prev.totalAccountValue > 0)) continue;
    if (startValue == null) startValue = prev.totalAccountValue;
    const flow = Number(row.externalCashFlow) || 0;
    growth *= (row.totalAccountValue - flow) / prev.totalAccountValue;
    paidIn += flow;
    endValue = row.totalAccountValue;
  }

  if (startValue == null) return null;
  return {
    returnPct: (growth - 1) * 100,
    /** What the window earned: the change in value, less the money paid in during it. */
    pnl: endValue - startValue - paidIn,
    startValue,
    endValue,
    paidIn,
  };
}

/**
 * Year to date, by the most reliable measure available.
 *
 * The broker's own time-weighted figure chained to today when there is one:
 * Interactive Brokers statements carry it, and it matches their app exactly.
 * Otherwise the account valued every day, deposits taken out and the days
 * compounded — the same measure as every other window.
 *
 * What it replaces for a history with no broker figure was profit over the
 * balance the year opened with. That credits the whole year's profit to the
 * money the account started the year with, including profit earned on money
 * paid in since. A bank history that opened 2026 at $2,845, took in $16,350 over
 * the year and made $2,500 read +88%; valued day by day it made +20.9%.
 *
 * Null while the daily values are not there to measure, so a caller can wait
 * rather than show a figure it knows to be wrong.
 */
export function yearToDateReturn(fromTrades, rows, from, to) {
  if (fromTrades?.method === 'broker') return fromTrades;
  const measured = periodReturnFromHistory(rows, from, to);
  return measured ? { ...measured, method: 'history' } : null;
}

/**
 * A split-adjusted close, as the shares were actually priced that day.
 *
 * Price histories are adjusted for every split since, all the way back. A
 * journal's share counts are the ones traded, so a past day valued at an
 * adjusted close is out by the whole split: SCO's April closes read four times
 * what was paid after its 1-for-4 reverse split in May, and an account holding
 * it that week rose sixteen per cent one day and fell twenty the next on moves
 * that never happened.
 *
 * Each split after the day is undone — a 1-for-4 divides the close by four, a
 * 10-for-1 multiplies it by ten — except one the journal has already expressed
 * its share counts in. An Interactive Brokers statement reports the splits of
 * what it held, and the import rescales every earlier holding to after-split
 * shares; undoing such a split in the price as well would count it twice.
 * `applied` is those, for this ticker; a split within a few days of one counts
 * as the same, since the broker and the price service date it a day apart.
 */
export function asTradedClose(close, day, splits = [], applied = []) {
  if (close == null) return null;
  let factor = 1;
  for (const split of splits ?? []) {
    if (!(split?.date > day) || !(split.numerator > 0) || !(split.denominator > 0)) continue;
    const alreadyApplied = (applied ?? []).some((a) => a?.date
      && Math.abs(Date.parse(a.date) - Date.parse(split.date)) <= 5 * 86400000);
    if (!alreadyApplied) factor *= split.numerator / split.denominator;
  }
  return close * factor;
}
