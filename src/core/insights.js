/**
 * Insights, the personal analyst (November 2026): what a person's own trades
 * and account say about them, explained the way a friendly analyst would —
 * what we found, why it matters, the numbers behind it — and how each figure
 * is calculated, for anyone who wants to check.
 *
 * Observations about the past, never advice about what to buy or sell (the
 * Terms are explicit that nothing in Riskbook is advice). Worked out here, on
 * the device; nothing about the person is sent anywhere. The market side
 * (S&P 500 total return, Fear & Greed, big-news days, each stock's closes) is
 * the same public data for everyone.
 *
 * Two rules keep it honest:
 *  - Enough evidence. A comparison needs MIN_GROUP on each side, and anything
 *    about the trades MIN_TRADES closed trades. Until then the card says how
 *    many more it needs instead of drawing a conclusion.
 *  - Better than chance. A difference is checked against the same values
 *    dealt at random (a permutation test): under 5% "Clear pattern", under
 *    20% "Likely pattern", otherwise "Early sign". Only the first two are ever
 *    called a strength or an area to improve.
 *
 * "Why" is measured, not guessed: each trade carries its context (the S&P's
 * five days before entry, the stock's own two weeks before, the market's mood,
 * big-news days, size, holding time, state of mind) and a pattern's cause is
 * the context its trades share far more often than the rest.
 *
 * All amounts are in the account's currency (dollars); the journal holds one.
 */
import { realized, costOf, outcomeOf, marketValueOf, unreal } from './portfolio.js';
import { cleanMind } from './mind.js';
import { sectorOf } from '../config/sectors.js';
import { dayGrowth, measurable, monthlyReturns } from './portfolioHistory.js';

export const MIN_GROUP = 8;
export const MIN_TRADES = 10;
const SHUFFLES = 2000;
const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ── dates and numbers ── */

