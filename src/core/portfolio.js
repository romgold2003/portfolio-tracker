/**
 * Pure portfolio mathematics. No DOM, no storage, no network — every function
 * here is a plain input/output calculation, which is what makes the P&L rules
 * below readable and testable.
 */
import { BETA } from '../config/constants.js';
import { sectorOf, sectorColour, CASH_COLOUR } from '../config/sectors.js';

/** Today as YYYY-MM-DD, the key format used throughout the app. */
export function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function costOf(p) { return p.entry * p.qty; }
export function curValOf(p) { return p.cur * p.qty; }

/** Open P&L. Shorts profit when the price falls, so the sign flips. */
export function unreal(p) {
  const cost = costOf(p);
  const value = curValOf(p);
  return p.dir === 'Long' ? value - cost : cost - value;
}

/** Banked P&L. Zero until the position is fully closed. */
export function realized(p) {
  if (p.status !== 'Closed') return 0;
  const cost = costOf(p);
  const value = curValOf(p);
  return p.dir === 'Long' ? value - cost : cost - value;
}

/**
 * What the position is worth right now.
 *   Long : entry*qty + (cur-entry)*qty = cur*qty
 *   Short: entry*qty + (entry-cur)*qty = collateral +/- P&L
 */
export function posValue(p) { return costOf(p) + unreal(p); }

/**
 * Today's P&L in dollars for one position.
 *
 * The day starts at whichever price you actually owned the shares from:
 *
 *   held since before today  ->  yesterday's close
 *   bought today             ->  the price you paid
 *
 * Yesterday's close is not stored, so it is recovered from the quoted change:
 *   dailyChg% = (cur - prevClose) / prevClose  =>  prevClose = cur / (1 + chg/100)
 *
 * Returns null when the starting price cannot be established, which for a
 * position held from before today means no quote has arrived yet.
 */
export function dailyDollar(p, today = todayStr()) {
  // Shares bought today were not owned at yesterday's close, so their day
  // starts at the price paid, not at the previous close. Counting the whole
  // day's move for them credits the portfolio with a gain it never had, and the
  // daily figure then fails to reconcile with the account value.
  //
  // This case needs no quote at all: the entry price and the current price are
  // both already known.
  if (p.open === today) {
    const move = (p.cur - p.entry) * p.qty;
    return p.dir === 'Long' ? move : -move;
  }

  /**
   * The price the day started at, taken from the feed rather than rebuilt.
   *
   * The quote carries the previous close outright. It used to be thrown away
   * and reconstructed from the day's percentage instead — `cur / (1 + chg)` —
   * which is only the same number while those two fields come from the same
   * moment. They do not have to: the price is updated on the extended-hours
   * path, on the regular refresh and by an import, and any of those landing
   * between one another leaves a percentage describing a price that is no
   * longer there. The reconstruction then quietly moves the whole day's
   * baseline, and every figure standing on it moves with it.
   *
   * The percentage remains the fallback, because a position quoted before this
   * field existed still has one.
   */
  if (Number.isFinite(p.prevClose) && p.prevClose > 0) {
    const move = (p.cur - p.prevClose) * p.qty;
    return p.dir === 'Long' ? move : -move;
  }

  if (p.dailyChg == null || !Number.isFinite(p.dailyChg)) return null;
  const factor = 1 + p.dailyChg / 100;
  if (factor <= 0) return null;
  const prevClose = p.cur / factor;
  const move = (p.cur - prevClose) * p.qty;
  return p.dir === 'Long' ? move : -move;
}

/**
 * P&L booked TODAY by selling — measured from the asset's previous close to the
 * exit price. Shares sold today still moved today, so they belong in the day's
 * total. Without this, closing a winner makes the daily figure collapse.
 */
