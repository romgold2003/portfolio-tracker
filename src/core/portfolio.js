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
 * Size-weighted portfolio beta.
 *
 * Each position contributes in proportion to its exposure, and a short
 * contributes negatively: being short a high-beta name reduces how much the
 * book moves with the market.
 *
 * `measured` maps a ticker to a beta computed from real returns. Anything
 * missing falls back to the published assumption, so the figure degrades from
 * measured to estimated one position at a time rather than all at once.
 */
export function portfolioBeta(open, measured = new Map()) {
  let weighted = 0;
  let total = 0;
  let measuredWeight = 0;

  open.forEach((p) => {
    const w = Math.abs(curValOf(p));
    const sign = p.dir === 'Long' ? 1 : -1;
    const real = measured.get(p.ticker.toUpperCase());
    const beta = Number.isFinite(real) ? real : betaOf(p.ticker, p.cls);
    if (Number.isFinite(real)) measuredWeight += w;
    weighted += beta * w * sign;
    total += w;
  });

  if (!total) return null;
  return {
    beta: weighted / total,
    /** Share of the book whose beta was measured rather than assumed. */
    measuredPct: (measuredWeight / total) * 100,
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
export function periodPnl(positions, account, from = null, startPrices = new Map()) {
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

  const startEquity = account - pnl;
  return {
    pnl,
    startEquity,
    /** Null when the starting equity is not a sensible base to divide by. */
    returnPct: startEquity > 0 ? (pnl / startEquity) * 100 : null,
    /** Holdings predating the window, left out for want of a price at its start. */
    carried,
  };
}

/** The calendar year, which is the window the overview reports against. */
export function yearToDatePnl(positions, account, startPrices = new Map(), now = new Date()) {
  return periodPnl(positions, account, `${now.getFullYear()}-01-01`, startPrices);
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