const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => isoOf(ms(d) + n * DAY);
export function mondayOf(d) {
  const t = new Date(ms(d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
const shortDate = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const longDate = (d) => `${shortDate(d)} ${d.slice(0, 4)}`;
const monthName = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
};
const winRate = (ts) => {
  const decided = ts.filter((t) => t.outcome !== 'even');
  return decided.length ? (decided.filter((t) => t.outcome === 'win').length / decided.length) * 100 : 0;
};
const share = (part, whole) => (whole ? (part / whole) * 100 : 0);

const pct = (n, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`;
const plainPct = (n, digits = 1) => `${Math.abs(n).toFixed(digits)}%`;
const usd = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const plain$ = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const ids = (ts) => ts.map((t) => t.id);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/* ── the statistics ── */

/** A small, seeded generator, so the same trades always give the same answer. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How often a gap this large between two groups' averages appears when the
 * same values are dealt into two groups of the same sizes at random.
 */
export function chanceOf(a, b, shuffles = SHUFFLES) {
  if (!a.length || !b.length) return 1;
  const observed = Math.abs(mean(a) - mean(b));
  const pool = [...a, ...b];
  const random = seeded(pool.length * 7919 + Math.round(observed * 1000));
  let asLarge = 0;
  for (let s = 0; s < shuffles; s++) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (Math.abs(mean(pool.slice(0, a.length)) - mean(pool.slice(a.length))) >= observed - 1e-12) asLarge += 1;
  }
  return asLarge / shuffles;
}

/**
 * How often an average this far from zero appears when each value's sign is
 * a coin toss: "is beating the S&P by 2 points a trade more than luck?"
 */
export function chanceVsZero(xs, shuffles = SHUFFLES) {
  if (!xs.length) return 1;
  const observed = Math.abs(mean(xs));
  const random = seeded(xs.length * 104729 + Math.round(observed * 1000));
  let asLarge = 0;
  for (let s = 0; s < shuffles; s++) {
    let total = 0;
    for (const x of xs) total += random() < 0.5 ? -x : x;
    if (Math.abs(total / xs.length) >= observed - 1e-12) asLarge += 1;
  }
  return asLarge / shuffles;
}

const levelOf = (p) => (p < 0.05 ? 'strong' : p < 0.2 ? 'likely' : 'possible');

/** Strong, likely or possible, from the chance; "early" while either side is short. */
export function confidence(a, b, values = (t) => t.ret) {
  const short = Math.max(0, MIN_GROUP - a.length) + Math.max(0, MIN_GROUP - b.length);
  if (short > 0) return { level: 'early', needed: short };
  const p = chanceOf(a.map(values), b.map(values));
  return { level: levelOf(p), chance: p };
}

/** The same for one set of values against zero. */
export function confidenceOne(xs) {
  if (xs.length < MIN_GROUP) return { level: 'early', needed: MIN_GROUP - xs.length };
  const p = chanceVsZero(xs);
  return { level: levelOf(p), chance: p };
}

/** A fact (no test needed) or a pattern unlikely to be chance. */
const solid = (c) => !c || c.level === 'strong' || c.level === 'likely';

/* ── the market ── */

/**
 * The S&P 500 as a total-return index: each close over the one before, the
 * dividend added back on its ex-date (the same measure as the YTD comparison
 * on Home). Levels start at 100; `daily` is each day's move in per cent.
 */
export function indexLevels(rows) {
  const dates = [];
  const level = [];
  const daily = new Map();
  let lv = 100;
  let prev = null;
  for (const r of rows ?? []) {
    if (!r?.date || !(r.close > 0)) continue;
    if (prev != null) {
      const g = (r.close + (Number(r.div) || 0)) / prev;
      lv *= g;
      daily.set(r.date, (g - 1) * 100);
    }
    dates.push(r.date);
    level.push(lv);
    prev = r.close;
  }
  return { dates, level, daily };
}

/** The position of the last date on or before `date`, or −1. */
function at(dates, date) {
  let lo = 0;
  let hi = dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** The index level at the last close on or before `date`; null before the series begins. */
export function levelOn(ix, date) {
  const i = at(ix.dates, date);
  return i >= 0 ? ix.level[i] : null;
}

/** The S&P's total return from one day's close to another's, in per cent. */
export function indexBetween(ix, from, to) {
  if (!ix.dates.length || ix.dates[0] > from) return null;
  const a = levelOn(ix, from);
  const b = levelOn(ix, to);
  return a > 0 && b > 0 ? (b / a - 1) * 100 : null;
}

/** The S&P's move over the `n` trading days before `date`. */
function indexBefore(ix, date, n = 5) {
  const i = at(ix.dates, addDays(date, -1));
  return i >= n ? (ix.level[i] / ix.level[i - n] - 1) * 100 : null;
}

/**
 * The account day by day: each day's return with deposits and withdrawals
 * taken out (the same day-growth formula as Home and Monthly), the day's
 * profit, and the date of the day before, so a gap in the history is visible.
 */
export function accountDays(rows) {
  const out = [];
  for (let i = 1; i < (rows?.length ?? 0); i++) {
    const prev = rows[i - 1];
    const row = rows[i];
    if (!row?.date || !measurable(prev, row)) continue;
    const flow = Number(row.externalCashFlow) || 0;
    const g = dayGrowth(prev.totalAccountValue, row.totalAccountValue, flow, row.joinedAtClose);
    out.push({
      date: row.date,
      prevDate: prev.date,
      ret: (g - 1) * 100,
      pnl: row.totalAccountValue - (prev.totalAccountValue || 0) - flow,
      value: row.totalAccountValue,
    });
  }
  return out;
}

/**
 * Market days with the account's move and the S&P's side by side. A day only
 * counts when the account's previous value is from the market's previous
 * trading day or later: after a gap in the history, the account's move spans
 * several market days and would be compared with one.
 */
export function pairDays(days, ix) {
  return pairOf(days, ix);
}

/**
 * What the account made beyond the market's own move on these days, in money:
 * each day's return less the S&P 500's, on the value the day started from.
 * Positive: ahead of the market; negative: behind. This is what a pattern
 * costs or earns, rather than the market's move itself.
 */
export function beyondMarket(days) {
  return sum(days.map((x) => ((x.ret - x.spx) / 100) * Math.max(0, x.value - x.pnl)));
}

function pairOf(days, ix) {
  const out = [];
  for (const d of days) {
    if (!ix.daily.has(d.date)) continue;
    const i = at(ix.dates, d.date);
    if (i < 1 || d.prevDate < ix.dates[i - 1]) continue;
    out.push({ ...d, spx: ix.daily.get(d.date) });
  }
  return out;
}

/* ── the trades ── */

/**
 * A position's whole life as buys and sells, from what it keeps: the first
 * purchase (worked out from the average once the top-ups are taken out), each
 * top-up (`adds`), each sale (`exits`), and for a position closed without
 * recorded sales, one sale of everything at its exit price on its close date.
 * The same reconstruction the daily history uses (appTrades.js).
 */
export function tradeLife(p) {
  const adds = (p.adds ?? []).filter((a) => a?.d && Number(a.qty) > 0 && Number(a.price) > 0).map((a) => ({ d: a.d, qty: +a.qty, price: +a.price }));
  let sells = (p.exits ?? []).filter((e) => e?.d && Number(e.qty) > 0 && Number(e.price) > 0).map((e) => ({ d: e.d, qty: +e.qty, price: +e.price }));
  const closed = p.status === 'Closed';
  const qty = Math.abs(Number(p.qty) || 0);
  if (closed && !sells.length && p.close && p.cur > 0) sells = [{ d: p.close, qty, price: +p.cur }];
  const held = closed ? 0 : qty;
  const addedQty = sum(adds.map((a) => a.qty));
  const first = held + sum(sells.map((s) => s.qty)) - addedQty;
  const firstPrice = first > 1e-9 ? (p.entry * (first + addedQty) - sum(adds.map((a) => a.qty * a.price))) / first : 0;
  const buys = first > 1e-9 && firstPrice > 0
    ? [{ d: p.open, qty: first, price: firstPrice }, ...adds]
    : [{ d: p.open, qty: held + sum(sells.map((s) => s.qty)), price: +p.entry }];
  return { dir: p.dir === 'Short' ? -1 : 1, buys, sells, held, price: +p.cur || 0 };
}

/**
 * What the S&P 500 would have made with the same money on the same days: each
 * purchase buys the index (total return) at that day's close for what it
 * cost; each sale sells the same share of the index holding as the share of
 * the position sold. What is still held is valued at `today`. A short is
 * matched with the same money in the index, bought: the alternative to the
 * trade is simply owning the market.
 */
export function twinOfLife(life, ix, today) {
  const events = [...life.buys.map((b) => ({ ...b, buy: true })), ...life.sells]
    .sort((a, b) => a.d.localeCompare(b.d) || (b.buy ? 1 : 0) - (a.buy ? 1 : 0));
  let units = 0;
  let held = 0;
  let paid = 0;
  let back = 0;
  for (const e of events) {
    const lv = levelOn(ix, e.d);
    if (!(lv > 0) || e.d < ix.dates[0]) return null;
    if (e.buy) {
      units += (e.qty * e.price) / lv;
      paid += e.qty * e.price;
      held += e.qty;
    } else {
      const part = held > 0 ? Math.min(1, e.qty / held) : 1;
      back += units * part * lv;
      units -= units * part;
      held -= e.qty;
    }
  }
  const lvNow = units > 1e-12 ? levelOn(ix, today) : 0;
  return { pnl: back + units * (lvNow || 0) - paid, paid };
}

/** A closed trade as the analyst reads it. */
export function tradesOf(positions) {
  return (positions ?? [])
    .filter((p) => p?.status === 'Closed' && p.open && p.close && p.close >= p.open)
    .map((p) => {
      const pnl = realized(p);
      const cost = Math.abs(costOf(p));
      return {
        id: p.id,
        ticker: p.ticker,
        dir: p.dir,
        cls: p.cls,
        open: p.open,
        close: p.close,
        qty: Math.abs(Number(p.qty) || 0),
        exit: Number(p.cur) || 0,
        pnl,
        cost,
        ret: cost > 0 ? (pnl / cost) * 100 : 0,
        days: Math.max(0, Math.round((ms(p.close) - ms(p.open)) / DAY)),
        outcome: outcomeOf(pnl),
        mind: cleanMind(p.mind),
        sector: sectorOf(p),
        weekday: new Date(`${p.open}T12:00:00Z`).getUTCDay(),
        life: tradeLife(p),
      };
    })
    .sort((a, b) => a.close.localeCompare(b.close) || a.open.localeCompare(b.open));
}

/** The reading on or before a date (within five days) from a sorted [{ date, value }] list. */
function readingOn(list, dates, date) {
  const i = at(dates, date);
  return i >= 0 && ms(date) - ms(list[i].date) <= 5 * DAY ? list[i].value : null;
}

/** The dates of a stock's rows, worked out once per stock. */
const datesOf = new WeakMap();
function rowDates(rows) {
  if (!datesOf.has(rows)) datesOf.set(rows, rows.map((r) => r.date));
  return datesOf.get(rows);
}

/** A stock's close on or before a date, and its position, from its daily rows. */
function stockAt(rows, date) {
  const i = at(rowDates(rows), date);
  return i >= 0 ? { i, close: rows[i].close } : null;
}

/**
 * Each trade's context: what the S&P had done in the five days before entry,
 * what the stock itself had done in the two weeks before, the market's mood
 * (stocks only: CNN's index measures the stock market), whether it was a
 * big-news day, its size against the rest, and its S&P twin.
 */
function enrich(trades, { ix, fearGreed, newsDays, series, today }) {
  const sizes = trades.map((t) => t.cost).sort((a, b) => a - b);
  const bigFrom = sizes[Math.floor(sizes.length * 0.8)] ?? Infinity;
  const fgDates = fearGreed.map((x) => x.date);
  return trades.map((t) => {
    const twin = ix.dates.length ? twinOfLife(t.life, ix, today) : null;
    const rows = series.get(t.ticker);
    let stock10 = null;
    let dipped = null;
    if (rows?.length) {
      const before = stockAt(rows, addDays(t.open, -1));
      if (before && before.i >= 10 && rows[before.i - 10].close > 0) stock10 = (before.close / rows[before.i - 10].close - 1) * 100;
      const start = stockAt(rows, t.open);
      if (start && start.close > 0) {
        let worst = 0;
        for (let i = start.i; i < rows.length && rows[i].date <= t.close; i++) {
          worst = Math.min(worst, (rows[i].close / start.close - 1) * 100 * (t.dir === 'Short' ? -1 : 1));
        }
        dipped = worst;
      }
    }
    return {
      ...t,
      spxPnl: twin ? twin.pnl : null,
      spxRet: twin && twin.paid > 0 ? (twin.pnl / twin.paid) * 100 : null,
      spx5: indexBefore(ix, t.open),
      stock10: t.dir === 'Short' ? null : stock10,
      dipped,
      fg: fearGreed.length && t.cls !== 'Crypto' ? readingOn(fearGreed, fgDates, t.open) : null,
      news: newsDays.has(t.open),
      big: trades.length >= 5 && t.cost >= bigFrom,
    };
  });
}

/**
 * The context a group of trades shares far more often than the rest: the
 * measured "why". At least three of the group, and 20 points more often than
 * the other trades; the largest gap wins. Null when nothing stands out.
 */
const FEATURES = [
  ['spxUp', (t) => (t.spx5 != null ? t.spx5 >= 1.5 : null), 'came after the S&P 500 had risen 1.5% or more in the five days before'],
  ['spxDown', (t) => (t.spx5 != null ? t.spx5 <= -1.5 : null), 'came after the S&P 500 had fallen 1.5% or more in the five days before'],
  ['chase', (t) => (t.stock10 != null ? t.stock10 >= 10 : null), 'were bought after the stock had already risen 10% or more in two weeks'],
  ['dip', (t) => (t.stock10 != null ? t.stock10 <= -10 : null), 'were bought after the stock had fallen 10% or more in two weeks'],
  ['emotional', (t) => (t.mind != null ? t.mind <= 4 : null), 'were rated emotional or impulsive (1–4)'],
  ['fear', (t) => (t.fg != null ? t.fg < 45 : null), 'were bought while investors were fearful'],
  ['greed', (t) => (t.fg != null ? t.fg > 55 : null), 'were bought while investors were greedy'],
  ['news', (t) => t.news, 'were opened on a big-news day (Fed, inflation or jobs report)'],
  ['big', (t) => t.big, 'were among your largest fifth by size'],
  ['quick', (t) => t.days <= 2, 'were closed within two days'],
  ['long', (t) => t.days > 30, 'were held for more than a month'],
  ['short', (t) => t.dir === 'Short', 'were shorts'],
  ['crypto', (t) => t.cls === 'Crypto', 'were crypto'],
];

export function whyOf(group, rest, skip = []) {
  let best = null;
  for (const [id, test, phrase] of FEATURES) {
    if (skip.includes(id)) continue;
    const g = group.map(test).filter((v) => v != null);
    const r = rest.map(test).filter((v) => v != null);
    if (g.length < 3 || r.length < 3) continue;
    const k = g.filter(Boolean).length;
    const others = share(r.filter(Boolean).length, r.length);
    const gap = share(k, g.length) - others;
    if (k < 3 || gap < 20) continue;
    if (!best || gap > best.gap) best = { id, gap, text: `${k} of ${g.length} ${phrase}, against ${Math.round(others)}% of your other trades.` };
  }
  return best;
}

/* ── the cards ──
 *
 * Every card: { id, group, topic, headline, matters, data, cause, how, tone,
 * impact, confidence, bars, unit, table, trades }.
 *  - topic: a neutral name, shown while there is not enough data yet
 *  - headline: what we found, in plain words
 *  - matters: why it matters, one sentence
 *  - data: the numbers behind it and how many trades or days
 *  - cause: what the trades share, when something stands out
 *  - how: how it is calculated
 *  - tone: 'good' (a strength), 'bad' (an area to improve) or 'neutral'
 *  - impact: the money involved, to rank cards by what matters most
 */

/* ── the best and worst day to open a trade ── */

/**
 * Counted in wins and losses, not in per cent (November 2026): one trade held
 * for years that made 1,000% would otherwise make its weekday look like the
 * best by itself. What matters here is how often a trade opened that day
 * works out. Trades that closed flat count as neither.
 */
function weekdayTrades(trades) {
  const decided = trades.filter((t) => t.outcome !== 'even');
  const days = [1, 2, 3, 4, 5].map((d) => ({ d, ts: decided.filter((t) => t.weekday === d) }));
  const usable = days.filter((x) => x.ts.length >= 3);
  const base = {
    id: 'weekday', group: 'habits', topic: 'Your best day to open a trade',
    how: 'Out of the trades you opened on each weekday, the share that closed in profit. Only winning or losing counts, not by how much, so one very large winner cannot make a day look good on its own. Trades that closed flat are left out. The day with the lowest share is compared with all your other days and checked against chance.',
  };
  if (usable.length < 2) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: Math.max(1, MIN_TRADES - trades.length, 3 - usable.length) } };
  const won = (x) => x.ts.filter((t) => t.outcome === 'win').length;
  const rate = (x) => (won(x) / x.ts.length) * 100;
  // A tie goes to the day with more trades behind it.
  const worst = usable.reduce((a, b) => (rate(b) < rate(a) || (rate(b) === rate(a) && b.ts.length > a.ts.length) ? b : a));
  const best = usable.reduce((a, b) => (rate(b) > rate(a) || (rate(b) === rate(a) && b.ts.length > a.ts.length) ? b : a));
  const rest = decided.filter((t) => t.weekday !== worst.d);
  const why = whyOf(worst.ts, rest);
  const total = sum(worst.ts.map((t) => t.pnl));
  const line = (x) => `${WEEKDAYS[x.d]}: ${won(x)} of ${x.ts.length} won (${Math.round(rate(x))}%)`;
  return {
    ...base,
    headline: `Trades you open on ${WEEKDAYS[best.d]}s win most often; ${WEEKDAYS[worst.d]}s win least`,
    matters: rate(worst) < 50
      ? `Most trades you open on ${WEEKDAYS[worst.d]}s end in a loss. This pattern may be costing you performance.`
      : `Even your ${WEEKDAYS[worst.d]} trades win more often than not, just less than on other days.`,
    data: `${line(best)}. ${line(worst)}. Based on ${plural(decided.length, 'trade')}.`,
    more: `Your ${WEEKDAYS[worst.d]} trades added up to ${usd(total)}.`,
    cause: why ? `Your ${WEEKDAYS[worst.d]} trades: ${why.text}` : null,
    tone: rate(worst) < 50 ? 'bad' : 'neutral',
    impact: Math.abs(total),
    confidence: confidence(worst.ts, rest, (t) => (t.outcome === 'win' ? 1 : 0)),
    bars: days.map((x) => [WEEKDAYS[x.d].slice(0, 3), x.ts.length ? rate(x) : 0]),
    unit: 'rate',
    trades: ids(worst.ts),
  };
}

/* ── the account by weekday ── */

function accountWeekdays(paired) {
  const base = {
    id: 'account-weekday', group: 'deeper', topic: 'Your account by day of the week',
    how: 'Your account\'s daily return (deposits and withdrawals taken out), averaged by weekday over the market days we can measure, beside the S&P 500\'s average on the same days.',
  };
  if (paired.length < 40) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: Math.ceil((40 - paired.length) / 5) * 5, unit: 'market days' } };
  const days = [1, 2, 3, 4, 5].map((d) => {
    const ds = paired.filter((x) => new Date(`${x.date}T12:00:00Z`).getUTCDay() === d);
    return { d, ds, you: mean(ds.map((x) => x.ret)), spx: mean(ds.map((x) => x.spx)) };
  }).filter((x) => x.ds.length);
  const worst = days.reduce((a, b) => (b.you < a.you ? b : a));
  const best = days.reduce((a, b) => (b.you > a.you ? b : a));
  const rest = paired.filter((x) => !worst.ds.includes(x));
  const marketToo = days.reduce((a, b) => (b.spx < a.spx ? b : a)).d === worst.d;
  const total = sum(worst.ds.map((x) => x.pnl));
  const extra = beyondMarket(worst.ds);
  return {
    ...base,
    headline: `Your account tends to do best on ${WEEKDAYS[best.d]}s and worst on ${WEEKDAYS[worst.d]}s`,
    matters: marketToo
      ? `The market is weakest on ${WEEKDAYS[worst.d]}s too, so this is mostly the market, not your choices.`
      : `The market itself is not weak on ${WEEKDAYS[worst.d]}s, so the difference comes from what you hold.`,
    data: `${WEEKDAYS[best.d]}: ${pct(best.you, 2)} a day. ${WEEKDAYS[worst.d]}: ${pct(worst.you, 2)} a day. Based on ${plural(paired.length, 'market day')}.`,
    more: `The S&P 500 averaged ${pct(worst.spx, 2)} on ${WEEKDAYS[worst.d]}s over the same days. Your ${WEEKDAYS[worst.d]}s added up to ${usd(total)}.`,
    tone: worst.you < 0 && !marketToo ? 'bad' : 'neutral',
    impact: Math.abs(extra),
    confidence: confidence(worst.ds, rest, (x) => x.ret),
    bars: days.map((x) => [WEEKDAYS[x.d].slice(0, 3), x.you]),
    unit: 'pct2',
  };
}

/* ── big-news days ── */

function bigNewsDays(paired, bigDays) {
  const kinds = new Map();
  for (const b of bigDays ?? []) {
    if (b?.date) kinds.set(b.date, [...(kinds.get(b.date) ?? []), b.kind]);
  }
  const news = paired.filter((x) => kinds.has(x.date));
  const other = paired.filter((x) => !kinds.has(x.date));
  const base = {
    id: 'news', group: 'deeper', topic: 'Big economic news and your account',
    how: 'The average size of your account\'s daily move (up or down) on days with a Fed decision, an inflation (CPI) report or a jobs report, against all other days, and against the S&P 500\'s move on the same news days.',
  };
  if (news.length < MIN_GROUP || other.length < MIN_GROUP) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: Math.max(1, MIN_GROUP - news.length), unit: 'news days' } };
  const swing = (xs, k = 'ret') => mean(xs.map((x) => Math.abs(x[k])));
  const youNews = swing(news);
  const youOther = swing(other);
  const spxNews = swing(news, 'spx');
  const ratio = spxNews > 0 ? youNews / spxNews : 1;
  const byKind = ['Fed decision', 'CPI', 'Jobs report'].map((k) => {
    const ds = news.filter((x) => kinds.get(x.date).includes(k));
    return [k === 'CPI' ? 'Inflation (CPI)' : k, ds.length ? mean(ds.map((x) => Math.abs(x.ret))) : 0, ds.length];
  }).filter(([, , n]) => n);
  const total = sum(news.map((x) => x.pnl));
  const extra = beyondMarket(news);
  return {
    ...base,
    headline: ratio > 1.3 ? 'Big economic news moves your account more than the market'
      : ratio < 0.8 ? 'Your account stays calmer than the market on big news days'
        : 'On big news days your account moves about as much as the market',
    matters: 'Fed decisions, inflation reports and jobs reports are the days markets tend to move most.',
    data: `On news days your account moved ${plainPct(youNews, 2)} on average (up or down), the S&P 500 ${plainPct(spxNews, 2)}. Based on ${plural(news.length, 'news day')}.`,
    more: `On other days your account moved ${plainPct(youOther, 2)}. The news days added up to ${usd(total)}.`,
    tone: ratio > 1.3 ? 'bad' : ratio < 0.8 ? 'good' : 'neutral',
    impact: Math.abs(extra),
    confidence: confidence(news, other, (x) => Math.abs(x.ret)),
    bars: byKind.map(([k, v]) => [k, v]),
    unit: 'move',
  };
}

/* ── the weeks against the S&P ── */

function weeksOf(paired) {
  const map = new Map();
  for (const x of paired) {
    const k = mondayOf(x.date);
    const w = map.get(k) ?? { from: k, you: 1, spx: 1, pnl: 0 };
    w.you *= 1 + x.ret / 100;
    w.spx *= 1 + x.spx / 100;
    w.pnl += x.pnl;
    map.set(k, w);
  }
  return [...map.values()].map((w) => ({ ...w, you: (w.you - 1) * 100, spx: (w.spx - 1) * 100 }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

function lastWeek(weeks, trades, today) {
  const thisMonday = mondayOf(today);
  const done = weeks.filter((w) => w.from < thisMonday);
  const last = done[done.length - 1];
  if (!last || last.from !== addDays(thisMonday, -7)) return null;
  const gap = last.you - last.spx;
  const ahead = gap >= 0;
  let streak = 0;
  for (let i = done.length - 1; i >= 0 && (done[i].you >= done[i].spx) === ahead; i--) streak += 1;
  const closed = trades.filter((t) => t.close >= last.from && t.close <= addDays(last.from, 6));
  const aheadWeeks = done.filter((w) => w.you >= w.spx).length;
  return {
    id: 'week',
    group: 'deeper',
    topic: 'Last week',
    headline: Math.abs(gap) < 0.5 ? 'Last week you and the market moved about the same'
      : ahead ? 'Last week you did better than the market' : 'Last week the market did a little better than you',
    matters: 'One week says little on its own; what counts is how often you are ahead over many weeks.',
    data: `You ${pct(last.you, 2)}, S&P 500 ${pct(last.spx, 2)}. Ahead in ${aheadWeeks} of ${plural(done.length, 'week')} measured.`,
    more: `${streak > 1 ? `${streak} weeks in a row ${ahead ? 'ahead' : 'behind'}. ` : ''}${closed.length ? `${plural(closed.length, 'trade')} closed last week, ${usd(sum(closed.map((t) => t.pnl)))}.` : 'No trade closed last week.'}`,
    how: 'Each week runs Monday to Friday: your daily returns (deposits taken out) compounded, against the S&P 500\'s total return over the same market days.',
    tone: 'neutral',
    impact: 0,
    bars: done.slice(-8).map((w) => [`w/c ${shortDate(w.from)}`, w.you - w.spx]),
    unit: 'pts',
  };
}

/* ── the months against the S&P ── */

function monthsVsIndex(history, ix, today) {
  const rows = [];
  for (const [key, m] of monthlyReturns(history)) {
    if (m.partial) continue;
    const endOfMonth = isoOf(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0));
    const spx = indexBetween(ix, addDays(`${key}-01`, -1), endOfMonth < today ? endOfMonth : today);
    if (spx == null) continue;
    rows.push({ key, label: monthName(key), you: m.returnPct, spx, live: endOfMonth >= today });
  }
  const last12 = rows.slice(-12);
  const decided = last12.filter((r) => !r.live);
  const base = {
    id: 'months', group: 'deeper', topic: 'Your months against the market',
    how: 'Each month\'s return is your account valued every day, deposits and withdrawals taken out, the days compounded (the same figure as the Monthly page). The S&P 500 is its total return, dividends included, from the last close of the month before to the month\'s last close. The month in progress is shown but not counted.',
  };
  if (decided.length < 3) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: 3 - decided.length, unit: 'months' } };
  const won = decided.filter((r) => r.you >= r.spx).length;
  const gap = mean(decided.map((r) => r.you - r.spx));
  return {
    ...base,
    headline: `You beat the market in ${won} of the last ${plural(decided.length, 'month')}`,
    matters: won > decided.length / 2
      ? 'Beating the market more often than not is something most investors do not manage.'
      : 'In most months, simply holding the S&P 500 would have done a little better.',
    data: `On average you were ${gap >= 0 ? 'ahead' : 'behind'} by ${Math.abs(gap).toFixed(1)} points a month.`,
    tone: won > decided.length / 2 ? 'good' : 'neutral',
    impact: 0,
    table: [...last12].reverse(),
  };
}

/* ── the S&P twin ── */

/**
 * The whole account beside a twin that put every dollar into the S&P 500
 * (total return) instead: the same starting value, every deposit and
 * withdrawal on the same day.
 */
export function twinSeries(rows, ix, from = null) {
  if (!rows?.length || !ix.dates.length) return [];
  let start = 0;
  if (from) {
    let before = -1;
    rows.forEach((r, i) => { if (r.date < from) before = i; });
    start = before >= 0 ? before : rows.findIndex((r) => r.date >= from);
    if (start < 0) return [];
  }
  const out = [];
  let units = null;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (r.date < ix.dates[0]) continue;
    const lv = levelOn(ix, r.date);
    if (!(lv > 0)) continue;
    if (units == null) {
      if (!(r.totalAccountValue > 0)) continue;
      units = r.totalAccountValue / lv;
    } else {
      units += (Number(r.externalCashFlow) || 0) / lv;
    }
    out.push({ date: r.date, you: r.totalAccountValue, twin: Math.max(0, units * lv) });
  }
  return out;
}

/**
 * Both sides marked every market day. A trade's profit while held is its
 * shares at the stock's close (scaled to the trade's own prices, so the line
 * ends exactly on the profit made) plus what its sales brought in, less what
 * it cost; its twin is the S&P holding it bought, valued the same way. A
 * stock whose closes could not be loaded counts its final figure from the day
 * it closed (or today, still open).
 */
export function twinDaily(items, ix, prices, from, today) {
  if (!items.length) return [];
  const first = items.map((r) => r.life.buys[0].d).sort()[0];
  const start = from && from > first ? from : addDays(first, -1);
  const dates = ix.dates.slice(Math.max(0, at(ix.dates, start))).filter((d) => d <= today);
  if (!dates.length || dates[dates.length - 1] < today) dates.push(today);
  const you = new Array(dates.length).fill(0);
  const twin = new Array(dates.length).fill(0);
  for (const r of items) {
    const { life } = r;
    const events = [...life.buys.map((b) => ({ ...b, buy: true })), ...life.sells]
      .sort((a, b) => a.d.localeCompare(b.d) || (b.buy ? 1 : 0) - (a.buy ? 1 : 0));
    const end = r.live ? today : life.sells[life.sells.length - 1]?.d ?? r.close;
    const s = prices?.get(r.ticker);
    const lastOwn = r.live ? life.price : life.sells[life.sells.length - 1]?.price;
    const k = s?.length ? at(rowDates(s), end) : -1;
    const scale = k >= 0 && s[k].close > 0 && lastOwn > 0 ? lastOwn / s[k].close : null;
    let e = 0;
    let held = 0;
    let cash = 0;
    let units = 0;
    let back = 0;
    let paid = 0;
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      while (e < events.length && events[e].d <= d) {
        const ev = events[e++];
        const lv = levelOn(ix, ev.d) || 0;
        if (ev.buy) {
          held += ev.qty;
          cash -= ev.qty * ev.price;
          if (lv > 0) { units += (ev.qty * ev.price) / lv; paid += ev.qty * ev.price; }
        } else {
          const part = held > 0 ? Math.min(1, ev.qty / held) : 1;
          back += units * part * lv;
          units -= units * part;
          held -= ev.qty;
          cash += ev.qty * ev.price;
        }
      }
      if (d < life.buys[0].d) continue;
      if (d >= end) { you[i] += r.you; twin[i] += r.spx; continue; }
      twin[i] += back + units * (levelOn(ix, d) || 0) - paid;
      if (scale) {
        const j = at(rowDates(s), d);
        const priceD = j >= 0 ? s[j].close * scale : life.buys[0].price;
        you[i] += life.dir * (held * priceD + cash);
      }
    }
  }
  return dates.map((date, i) => ({ date, you: you[i], twin: twin[i] }));
}

/**
 * The S&P twin, trade by trade: every time you bought, the same money went
 * into the S&P 500 that day, and came out as you sold. Open positions count
 * to today. "This year" is the trades opened this year, whole, so nothing
 * from before January is mixed in. The whole-account comparison (every
 * deposit into the S&P, held) rides along as one line: it also counts cash
 * left idle and time out of the market, which the trades cannot.
 */
function twin(history, ix, trades, open, today, prices) {
  const periods = {};
  const items = [
    ...trades.filter((t) => t.spxPnl != null).map((t) => ({ id: t.id, ticker: t.ticker, life: t.life, cost: t.cost, open: t.open, close: t.close, you: t.pnl, spx: t.spxPnl, ret: t.ret, spxRet: t.spxRet, live: false })),
    ...open.filter((p) => p.spxPnl != null).map((p) => ({ id: p.id, ticker: p.ticker, life: p.life, cost: p.cost, open: p.open, close: null, you: p.pnl, spx: p.spxPnl, live: true })),
  ];
  for (const [key, from] of [['year', `${today.slice(0, 4)}-01-01`], ['all', null]]) {
    const rows = items.filter((r) => !from || r.open >= from).map((r) => ({ ...r, diff: r.you - r.spx }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    if (!rows.length) continue;
    const closed = rows.filter((r) => !r.live);
    const you = sum(rows.map((r) => r.you));
    const spx = sum(rows.map((r) => r.spx));
    const traded = sum(rows.map((r) => r.cost));
    const byDiff = [...closed].sort((a, b) => b.diff - a.diff);
    const excess = closed.filter((r) => r.spxRet != null).map((r) => r.ret - r.spxRet);
    const account = twinSeries(history, ix, from);
    const accEnd = account[account.length - 1];
    periods[key] = {
      from: from ?? null,
      series: twinDaily(rows, ix, prices, from, today),
      you,
      twin: spx,
      diff: you - spx,
      youPct: traded > 0 ? (you / traded) * 100 : null,
      twinPct: traded > 0 ? (spx / traded) * 100 : null,
      beat: closed.filter((r) => r.diff > 0).length,
      decided: closed.length,
      open: rows.length - closed.length,
      luck: confidenceOne(excess),
      best: byDiff.length && byDiff[0].diff > 0 ? { ticker: byDiff[0].ticker, diff: byDiff[0].diff } : null,
      worst: byDiff.length > 1 && byDiff[byDiff.length - 1].diff < 0 ? { ticker: byDiff[byDiff.length - 1].ticker, diff: byDiff[byDiff.length - 1].diff } : null,
      rows,
      account: account.length >= 2 ? {
        from: account[0].date,
        you: accEnd.you,
        twin: accEnd.twin,
        diff: accEnd.you - accEnd.twin,
        diffPct: accEnd.twin > 0 ? (accEnd.you / accEnd.twin - 1) * 100 : null,
      } : null,
    };
  }
  if (!periods.all) return null;
  const main = periods.year ?? periods.all;
  return {
    id: 'twin',
    group: 'market',
    headline: main.diff >= 0
      ? `Your trades made ${plain$(main.diff)} more than the same money would have in the S&P 500`
      : `The same money in the S&P 500 would have made ${plain$(-main.diff)} more than your trades`,
    tone: main.diff >= 0 ? 'good' : 'bad',
    impact: Math.abs(main.diff),
    twin: periods,
  };
}

/* ── when the market falls ── */

function downMarket(paired) {
  const down = paired.filter((x) => x.spx <= -1);
  const up = paired.filter((x) => x.spx >= 1);
  const base = {
    id: 'down', group: 'habits', topic: 'When the market falls',
    how: 'On every market day the S&P 500 fell 1% or more, we take your account\'s return that day (deposits taken out) and the S&P 500\'s. Your average divided by the S&P 500\'s average is the share of the fall you took: 100% means you fell exactly as much as the market. The same on days it rose 1% or more.',
  };
  if (down.length < MIN_GROUP) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: MIN_GROUP - down.length, unit: 'market drops' } };
  const capture = (xs) => {
    const s = mean(xs.map((x) => x.spx));
    return s ? (mean(xs.map((x) => x.ret)) / s) * 100 : null;
  };
  const dc = capture(down);
  const uc = up.length >= MIN_GROUP ? capture(up) : null;
  const youDown = mean(down.map((x) => x.ret));
  const spxDown = mean(down.map((x) => x.spx));
  const total = sum(down.map((x) => x.pnl));
  const extra = beyondMarket(down);
  const harder = dc > 110;
  const softer = dc < 90;
  return {
    ...base,
    headline: harder ? 'When the market falls, your account usually falls harder'
      : softer ? 'When the market falls, your account usually holds up better'
        : 'When the market falls, your account usually falls about as much',
    matters: harder ? 'Bigger drops on bad days take bigger gains to recover from.'
      : softer ? 'Losing less on bad days makes it easier to recover.'
        : 'Your account follows the market closely on its worst days.',
    data: `On the ${plural(down.length, 'day')} the S&P 500 fell 1% or more, it fell ${plainPct(spxDown, 2)} on average; your account ${youDown <= 0 ? 'fell' : 'rose'} ${plainPct(youDown, 2)}.`,
    more: `That is ${Math.round(dc)}% of the market's move.${uc != null ? ` On days it rose 1% or more, you caught ${Math.round(uc)}% of the rise.` : ''} Those down days added up to ${usd(total)}; ${extra < 0 ? `falling more than the market cost about ${plain$(extra)} of that` : `holding up better than the market saved about ${plain$(extra)}`}.`,
    tone: harder ? 'bad' : softer ? 'good' : 'neutral',
    impact: Math.abs(extra),
    bars: [['Market falls · you', youDown], ['Market falls · S&P 500', spxDown],
      ...(up.length ? [['Market rises · you', mean(up.map((x) => x.ret))], ['Market rises · S&P 500', mean(up.map((x) => x.spx))]] : [])],
    unit: 'pct2',
  };
}

/* ── after you sold ── */

/** The close `days` calendar days after `date`, when the series reaches that far. */
function closeAfter(rows, date, days) {
  const target = addDays(date, days);
  const dates = rowDates(rows);
  if (dates[dates.length - 1] < target) return null;
  const i = at(dates, target);
  return i >= 0 ? rows[i].close : null;
}

function afterSold(trades, series) {
  const rows = [];
  for (const t of trades) {
    const s = series.get(t.ticker);
    if (!s?.length || !(t.exit > 0)) continue;
    const base = stockAt(s, t.close);
    if (!base || !(base.close > 0) || s[base.i].date !== t.close) continue;
    const sign = t.dir === 'Short' ? -1 : 1;
    const later = (n) => {
      const c = closeAfter(s, t.close, n);
      return c != null ? (c / base.close - 1) * 100 * sign : null;
    };
    const month = later(30);
    if (month == null) continue;
    rows.push({ ...t, week: later(7), month, money: (t.qty * t.exit * month) / 100 });
  }
  const base = {
    id: 'after', group: 'habits', topic: 'What happens after you sell',
    how: 'For each closed trade, the stock\'s close 30 days after the day you sold, against its close that day (for a short, a fall counts as the stock moving your way). In money: the shares you sold × your sale price × that move. "Left on the table" adds up the stocks that kept moving your way; "saved" the ones that turned against you.',
  };
  if (rows.length < MIN_GROUP) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: MIN_GROUP - rows.length, unit: 'sales at least a month old' } };
  const left = sum(rows.filter((r) => r.money > 0).map((r) => r.money));
  const saved = -sum(rows.filter((r) => r.money < 0).map((r) => r.money));
  const winners = rows.filter((r) => r.outcome === 'win');
  const avgMonth = mean(rows.map((r) => r.month));
  const winnersRan = winners.length >= 3 ? mean(winners.map((r) => r.month)) : null;
  const early = winnersRan != null && winnersRan > 3;
  return {
    ...base,
    headline: early ? 'You tend to sell winners too early'
      : avgMonth > 2 ? 'Stocks you sold often kept rising afterwards'
        : avgMonth < -2 ? 'Your exits have been well timed'
          : 'After you sell, your stocks usually do not move much',
    matters: early || avgMonth > 2 ? 'This pattern may be costing you performance: gains you could have kept.'
      : avgMonth < -2 ? 'The stocks you sold usually fell afterwards, so getting out protected your money.'
        : 'Your timing on exits is neither costing nor saving you much.',
    data: `${early ? `The winners you sold rose a further ${plainPct(winnersRan)} on average in the next 30 days.` : `In the 30 days after you sold, the stocks moved ${pct(avgMonth)} on average.`} Based on ${plural(rows.length, 'trade')}.`,
    more: `All the stocks you sold moved ${pct(avgMonth)} on average over the next 30 days: ${plain$(left)} left on the table by those that kept going your way, ${plain$(saved)} saved by getting out of those that turned.`,
    tone: early || avgMonth > 2 ? 'bad' : avgMonth < -2 ? 'good' : 'neutral',
    impact: Math.abs(left - saved),
    confidence: confidenceOne(rows.map((r) => r.month)),
    bars: [
      ...(rows.some((r) => r.week != null) ? [['A week later', mean(rows.filter((r) => r.week != null).map((r) => r.week))]] : []),
      ['A month later', avgMonth],
    ],
    trades: ids([...rows].sort((a, b) => b.money - a.money).slice(0, 8)),
  };
}