export function dailyDollarExits(p, today = todayStr()) {
  if (!p.exits || !p.exits.length) return 0;
  // Shares bought and sold on the same day started at the price paid, so their
  // move is knowable even when no quote was ever recorded for them.
  const boughtToday = p.open === today;

  return p.exits.reduce((sum, e) => {
    if (e.d !== today) return sum;
    const validPrevClose = e.prevClose != null && Number.isFinite(e.prevClose) && e.prevClose > 0;
    const from = boughtToday ? p.entry : (validPrevClose ? e.prevClose : null);
    // Without a starting price there is nothing honest to attribute to today.
    if (from == null) return sum;
    const move = (e.price - from) * e.qty;
    return sum + (p.dir === 'Long' ? move : -move);
  }, 0);
}

/** Everything one position contributed today: the part still held, plus anything sold today. */
export function dailyDollarTotal(p, today = todayStr()) {
  const held = p.status === 'Open' ? (dailyDollar(p, today) || 0) : 0;
  return held + dailyDollarExits(p, today);
}

/** True when a position has no daily figure at all — neither held nor sold today. */
export function hasDailyFigure(p, today = todayStr()) {
  return dailyDollar(p, today) != null || dailyDollarExits(p, today) !== 0;
}

function betaOf(ticker, cls) {
  const t = (ticker || '').toUpperCase();
  if (BETA[t] != null) return BETA[t];
  if (cls === 'Crypto') return BETA.DEFAULT_CRYPTO;
  if (cls === 'Commodities') return BETA.DEFAULT_COMMOD;
  return BETA.DEFAULT_STOCK;
}

/**
 * Beta of one return series against the market.
 *
 *   beta = Cov(asset, market) / Var(market)
 *
 * This is the slope of a regression of the asset's returns on the market's,
 * which is what beta means: when the market moves 1%, this moves beta%.
 *
 * The other textbook form, rho * sigma_asset / sigma_market, is the same number
 * — substitute rho = Cov / (sigma_a * sigma_m) and it reduces to this one. It
 * is written this way because it needs one pass and no correlation term.
 *
 * Returns null below `minPoints` pairs: a beta from a handful of days is noise
 * wearing a number's clothes, and reporting it would be worse than admitting
 * there is not enough history.
 */
export function betaFromReturns(assetReturns, marketReturns, minPoints = 30) {
  const n = Math.min(assetReturns.length, marketReturns.length);
  if (n < minPoints) return null;

  const a = assetReturns.slice(-n);
  const m = marketReturns.slice(-n);
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanM = m.reduce((s, x) => s + x, 0) / n;

  let cov = 0;
  let varM = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - meanA) * (m[i] - meanM);
    varM += (m[i] - meanM) ** 2;
  }
  // A market that never moved has no slope to measure against.
  if (varM === 0) return null;
  return cov / varM;
}

/**
 * Portfolio beta: the weighted average of each holding's beta, over equity.
 *
 *   beta_p = SUM( w_i * beta_i ),   w_i = signed market value / total equity
 *
 * Two things about that denominator are easy to get wrong, and both change the
 * answer materially.
 *
 * It is *equity*, not the sum of the positions. Cash has a beta of zero, and
 * holding it genuinely dampens how much the account moves with the market — a
 * book that is half cash and half index has a beta of 0.5, not 1.0. Dividing by
 * invested capital instead quietly reports the beta of the invested part and
 * calls it the portfolio's. On a book holding 16% cash that overstated beta by
 * a fifth, which is the difference between market-neutral-ish and not.
 *
 * And the weights are *signed*. Being short a high-beta name reduces the book's
 * sensitivity, so it contributes negatively; summing absolute exposures would
 * make a hedged book look like a leveraged one.
 *
 * `measured` maps a ticker to a beta computed from real returns. Anything
 * missing falls back to the published assumption, so the figure degrades from
 * measured to estimated one position at a time rather than all at once.
 */
export function portfolioBeta(open, measured = new Map(), equity = null) {
  let weighted = 0;
  let gross = 0;
  let measuredWeight = 0;

  open.forEach((p) => {
    const w = Math.abs(curValOf(p));
    const sign = p.dir === 'Long' ? 1 : -1;
    const real = measured.get(p.ticker.toUpperCase());
    const beta = Number.isFinite(real) ? real : betaOf(p.ticker, p.cls);
    if (Number.isFinite(real)) measuredWeight += w;
    weighted += beta * w * sign;
    gross += w;
  });

  if (!gross) return null;
  // Falls back to gross exposure only when equity was not supplied, which is
  // the same number for a fully invested long book.
  const base = equity != null && equity > 0 ? equity : gross;
  return {
    beta: weighted / base,
    /** Share of the invested book whose beta was measured rather than assumed. */
    measuredPct: (measuredWeight / gross) * 100,
    /** How much of the account is not in the market at all. */
    cashDragPct: equity != null && equity > 0 ? Math.max(0, (1 - gross / equity)) * 100 : 0,
  };
}

/** The original position size, before any partial exits. */
export function baseQtyOf(p) { return p.origQty != null ? p.origQty : p.qty; }

/** What a given exit would book, without mutating anything. */
export function closeMath(p, price, qty) {
  const costPart = p.entry * qty;
  const pnl = (p.dir === 'Long' ? price - p.entry : p.entry - price) * qty;
  return { qty, costPart, pnl, proceeds: costPart + pnl, retPct: costPart ? (pnl / costPart) * 100 : 0 };
}

/** P&L already banked across a position's partial exits. */
export function bookedPnl(p) {
  return (p.exits || []).reduce((sum, e) => sum + e.pnl, 0);
}

export function pctD(pnl, base) { return base ? (pnl / base) * 100 : 0; }

/**
 * The equal-weight average return of a set of trades.
 *
 * Deliberately not the month's P&L over the month's capital. That figure is
 * whatever the largest position did — nine careful 5% winners and one oversized
 * 4% loser can make a month red by dollars and green by average, and both of
 * those are true things worth seeing side by side.
 *
 * Each trade counts once, whatever it was sized at, because the question is how
 * the typical decision worked out rather than how much money it moved.
 *
 * Null when nothing in the set has a cost to measure against, which is absent
 * rather than flat.
 */
export function avgTradeReturn(trades) {
  const returns = [];
  for (const t of trades) {
    const cost = costOf(t);
    if (cost > 0) returns.push((realized(t) / cost) * 100);
  }
  if (!returns.length) return null;
  return returns.reduce((sum, r) => sum + r, 0) / returns.length;
}

/** First and last calendar day of a YYYY-MM key. */
function monthBounds(key) {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    first: `${key}-01`,
    last: iso(new Date(Date.UTC(year, month, 0))),
    before: iso(new Date(Date.UTC(year, month - 1, 0))),
  };
}

/**
 * Every month from the first one with anything in it to this one, oldest first.
 *
 * Months where nothing happened are included on purpose. The account value is
 * chained backwards month by month, and a quiet month is a link in that chain —
 * skipping it would hand its deposits to whichever month came next.
 */