/* ── personal records ── */

function records(days, history, trades, weeks) {
  const out = [];
  const bestDay = days.reduce((a, b) => (!a || b.pnl > a.pnl ? b : a), null);
  if (bestDay && bestDay.pnl > 0) out.push({ label: 'Best day', value: usd(bestDay.pnl), sub: `${pct(bestDay.ret, 2)} · ${longDate(bestDay.date)}` });
  const months = [...monthlyReturns(history)].filter(([, m]) => !m.partial);
  const bestMonth = months.reduce((a, b) => (!a || b[1].returnPct > a[1].returnPct ? b : a), null);
  if (bestMonth && bestMonth[1].returnPct > 0) out.push({ label: 'Best month', value: pct(bestMonth[1].returnPct), sub: `${monthName(bestMonth[0])} · ${usd(bestMonth[1].pnl)}` });
  const win = trades.reduce((a, b) => (!a || b.pnl > a.pnl ? b : a), null);
  if (win && win.pnl > 0) out.push({ label: 'Biggest win', value: usd(win.pnl), sub: `${win.ticker} · ${pct(win.ret)} · ${longDate(win.close)}` });
  let run = 0;
  let longest = 0;
  for (const t of trades) {
    if (t.outcome === 'win') run += 1;
    else if (t.outcome === 'loss') run = 0;
    longest = Math.max(longest, run);
  }
  if (longest >= 2) out.push({ label: 'Longest winning streak', value: plural(longest, 'trade'), sub: 'won in a row' });
  const bestWeek = weeks.reduce((a, b) => (!a || b.you - b.spx > a.you - a.spx ? b : a), null);
  if (bestWeek && bestWeek.you > bestWeek.spx) out.push({ label: 'Best week against the market', value: `+${(bestWeek.you - bestWeek.spx).toFixed(1)} pts`, sub: `${pct(bestWeek.you)} against ${pct(bestWeek.spx)} · week of ${shortDate(bestWeek.from)}` });
  return out;
}