export function monthRange(first, last) {
  const out = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  const lastYear = Number(last.slice(0, 4));
  const lastMonth = Number(last.slice(5, 7));
  if (!(year > 0) || !(lastYear > 0)) return out;

  while ((year < lastYear || (year === lastYear && month <= lastMonth)) && out.length < 1200) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

/**
 * What each month earned, attributed to the month that did the work.
 *
 *   closed in the month  ->  what it banked
 *   opened in the month  ->  what it is up or down by, if still open
 *
 * Those two together add up to realised plus unrealised across the whole book,
 * exactly once each, which is what makes the chain in monthlyAccountReturns
 * arrive back at the real starting capital instead of drifting.
 *
 * The second rule is an approximation with a sharp edge, and it is named rather
 * than hidden: a position opened in January and still held is marked at today's
 * price, so all of its gain lands in January even though most of it happened
 * later. A journal has no month-by-month valuation of a holding, so there is no
 * honest way to spread it — `marked` counts the positions this applies to, and
 * the month says so on hover.
 */
export function monthPnl(positions) {
  const byMonth = new Map();
  const bucket = (key) => {
    if (!byMonth.has(key)) byMonth.set(key, { pnl: 0, marked: 0 });
    return byMonth.get(key);
  };

  for (const position of positions) {
    if (position.status === 'Closed') {
      if (position.close) bucket(position.close.slice(0, 7)).pnl += realized(position);
      continue;
    }
    if (!position.open) continue;
    const held = bucket(position.open.slice(0, 7));
    held.pnl += unreal(position);
    held.marked += 1;
  }
  return byMonth;
}

/**
 * The percentage the whole account moved in each month of its life.
 *
 * Worked backwards from what the account is worth today rather than forwards
 * from a recording of it, because the recording does not exist. Daily account
 * values are only written on days the app is open, so they begin the day it was
 * installed — every month before that had no answer at all, and the first weeks
 * of the recording are the install settling rather than the market: positions
 * still being entered and prices still arriving read as a 22% month.
 *
 * The trades have no such gap. They know when every position was taken and what
 * it did, so the account value at the start of any month is simply what it is
 * worth now, less everything earned since, less everything paid in since:
 *
 *   value(start of month) = value(end of month) - P&L(month) - deposits(month)
 *
 * Chained month by month back to the beginning. Subtracting the deposits is
 * what keeps them out of the return in both directions — they neither count as
 * profit nor quietly enlarge the base of the months before they arrived.
 *
 * The return is then the month's profit over what it opened with. Not Modified
 * Dietz, which weights a deposit by how much of the month it was present: that
 * lets paying money in move a percentage with no trade behind it, and a deposit
 * is capital to work with rather than a result.
 *
 * Returns a Map keyed YYYY-MM. A month whose starting value works out to zero
 * or less carries a null percentage: there was no capital to measure against,
 * and a number there would be arithmetic rather than a return.
 */
export function monthlyAccountReturns(positions, account, flows = [], today = todayStr()) {
  const dates = [];
  for (const position of positions) {
    if (position.open) dates.push(position.open);
    if (position.close) dates.push(position.close);
  }
  for (const flow of flows) if (flow?.date) dates.push(flow.date);
  const out = new Map();
  if (!dates.length) return out;

  const earliest = dates.reduce((a, b) => (a < b ? a : b)).slice(0, 7);
  const keys = monthRange(earliest, today.slice(0, 7));
  const pnlByMonth = monthPnl(positions);

  /**
   * The money the account was built from, which is not a deposit into it.
   *
   * The chain subtracts each month's flows to find what the account opened
   * with, and for every month of a running account that is exactly right. It
   * breaks on the month the account was founded: there was nothing before the
   * founding transfer, so taking it out leaves whatever rounding residue
   * happens to be there and the month divides by it. On the demo book, opened
   * with $42,000 on 5 January against a first trade on the 6th, January opened
   * at $289 and reported 2,548%.
   *
   * Money paid in before the first trade is starting capital and stays in the
   * base. Everything after it is a contribution and comes out, which is the
   * neutrality that matters — it is the only kind of deposit an account that is
   * already running can receive. See periodPnl, which draws the same line.
   */
  const firstTrade = positions.reduce(
    (soonest, p) => (p.open && (soonest == null || p.open < soonest) ? p.open : soonest),
    null,
  );
  const isFounding = (f) => firstTrade != null && f.date <= firstTrade;

  // Newest first, because the only value actually known is today's.
  let closing = account;
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    const { pnl, marked } = pnlByMonth.get(key) ?? { pnl: 0, marked: 0 };
    const inMonth = flows.filter((f) => f?.date?.slice(0, 7) === key);
    const net = inMonth.reduce((sum, f) => sum + f.amount, 0);
    const founding = inMonth.reduce((sum, f) => (isFounding(f) ? sum + f.amount : sum), 0);
    /**
     * Two numbers, because they answer two questions.
     *
     * `opening` is what the account was actually worth on the first of the
     * month, and it is what the card says out loud — so it has every flow taken
     * out of it, founding capital included. On the month an account is opened
     * that is a near-nothing, and truthfully so.
     *
     * `base` is the capital the month's trading ran on, which is what a return
     * is measured against. They are the same number for every month of a
     * running account and differ only where the account was founded.
     */
    const opening = closing - pnl - net;
    const base = opening + founding;
    const { first, last } = monthBounds(key);
    // The month still running is measured to today, not to a date in the future.
    const to = last > today ? today : last;

    out.set(key, {
      /**
       * The month's profit over what the account was worth when it opened.
       *
       * This was Modified Dietz, which weights each deposit by how much of the
       * month it was present and so divides by the average capital at work.
       * That is the right answer to "what did my money make" — and the wrong
       * one here, because it means paying money in changes the percentage
       * without a single trade changing. A $25,000 transfer moved a month from
       * 1.79% to 1.47% on the demo book.
       *
       * A deposit is capital to work with, not a result, so it is kept out of
       * the base entirely: the same trades report the same percentage whether
       * money arrived that month or not. `net` is still returned, and the card
       * still says what moved, so nothing is hidden — only kept out of the
       * number it would otherwise distort.
       */
      pct: base > 0 ? (pnl / base) * 100 : null,
      pnl,
      opening,
      /** What the percentage was measured against; differs from `opening` only where the account was founded. */
      base,
      /** Capital the account was opened with, rather than paid into a running one. */
      founding,
      closing,
      net,
      /** Positions opened this month and still held, marked at today's price. */
      marked,
      from: first,
      to,
    });
    closing = opening;
  }
  return out;
}

/**
 * Sorting for the open-positions lists. Returns a new array.
 * The daily sorts are direction-aware by construction: dailyDollar() already
 * flips the sign for shorts, so a short whose stock fell ranks as a winner.
 */
export function sortPositions(list, sortKey) {
  const arr = [...list];
  switch (sortKey) {
    case 'size':
      return arr.sort((a, b) => Math.abs(curValOf(b)) - Math.abs(curValOf(a)));
    case 'dUp':
      return arr.sort((a, b) => (dailyDollar(b) ?? -Infinity) - (dailyDollar(a) ?? -Infinity));
    case 'dDown':
      return arr.sort((a, b) => (dailyDollar(a) ?? Infinity) - (dailyDollar(b) ?? Infinity));
    case 'pnl':
    default:
      return arr.sort((a, b) => unreal(b) - unreal(a));
  }
}

/**
 * Account totals for the whole book.
 *
 * Net liquidation value = equity value of open positions + cash.
 * Realised P&L is deliberately NOT added: closing a trade already paid its
 * proceeds into cash, so adding it again would double-count.
 */
export function accountTotals(positions, cash) {
  const open = positions.filter((p) => p.status === 'Open');
  const closed = positions.filter((p) => p.status === 'Closed');
  const unrealised = open.reduce((sum, p) => sum + unreal(p), 0);
  const realised = closed.reduce((sum, p) => sum + realized(p), 0);
  const invested = open.reduce((sum, p) => sum + costOf(p), 0);
  const positionsValue = open.reduce((sum, p) => sum + posValue(p), 0);
  const account = positionsValue + cash;
  const wins = closed.filter((p) => realized(p) > 0).length;
  return {
    open,
    closed,
    unrealised,
    realised,
    total: unrealised + realised,
    invested,
    positionsValue,
    account,
    wins,
    losses: closed.length - wins,
    winRate: closed.length ? Math.round((wins / closed.length) * 100) : 0,
  };
}