/* ── the market's mood when you buy ── */

/** CNN's own bands: 0–24 extreme fear, 25–44 fear, 45–55 neutral, 56–75 greed, 76–100 extreme greed. */
const MOODS = [
  ['Extreme fear', 0, 25],
  ['Fear', 25, 45],
  ['Neutral', 45, 56],
  ['Greed', 56, 76],
  ['Extreme greed', 76, 101],
];
export const moodOf = (v) => MOODS.find(([, lo, hi]) => v >= lo && v < hi)?.[0] ?? null;

function moodAtEntry(trades) {
  const rated = trades.filter((t) => t.fg != null);
  const fear = rated.filter((t) => t.fg < 45);
  const greed = rated.filter((t) => t.fg > 55);
  const base = {
    id: 'mood', group: 'habits', topic: 'The market\'s mood when you buy',
    how: 'CNN\'s Fear & Greed index (0 = extreme fear, 100 = extreme greed) on the day you opened each stock trade (crypto is left out: the index measures the stock market). Trades bought below 45 (fear) are compared with those bought above 55 (greed) by average return, checked against chance.',
  };
  if (fear.length < MIN_GROUP || greed.length < MIN_GROUP) {
    return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: Math.max(0, MIN_GROUP - fear.length) + Math.max(0, MIN_GROUP - greed.length), unit: 'stock trades bought in fear or greed' } };
  }
  const groups = MOODS.map(([label]) => ({ label, ts: rated.filter((t) => moodOf(t.fg) === label) })).filter((g) => g.ts.length);
  const f = mean(fear.map((t) => t.ret));
  const g = mean(greed.map((t) => t.ret));
  const worse = f < g ? fear : greed;
  return {
    ...base,
    headline: f > g ? 'You do better buying when other investors are fearful' : 'You do better buying when other investors are confident',
    matters: f > g ? 'Buying when others are nervous often means buying at better prices.' : 'Your best trades come when the market is in a good mood; fearful markets have been harder for you.',
    data: `Bought in fear: ${pct(f)} per trade. Bought in greed: ${pct(g)} per trade. Based on ${plural(rated.length, 'stock trade')}.`,
    more: `${fear.length} trades bought in fear, ${greed.length} in greed. Your ${f < g ? 'fear' : 'greed'} trades added up to ${usd(sum(worse.map((t) => t.pnl)))}.`,
    tone: f > g ? 'good' : 'neutral',
    impact: Math.abs(sum(worse.map((t) => t.pnl))),
    confidence: confidence(fear, greed),
    bars: groups.map((x) => [x.label, mean(x.ts.map((t) => t.ret))]),
    trades: ids(worse),
  };
}

/* ── emotional against confident ── */

function emotion(trades) {
  const rated = trades.filter((t) => t.mind != null);
  const emotional = rated.filter((t) => t.mind <= 4);
  const confident = rated.filter((t) => t.mind >= 7);
  const base = {
    id: 'emotion', group: 'habits', topic: 'Your state of mind and your results',
    how: 'The state of mind you rated when opening each trade (1 = emotional, 10 = calm and confident). Trades rated 1–4 are compared with trades rated 7–10 by average return, checked against chance. Trades rated 5–6, or not rated, are left out.',
  };
  if (emotional.length < MIN_GROUP || confident.length < MIN_GROUP) {
    return {
      ...base, tone: 'neutral', impact: 0,
      confidence: { level: 'early', needed: Math.max(0, MIN_GROUP - emotional.length) + Math.max(0, MIN_GROUP - confident.length), unit: 'rated trades' },
      hint: 'Rate your state of mind when you open a trade (New trade → State of mind).',
    };
  }
  const e = mean(emotional.map((t) => t.ret));
  const c = mean(confident.map((t) => t.ret));
  const why = whyOf(emotional, confident, ['emotional']);
  const total = sum(emotional.map((t) => t.pnl));
  return {
    ...base,
    headline: c > e ? 'Your calm, confident trades do clearly better' : 'Your emotional trades have done as well or better',
    matters: c > e ? 'Pausing to notice how you feel before a trade is one of the simplest ways to improve.' : 'Your instincts have served you well so far, even when you felt unsure.',
    data: `Emotional (rated 1–4): ${pct(e)} per trade. Confident (7–10): ${pct(c)} per trade. Based on ${plural(emotional.length + confident.length, 'rated trade')}.`,
    more: `${emotional.length} emotional trades, ${usd(total)} in total; ${confident.length} confident trades, ${usd(sum(confident.map((t) => t.pnl)))}.`,
    cause: why ? `Your emotional trades: ${why.text}` : null,
    tone: c > e ? 'good' : 'neutral',
    impact: Math.abs(total),
    confidence: confidence(emotional, confident),
    bars: [['Emotional', e], ['Confident', c]],
    trades: ids(emotional),
  };
}