/**
 * How the account is split across sectors, largest first.
 *
 * Cash is included as a wedge of its own. The question the chart answers is
 * "where is my money", and idle cash is a real answer to that — a book that is
 * 40% cash is positioned very differently from one that is fully invested, and
 * a chart of only the invested part hides that entirely.
 *
 * Shorts contribute their absolute size: a short is exposure to a sector, not
 * negative space in a pie, and a negative wedge cannot be drawn.
 */
/**
 * What the account made over a window, and the return that implies.
 *
 * The account curve cannot answer this, for two reasons. It began the day the
 * app was first opened, so a year of trades entered afterwards moves it not at
 * all. And it measures the change in account value, which cannot tell profit
 * from a deposit — money paid in looked exactly like a spectacular week, and on
 * this book reported 2,450 of funding as though it had been earned.
 *
 * Counted from the trades themselves instead:
 *
 *   - every trade closed inside the window contributes what it banked
 *   - every position opened inside it contributes what it is up or down by
 *   - a position already held when the window opened contributes only the move
 *     since, which needs its price on that date
 *
 * That last one is why `startPrices` exists. Without a price for a holding that
 * predates the window, none of its gain can honestly be assigned to it, so it
 * is left out and reported in `carried` — better an understated return than one
 * silently crediting this month with last year's work.
 *
 * `from` omitted means the whole life of the account, where this necessarily
 * equals realised plus unrealised.
 *
 * The starting equity is the account today less what the window added, and the
 * return is measured against that. It is money-weighted: it answers "what did
 * this account make", not "how well timed were the deposits".
 */
export function periodPnl(positions, account, from = null, startPrices = new Map(), flows = []) {
  let pnl = 0;
  let carried = 0;

  for (const p of positions) {
    if (p.status === 'Closed') {
      // Booked inside the window, whenever it was opened.
      if (!from || (p.close && p.close >= from)) pnl += realized(p);
      continue;
    }

    if (!from || (p.open && p.open >= from)) {
      pnl += unreal(p);
      continue;
    }

    // Held before the window opened: only the move inside it belongs here.
    const startPrice = startPrices.get(p.ticker);
    if (startPrice > 0) {
      const move = (p.cur - startPrice) * p.qty;
      pnl += p.dir === 'Short' ? -move : move;
    } else {
      carried += 1;
    }
  }

  /**
   * What the account was worth when the window opened.
   *
   *   opening = today  −  what was earned since  −  what was paid in since
   *
   * That last term is the one that was missing, and leaving it out is what let
   * a deposit change a return. Money paid in during the window is inside
   * `account` and is not inside `pnl`, so without subtracting it the opening
   * balance is overstated by the whole deposit and the return is divided by a
   * base that did not exist. On the demo book a $25,000 transfer took the
   * year-to-date figure from 20.35% to 13.85% without a single trade changing.
   *
   * With it out, the same trades produce the same percentage whether money was
   * paid in or not — which is the point. A deposit is capital to work with, not
   * a result.
   */
  /**
   * The one deposit that is not a deposit: the money the account opened with.
   *
   * Taking every flow out of the base assumes there was a base to begin with.
   * An account funded inside the window did not have one — it started at
   * nothing — so subtracting its founding transfer leaves whatever rounding
   * residue happens to be lying around, and the year is divided by that. On the
   * demo book, which opens with a $42,000 transfer on 5 January, the base came
   * out at $289 and the year read 3,752%.
   *
   * Money paid in before the first trade is what the account was built from,
   * not a contribution to a running account, so it stays in the base. Every
   * flow after trading has begun is a contribution and comes out — which is the
   * neutrality that matters, because that is the only kind of deposit an
   * account that is already running can receive.
   */
  const firstTrade = positions.reduce(
    (earliest, p) => (p.open && (earliest == null || p.open < earliest) ? p.open : earliest),
    null,
  );

  const paidIn = (flows ?? []).reduce((sum, f) => {
    if (!f?.date || !Number.isFinite(f.amount)) return sum;
    if (from && f.date < from) return sum;
    // Founding capital: paid in before there was anything to add to.
    if (firstTrade && f.date <= firstTrade) return sum;
    return sum + f.amount;
  }, 0);

  const startEquity = account - pnl - paidIn;
  return {
    pnl,
    startEquity,
    /** Net paid in or taken out inside the window, for whoever needs to say so. */
    externalFlow: paidIn,
    /** Null when the starting equity is not a sensible base to divide by. */
    returnPct: startEquity > 0 ? (pnl / startEquity) * 100 : null,
    /** Holdings predating the window, left out for want of a price at its start. */
    carried,
  };
}