/* ── how long you hold losers against winners ── */

function holding(trades) {
  const wins = trades.filter((t) => t.outcome === 'win');
  const losses = trades.filter((t) => t.outcome === 'loss');
  const base = {
    id: 'holding', group: 'habits', topic: 'How long you hold winners and losers',
    how: 'The average number of calendar days between opening and closing, for your winning trades and your losing trades separately, checked against chance.',
  };
  if (wins.length < MIN_GROUP || losses.length < MIN_GROUP) {
    return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: Math.max(0, MIN_GROUP - wins.length) + Math.max(0, MIN_GROUP - losses.length), unit: 'winning or losing trades' } };
  }
  const w = mean(wins.map((t) => t.days));
  const l = mean(losses.map((t) => t.days));
  const longer = l > w * 1.2;
  const shorter = w > l * 1.2;
  const lingered = losses.filter((t) => t.days > w * 1.5 && t.days > 2);
  const lingeredCost = sum(lingered.map((t) => t.pnl));
  return {
    ...base,
    headline: longer ? 'You tend to hold losing trades longer than winning ones'
      : shorter ? 'You cut losing trades quickly and give winners time'
        : 'You give winning and losing trades about the same time',
    matters: longer ? 'This pattern may be costing you performance: losses get time to grow while gains are taken early.'
      : shorter ? 'That is the discipline most investors find hardest.'
        : 'No sign of the most common habit in investing: holding on to losers.',
    data: `Winners: ${Math.round(w)} days on average. Losers: ${Math.round(l)} days. Based on ${plural(wins.length + losses.length, 'trade')}.`,
    more: longer && lingered.length ? `${plural(lingered.length, 'losing trade')} stayed open well past your typical winner and lost ${plain$(lingeredCost)} together.` : null,
    tone: longer ? 'bad' : shorter ? 'good' : 'neutral',
    impact: longer ? Math.abs(lingeredCost) : 0,
    confidence: confidence(wins, losses, (t) => t.days),
    bars: [['Winners', w], ['Losers', l]],
    unit: 'days',
    trades: longer ? ids(lingered) : [],
  };
}

/* ── risk: the deepest drop, and the swings against the market ── */

export function deepestDrop(days, ix) {
  const base = {
    id: 'drawdown', group: 'deeper', topic: 'Your biggest drop',
    how: 'Your account\'s daily returns (deposits and withdrawals taken out) chained into one growth line. The biggest drop is the largest fall from a high to a later low on that line, so money moving in or out never counts as a drop. The S&P 500\'s biggest drop is measured the same way over the same dates.',
  };
  if (days.length < 20) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: 20 - days.length, unit: 'days of history' } };
  let growth = 1;
  let peak = 1;
  let peakDate = days[0].date;
  let worst = { depth: 0 };
  for (const d of days) {
    growth *= 1 + d.ret / 100;
    if (growth >= peak) {
      if (worst.depth < 0 && !worst.recovered && worst.peak === peakDate) worst.recovered = d.date;
      peak = growth;
      peakDate = d.date;
    }
    const depth = (growth / peak - 1) * 100;
    if (depth < worst.depth) worst = { depth, peak: peakDate, trough: d.date, recovered: null };
  }
  if (worst.depth > -1) return null;
  const now = (growth / peak - 1) * 100;
  let spx = null;
  const first = at(ix.dates, days[0].date);
  if (first >= 0) {
    let p = 0;
    spx = 0;
    for (let i = first; i < ix.dates.length && ix.dates[i] <= days[days.length - 1].date; i++) {
      p = Math.max(p, ix.level[i]);
      spx = Math.min(spx, (ix.level[i] / p - 1) * 100);
    }
  }
  const took = worst.recovered ? Math.round((ms(worst.recovered) - ms(worst.trough)) / DAY) : null;
  return {
    ...base,
    headline: `Your biggest drop from a high was ${plainPct(worst.depth)}`,
    matters: spx != null
      ? (worst.depth < spx * 1.1 ? `That is deeper than the market's biggest drop over the same time (${plainPct(spx)}).` : `The market's biggest drop over the same time was ${plainPct(spx)}, so you held up about as well or better.`)
      : 'Every investor goes through drops; how deep they go shows how much risk the account carries.',
    data: `From ${longDate(worst.peak)} to ${longDate(worst.trough)}. ${worst.recovered ? `It took ${plural(took, 'day')} to get back to the high.` : 'Not yet back to that high.'} ${now > -0.5 ? 'Today you are at or near your highest.' : `Today you are ${plainPct(now)} below your highest.`}`,
    tone: spx != null && worst.depth < spx * 1.1 ? 'bad' : 'neutral',
    impact: 0,
  };
}

function swings(paired) {
  const base = {
    id: 'swings', group: 'deeper', topic: 'How much your account moves',
    how: 'The usual size of your account\'s daily moves (their standard deviation), scaled to a year (× √252), against the S&P 500\'s on the same days. Return for each point of movement = average daily return × 252 ÷ that yearly figure, for each.',
  };
  if (paired.length < 40) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: Math.ceil((40 - paired.length) / 5) * 5, unit: 'market days' } };
  const year = Math.sqrt(252);
  const you = stdev(paired.map((x) => x.ret)) * year;
  const spx = stdev(paired.map((x) => x.spx)) * year;
  if (!(you > 0 && spx > 0)) return null;
  const yourPer = (mean(paired.map((x) => x.ret)) * 252) / you;
  const spxPer = (mean(paired.map((x) => x.spx)) * 252) / spx;
  const paid = yourPer >= spxPer;
  const ratio = you / spx;
  return {
    ...base,
    headline: ratio > 1.1
      ? (paid ? 'Your account moves more than the market, and so far that has paid off' : 'Your account moves more than the market, without extra return so far')
      : ratio < 0.9 ? 'Your account is calmer than the market' : 'Your account moves about as much as the market',
    matters: paid ? 'So far, the movement you live with has been rewarded with return.' : 'So far, the extra movement has not come with extra return.',
    data: `Your account moves ${ratio.toFixed(1)}× as much as the S&P 500. Based on ${plural(paired.length, 'market day')}.`,
    more: `Usual yearly movement: ${you.toFixed(0)}% for you, ${spx.toFixed(0)}% for the S&P 500. Return for each point of movement: ${yourPer.toFixed(2)} for you, ${spxPer.toFixed(2)} for the S&P 500.`,
    tone: paid ? 'good' : ratio > 1.1 ? 'bad' : 'neutral',
    impact: 0,
    calmer: you < spx,
    bars: [['Your account', you], ['S&P 500', spx]],
    unit: 'vol',
  };
}