/**
 * Modified Dietz used to live here, alongside a helper that worked an opening
 * balance backwards for it. Both are gone.
 *
 * Dietz weights each deposit by the fraction of the window it was present, which
 * answers "what did my money earn" — a fair question, and not the one this app
 * asks. Its consequence was that paying money in moved every percentage on the
 * page on a day nothing was traded. Returns here are profit over the balance the
 * window opened with, so a deposit is out of both halves and cannot be seen.
 *
 * See tests/deposit-neutrality.test.mjs, which asserts that across every figure.
 */

/**
 * Chain the broker's own return with the days since they wrote it.
 *
 *   1 + R = (1 + R_broker) * (1 + R_since)
 *
 * This is what a time-weighted return is: the compound of the sub-period
 * returns, each measured on the capital actually at work in it, so that money
 * arriving or leaving between them changes nothing. That property is the whole
 * reason it is the industry's measure and the one a broker reports.
 *
 * It matters here because a journal cannot compute one itself. A true
 * time-weighted return needs the account valued on every day money moved, and
 * this app only knows what it was worth on the days it happened to be open.
 * The broker did value it daily — and printed the answer on the statement. So
 * the long stretch is taken from them, and only the stub since their closing
 * date is measured here.
 *
 * The stub is profit over the balance the statement closed on, and deliberately
 * not Modified Dietz. Dietz would weight a deposit into that base, so money paid
 * in last week would move the reported year on a day nothing was traded — and it
 * did, by nearly a point on a $10,000 deposit. A deposit is capital, not a
 * result; it is out of the base entirely, which also makes the stub's date
 * irrelevant and the whole figure stable between statements.
 *
 * Null when the stub cannot be measured, so the caller falls back rather than
 * reporting a figure resting on a base it does not have.
 */
function chainedFromBroker({ account, openingNav, flows, to }) {
  const { twr, through, throughValue } = openingNav;
  if (twr == null || !through || !(throughValue > 0) || through > to) return null;

  const since = flows.filter((f) => f.date > through && f.date <= to);
  const net = since.reduce((sum, f) => sum + f.amount, 0);
  const stubPnl = account - throughValue - net;
  // A statement that closes today has no stub, and the broker's figure stands
  // on its own.
  const stub = through === to ? 0 : (stubPnl / throughValue) * 100;
  if (stub == null || !Number.isFinite(stub)) return null;

  return ((1 + twr / 100) * (1 + stub / 100) - 1) * 100;
}

/**
 * How the account did over a window, by the best method the data supports.
 *
 * Three ways of answering, in descending order of how much is actually known.
 *
 * Best is when the statement carried the broker's own time-weighted return.
 * That is the number their app shows, it is computed from daily valuations this
 * app has never seen, and it is chainable — so it is used for the stretch it
 * covers and this app measures only the days since.
 *
 * Failing that, a statement still anchors what the account was worth when the
 * window opened, and the whole thing falls out of the balance sheet: profit is
 * what the account is worth now, less what it was worth then, less the money
 * paid in between — which captures dividends, fees and holdings carried in from
 * earlier years without needing to know anything about them individually. The
 * return is then that profit over the stated opening balance. It reads above
 * the broker on an account whose capital grew during the year, because it
 * credits the whole year's profit to the money that started it — the price of
 * being a figure a deposit cannot move.
 *
 * Failing even that, it adds up the trades and assumes no money moved. That is
 * the honest best guess from a journal alone, and it understates whenever money
 * was in fact paid in.
 *
 * `method` says which happened, because the three are not the same claim and a
 * reader deserves to know which they are looking at.
 */