/* ── your open positions ── */

function openBook(open, trades, accountValue) {
  const items = [];
  const losses = trades.filter((t) => t.outcome === 'loss');
  const typical = losses.length >= 3 ? median(losses.map((t) => t.days)) : null;
  if (typical != null) {
    for (const p of open.filter((x) => x.pnl < 0 && x.days > Math.max(typical * 1.5, 5)).sort((a, b) => a.pnl - b.pnl).slice(0, 3)) {
      items.push({ tone: 'bad', text: `${p.ticker} has been open ${p.days} days and is ${plainPct(p.ret)} below what you paid. Your past losing trades usually lasted about ${Math.round(typical)} days.` });
    }
  }
  const total = accountValue > 0 ? accountValue : sum(open.map((p) => Math.abs(p.value)));
  if (total > 0 && open.length) {
    const biggest = open.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
    if (share(Math.abs(biggest.value), total) >= 25) {
      items.push({ tone: 'bad', text: `${biggest.ticker} is ${Math.round(share(Math.abs(biggest.value), total))}% of your account, so one stock moves your whole account.` });
    }
    const bySector = new Map();
    for (const p of open) bySector.set(p.sector, (bySector.get(p.sector) ?? 0) + Math.abs(p.value));
    const top = [...bySector].sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] !== 'Other' && share(top[1], total) >= 50) {
      items.push({ tone: 'neutral', text: `${Math.round(share(top[1], total))}% of your account is in ${top[0]}, so a bad day for that sector is a bad day for you.` });
    }
  }
  const best = open.filter((p) => p.pnl > 0).sort((a, b) => b.pnl - a.pnl)[0];
  if (best) items.push({ tone: 'good', text: `Your best open position is ${best.ticker}: ${usd(best.pnl)} (${pct(best.ret)}) in ${plural(best.days, 'day')}.` });
  return items.length ? { id: 'now', items } : null;
}

/* ── the trader title and badges ── */

export const TITLES = {
  scalper: ['⚡', 'The Lightning Scalper'],
  sniper: ['🎯', 'The Day Sniper'],
  adrenaline: ['🎢', 'The Adrenaline Junkie'],
  wave: ['🌊', 'The Wave Rider'],
  surfer: ['🏄', 'The Momentum Surfer'],
  hunter: ['🦅', 'The Patient Hunter'],
  oak: ['🌳', 'The Oak'],
  fortress: ['🏰', 'The Fortress Builder'],
  homerun: ['💣', 'The Home-Run Hitter'],
  sharpshooter: ['🎯', 'The Sharpshooter'],
  labrat: ['🧪', 'The Lab Rat'],
  tortoise: ['🐢', 'The Tortoise'],
};

/**
 * One main title from how long you hold, how often you win and how big your
 * wins are against your losses. The first rule that fits wins, in this order.
 */
export function traderTitle(trades, { twinAhead = null, calmer = null, sectors = 0 } = {}) {
  if (trades.length < MIN_TRADES) return null;
  const pick = (key, why) => ({ key, icon: TITLES[key][0], name: TITLES[key][1], why });
  const wins = trades.filter((t) => t.outcome === 'win');
  const losses = trades.filter((t) => t.outcome === 'loss');
  const rate = winRate(trades);
  const payoff = wins.length && losses.length ? mean(wins.map((t) => t.pnl)) / -mean(losses.map((t) => t.pnl)) : null;
  const held = median(trades.map((t) => t.days));
  const dayShare = share(trades.filter((t) => t.days <= 1).length, trades.length);
  const tickers = new Set(trades.map((t) => t.ticker)).size;
  const spread = stdev(trades.map((t) => t.ret));
  const ran = trades.filter((t) => t.stock10 != null);

  if (rate < 45 && payoff != null && payoff >= 3) return pick('homerun', `You win ${Math.round(rate)}% of your trades, but your average win is ${payoff.toFixed(1)}× your average loss.`);
  if (rate > 70) return pick('sharpshooter', `You win ${Math.round(rate)}% of your trades.`);
  if (dayShare > 50) {
    if (rate > 60) return pick('sniper', `Most of your trades close within a day, and ${Math.round(rate)}% of your trades win.`);
    if (spread > 8) return pick('adrenaline', 'Most of your trades close within a day, with big moves both ways.');
    return pick('scalper', `${Math.round(dayShare)}% of your trades close within a day.`);
  }
  if (trades.length >= 40 && tickers >= trades.length * 0.6 && Math.abs(median(trades.map((t) => t.ret))) < 3) {
    return pick('labrat', `${trades.length} trades across ${tickers} different stocks, mostly small moves.`);
  }
  if (held <= 30) {
    if (ran.length >= MIN_GROUP && share(ran.filter((t) => t.stock10 >= 10).length, ran.length) >= 40) {
      return pick('surfer', 'You usually hold for days to weeks, and you often buy a stock after it has already risen.');
    }
    return pick('wave', `You usually hold for days to weeks (typically ${Math.round(held)} days).`);
  }
  if (held <= 180) {
    if (twinAhead && calmer) return pick('tortoise', 'You hold for months, your account is calmer than the market, and you are ahead of it.');
    if (sectors >= 8) return pick('fortress', `You hold for months, spread across ${sectors} sectors.`);
    return pick('hunter', `You hold for months (typically ${Math.round(held)} days)${rate >= 55 ? ` and win ${Math.round(rate)}% of your trades` : ''}.`);
  }
  return pick('oak', `You typically hold a trade for ${Math.round(held)} days: you rarely sell.`);
}

export const BADGES = {
  icecold: ['🧊', 'Ice-Cold'],
  hothead: ['🔥', 'Hot-Headed'],
  dip: ['🛒', 'Dip Buyer'],
  trend: ['🚀', 'Trend Chaser'],
  fear: ['😱', 'Fear Buyer'],
  greed: ['🤑', 'Greed Rider'],
  tech: ['💻', 'Tech Devotee'],
  crypto: ['₿', 'Crypto Native'],
  energy: ['🛢️', 'Energy Baron'],
  banks: ['🏦', 'Bank Teller'],
  pills: ['💊', 'Pill Popper'],
  diversifier: ['🌍', 'The Diversifier'],
  allin: ['🎲', 'All-In'],
  beater: ['🏆', 'Market Beater'],
  hugger: ['🪞', 'Index Hugger'],
  diamond: ['💎', 'Diamond Hands'],
  paper: ['🧻', 'Paper Hands'],
  friday: ['📅', 'Friday Gambler'],
};