export function accountPerformance({
  positions, account, from, to, flows = [], openingNav = null, startPrices = new Map(),
}) {
  const anchored = openingNav && from && openingNav.date === from && openingNav.value > 0;

  if (anchored) {
    const net = flows.reduce((sum, f) => (
      (f.date >= from && f.date <= to) ? sum + f.amount : sum
    ), 0);
    const pnl = account - openingNav.value - net;
    const chained = chainedFromBroker({ account, openingNav, flows, to });

    return {
      pnl,
      startEquity: openingNav.value,
      /**
       * The broker's own chained figure when they gave us one; otherwise the
       * period's profit over the balance it opened with.
       *
       * That fallback was Modified Dietz, which adds each deposit to the base
       * in proportion to how long it was present. Correct as a money-weighted
       * return, and wrong for this app's rule: it let paying money in change
       * the percentage on its own. The opening balance already excludes every
       * later deposit, and `pnl` already excludes them too, so dividing one by
       * the other is deposit-neutral by construction.
       */
      returnPct: chained ?? (openingNav.value > 0 ? (pnl / openingNav.value) * 100 : null),
      carried: 0,
      method: chained == null ? 'statement' : 'broker',
      /** The broker's own figure and the day it runs to, for the tooltip. */
      brokerTwr: chained == null ? null : openingNav.twr,
      brokerThrough: chained == null ? null : openingNav.through,
    };
  }

  // Flows go through so the deposit can be taken back out of the opening
  // balance; without them the return is divided by a base that never existed.
  return { ...periodPnl(positions, account, from, startPrices, flows), method: 'trades' };
}

/** The calendar year, which is the window the overview reports against. */
export function yearToDatePnl(positions, account, startPrices = new Map(), now = new Date(), flows = []) {
  return periodPnl(positions, account, `${now.getFullYear()}-01-01`, startPrices, flows);
}

export function sectorBreakdown(positions, cash = 0) {
  const buckets = new Map();

  positions.filter((p) => p.status === 'Open').forEach((p) => {
    const name = sectorOf(p);
    const bucket = buckets.get(name) ?? { name, value: 0, holdings: [], colour: sectorColour(name) };
    bucket.value += Math.abs(posValue(p));
    bucket.holdings.push(p.ticker);
    buckets.set(name, bucket);
  });

  const rows = [...buckets.values()].sort((a, b) => b.value - a.value);
  if (cash > 0) {
    rows.push({ name: 'Cash', value: cash, holdings: [], colour: CASH_COLOUR, isCash: true });
  }

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return rows.map((r) => ({ ...r, pct: total ? (r.value / total) * 100 : 0 }));
}

/**
 * The portfolio's move today.
 *   dollars = what the shares still held moved today
 *           + what the shares SOLD today moved before they were sold
 *   percent = dollars / YESTERDAY's NLV (today's NLV minus today's P&L)
 */
export function dailyPortfolioMove(positions, account, today = todayStr()) {
  const open = positions.filter((p) => p.status === 'Open');
  const quoted = open.filter((p) => dailyDollar(p, today) != null);
  const held = quoted.reduce((sum, p) => sum + dailyDollar(p, today), 0);
  const sold = positions.reduce((sum, p) => sum + dailyDollarExits(p, today), 0);
  const dollars = held + sold;
  const prevNLV = account - dollars;
  return {
    dollars,
    sold,
    percent: prevNLV > 0 ? (dollars / prevNLV) * 100 : 0,
    hasData: quoted.length > 0 || sold !== 0,
    pending: open.length - quoted.length,
  };
}