/** Every badge earned, strongest first; the page shows two. */
export function traderBadges(trades, { open = [], accountValue = 0, twinPct = null, twinDays = 0 } = {}) {
  const out = [];
  const add = (key, score, why) => out.push({ key, icon: BADGES[key][0], name: BADGES[key][1], why, score });
  const rated = trades.filter((t) => t.mind != null);
  if (rated.length >= MIN_GROUP) {
    const calm = rated.filter((t) => t.mind >= 7);
    const hot = rated.filter((t) => t.mind <= 4);
    const calmShare = share(calm.length, rated.length);
    const hotShare = share(hot.length, rated.length);
    if (calmShare >= 60 && (!hot.length || mean(calm.map((t) => t.ret)) > mean(hot.map((t) => t.ret)))) add('icecold', calmShare, `${Math.round(calmShare)}% of your rated trades were taken calm and confident, and they do better.`);
    if (hotShare >= 30 && mean(hot.map((t) => t.ret)) < mean(rated.filter((t) => t.mind > 4).map((t) => t.ret))) add('hothead', hotShare + 10, `${Math.round(hotShare)}% of your rated trades were taken emotional, and they do worse.`);
  }
  const ran = trades.filter((t) => t.stock10 != null);
  if (ran.length >= MIN_GROUP) {
    const dips = share(ran.filter((t) => t.stock10 <= -5).length, ran.length);
    const chases = share(ran.filter((t) => t.stock10 >= 10).length, ran.length);
    if (dips >= 50) add('dip', dips, `${Math.round(dips)}% of your buys came after the stock fell 5% or more in two weeks.`);
    if (chases >= 40) add('trend', chases, `${Math.round(chases)}% of your buys came after the stock rose 10% or more in two weeks.`);
  }
  const moods = trades.filter((t) => t.fg != null);
  if (moods.length >= MIN_GROUP) {
    const f = share(moods.filter((t) => t.fg < 45).length, moods.length);
    const g = share(moods.filter((t) => t.fg > 55).length, moods.length);
    if (f >= 50) add('fear', f, `${Math.round(f)}% of your stock buys were made while investors were fearful.`);
    if (g >= 50) add('greed', g, `${Math.round(g)}% of your stock buys were made while investors were greedy.`);
  }
  const book = open.length
    ? open.map((p) => ({ sector: p.sector, cls: p.cls, value: Math.abs(p.value) }))
    : trades.map((t) => ({ sector: t.sector, cls: t.cls, value: t.cost }));
  const total = sum(book.map((x) => x.value));
  if (total > 0) {
    const of = (test) => share(sum(book.filter(test).map((x) => x.value)), total);
    const where = open.length ? 'of your open positions' : 'of the money you have traded';
    const tech = of((x) => x.sector === 'Technology');
    if (tech > 50) add('tech', tech - 20, `${Math.round(tech)}% ${where} is in technology.`);
    const crypto = of((x) => x.cls === 'Crypto' || x.sector === 'Crypto');
    if (crypto >= 30) add('crypto', crypto, `${Math.round(crypto)}% ${where} is in crypto.`);
    for (const [key, sector] of [['energy', 'Energy'], ['banks', 'Financials'], ['pills', 'Healthcare']]) {
      const s = of((x) => x.sector === sector);
      if (s >= 30) add(key, s, `${Math.round(s)}% ${where} is in ${sector.toLowerCase()}.`);
    }
  }
  if (open.length) {
    const base = accountValue > 0 ? accountValue : total;
    const biggest = Math.max(...open.map((p) => Math.abs(p.value)));
    const sectors = new Set(open.map((p) => p.sector).filter((s) => s !== 'Other')).size;
    if (base > 0 && share(biggest, base) >= 30) add('allin', share(biggest, base), `One position is ${Math.round(share(biggest, base))}% of your account.`);
    else if (sectors >= 6 && base > 0 && share(biggest, base) <= 15) add('diversifier', 40 + sectors, `${sectors} sectors, and no position over 15% of the account.`);
  }
  if (twinPct != null && twinDays >= 60) {
    if (twinPct >= 2) add('beater', 50 + Math.min(twinPct, 40), `Your account is ${twinPct.toFixed(1)}% ahead of putting every deposit in the S&P 500.`);
    else if (Math.abs(twinPct) < 2 && twinDays >= 120) add('hugger', 35, `Your account is within ${Math.abs(twinPct).toFixed(1)}% of putting every deposit in the S&P 500.`);
  }
  const held = trades.filter((t) => t.dipped != null && t.dipped <= -20 && t.outcome === 'win');
  if (held.length) add('diamond', 30 + held.length * 5, `${plural(held.length, 'trade')} fell 20% or more while you held, and you still closed ${held.length === 1 ? 'it' : 'them'} in profit.`);
  const wins = trades.filter((t) => t.outcome === 'win');
  if (wins.length >= MIN_GROUP) {
    const quick = share(wins.filter((t) => t.days <= 3).length, wins.length);
    if (quick >= 50 && trades.some((t) => t.days > 10)) add('paper', quick, `${Math.round(quick)}% of your winners were sold within three days.`);
  }
  if (trades.length >= MIN_TRADES) {
    const fri = share(trades.filter((t) => t.weekday === 5).length, trades.length);
    if (fri >= 35) add('friday', fri, `${Math.round(fri)}% of your trades were opened on a Friday.`);
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ── what stands out, and the summary ── */

/**
 * The three things to show first: the strongest edge (the largest strength in
 * money), the biggest area to improve, and the most interesting remaining
 * pattern. Only facts and patterns unlikely to be chance qualify.
 */
function standOut(cards) {
  const ranked = cards.filter((c) => c.group !== 'market' && c.id !== 'week' && c.headline && c.confidence?.level !== 'early' && solid(c.confidence))
    .sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0));
  const edge = ranked.find((c) => c.tone === 'good') ?? null;
  const improve = ranked.find((c) => c.tone === 'bad') ?? null;
  const pattern = ranked.find((c) => c !== edge && c !== improve) ?? null;
  return [
    edge && { kind: 'edge', label: 'Your strongest edge', id: edge.id },
    improve && { kind: 'improve', label: 'Area to improve', id: improve.id },
    pattern && { kind: 'pattern', label: 'Interesting pattern', id: pattern.id },
  ].filter(Boolean);
}

/** One short paragraph: how the year is going, the strongest edge, and what is worth watching. */
function summaryOf({ year, twinCard, cards, picks, trades, days }) {
  const parts = [];
  if (year?.you != null && year?.spx != null) {
    const ahead = year.you >= year.spx;
    parts.push(`This year your account is ${year.you >= 0 ? 'up' : 'down'} ${plainPct(year.you)}, while the S&P 500 is ${year.spx >= 0 ? 'up' : 'down'} ${plainPct(year.spx)}. ${ahead ? 'You are ahead of the market.' : 'The market is ahead of you for now.'}`);
  }
  const t = twinCard?.twin?.year ?? twinCard?.twin?.all;
  if (t && t.decided + t.open >= 3) {
    parts.push(t.diff >= 0
      ? `Your picks have made ${plain$(t.diff)} more than the same money would have in the S&P 500.`
      : `Putting the same money in the S&P 500 would have made ${plain$(-t.diff)} more than your picks so far.`);
  }
  const byId = new Map(cards.map((c) => [c.id, c]));
  const edge = picks.find((p) => p.kind === 'edge');
  const improve = picks.find((p) => p.kind === 'improve');
  if (edge) parts.push(`Your strongest edge: ${lower(byId.get(edge.id).headline)}.`);
  if (improve) parts.push(`Worth watching: ${lower(byId.get(improve.id).headline)}.`);
  if (!parts.length) {
    return trades || days
      ? 'Your analyst is still getting to know you. As your history grows and more trades close, this is where you will see what you do well and what is worth a closer look.'
      : 'Once your account has some history and a few closed trades, your analyst will explain here how you are doing, what you do well and what is worth watching.';
  }
  return parts.join(' ');
}

/* ── everything ── */

/**
 * The whole analysis, from what the device already holds:
 *  - positions: the journal
 *  - history: the account valued day by day (totalAccountValue, externalCashFlow)
 *  - index: the S&P 500's daily closes with dividends ({ date, close, div })
 *  - fearGreed: [{ date, value }]; bigDays: [{ date, kind }]
 *  - series: ticker → its daily closes, for the stocks that could be loaded
 *  - year: { you, spx } — this year's returns exactly as Home shows them
 * Anything missing simply leaves its cards waiting for data.
 */
export function analyse({
  positions = [], history = [], index = [], fearGreed = [], bigDays = [], series = new Map(),
  accountValue = null, year = null, today = new Date(),
} = {}) {
  const day = typeof today === 'string' ? today : today.toISOString().slice(0, 10);
  const ix = indexLevels(index);
  const newsDays = new Set((bigDays ?? []).map((b) => b?.date).filter(Boolean));
  const fg = [...(fearGreed ?? [])].filter((x) => x?.date && Number.isFinite(x.value)).sort((a, b) => a.date.localeCompare(b.date));
  const trades = enrich(tradesOf(positions), { ix, fearGreed: fg, newsDays, series, today: day });

  const open = (positions ?? []).filter((p) => p?.status !== 'Closed' && p?.open && p.qty).map((p) => {
    const life = tradeLife(p);
    const twinLife = ix.dates.length ? twinOfLife(life, ix, day) : null;
    const booked = sum((p.exits ?? []).map((e) => Number(e.pnl) || 0));
    const cost = Math.abs(costOf(p));
    const pnl = unreal(p);
    return {
      id: p.id, ticker: p.ticker, open: p.open, cls: p.cls, sector: sectorOf(p), life,
      // The whole trade so far: what is still held, plus what its sales already booked.
      pnl: pnl + booked,
      cost: sum(life.buys.map((b) => b.qty * b.price)) || cost,
      ret: cost ? (pnl / cost) * 100 : 0,
      value: marketValueOf(p),
      days: Math.max(0, Math.round((ms(day) - ms(p.open)) / DAY)),
      spxPnl: twinLife ? twinLife.pnl : null,
    };
  });

  const days = accountDays(history);
  const paired = pairDays(days, ix);
  const weeks = weeksOf(paired);
  const enough = trades.length >= MIN_TRADES;

  const twinCard = twin(history, ix, trades, open, day, series);
  const swingCard = swings(paired);
  const cards = [
    twinCard,
    // Your habits
    weekdayTrades(trades),
    downMarket(paired),
    afterSold(trades, series),
    holding(trades),
    emotion(trades),
    moodAtEntry(trades),
    // Explore deeper
    monthsVsIndex(history, ix, day),
    lastWeek(weeks, trades, day),
    deepestDrop(days, ix),
    swingCard,
    accountWeekdays(paired),
    bigNewsDays(paired, bigDays),
  ].filter(Boolean);

  const yearTwin = twinCard?.twin?.year?.account ?? twinCard?.twin?.all?.account ?? null;
  const twinDays = yearTwin ? Math.round((ms(day) - ms(yearTwin.from)) / DAY) : 0;
  const sectors = new Set(trades.map((t) => t.sector).filter((s) => s !== 'Other')).size;
  const title = traderTitle(trades, { twinAhead: yearTwin ? yearTwin.diff > 0 : null, calmer: swingCard?.calmer ?? null, sectors });
  const badges = enough ? traderBadges(trades, { open, accountValue, twinPct: yearTwin?.diffPct ?? null, twinDays }) : [];
  const picks = standOut(cards);

  return {
    trades: trades.length,
    needed: Math.max(0, MIN_TRADES - trades.length),
    winRate: trades.length ? winRate(trades) : null,
    year: year ?? { you: null, spx: null },
    summary: summaryOf({ year, twinCard, cards, picks, trades: trades.length, days: days.length }),
    standOut: picks,
    profile: { title, badges: badges.slice(0, 2), allBadges: badges, records: records(days, history, trades, weeks) },
    cards,
    now: openBook(open, trades, accountValue),
  };
}
