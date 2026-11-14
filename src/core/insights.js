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
import { dayGrowth, measurable, monthlyReturns, periodReturnFromHistory } from './portfolioHistory.js';
import { appTradeEvents } from './appTrades.js';

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
const EARLIEST = '0000-01-01';

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
    ? [{ d: p.open || EARLIEST, qty: first, price: firstPrice }, ...adds]
    : [{ d: p.open || EARLIEST, qty: held + sum(sells.map((s) => s.qty)), price: +p.entry }];
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

const daysHeld = (p) => Math.max(0, Math.round((ms(p.close) - ms(p.open)) / DAY));

/**
 * The closed trades as the analyst reads them: one per sale (November 2026).
 *
 * A statement import keeps one closed record per tax lot, so one sale of AMD
 * could count as four trades: four wins in a row, four times the weight in
 * every average, a $1,500 gain split into lots too small for "Four Figures".
 * The records of one stock sold on one day, the same way round, are one trade
 * here: its profit and cost are their sums, its return the profit over the
 * cost, its holding time their average weighted by cost. A record with no
 * opening date (a holding carried in from before the first statement) counts
 * like any other; its trade simply has no holding time when none of its
 * records has one.
 */
export function tradesOf(positions) {
  const groups = new Map();
  for (const p of positions ?? []) {
    if (p?.status !== 'Closed' || !p.ticker || !p.close || (p.open && p.close < p.open)) continue;
    const key = `${symbolKey(p.ticker)}|${p.close}|${p.dir === 'Short' ? 'S' : 'L'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.values()].map((records) => {
    const first = records[0];
    const pnl = sum(records.map((p) => realized(p)));
    const cost = sum(records.map((p) => Math.abs(costOf(p))));
    const qty = sum(records.map((p) => Math.abs(Number(p.qty) || 0)));
    const dated = records.filter((p) => p.open);
    const datedCost = sum(dated.map((p) => Math.abs(costOf(p))));
    const days = !dated.length ? null
      : Math.round(datedCost > 0 ? sum(dated.map((p) => Math.abs(costOf(p)) * daysHeld(p))) / datedCost : mean(dated.map(daysHeld)));
    const open = dated.map((p) => p.open).sort()[0] ?? null;
    return {
      id: first.id,
      ids: records.map((p) => p.id),
      ticker: first.ticker,
      dir: first.dir,
      cls: first.cls,
      open,
      close: first.close,
      qty,
      exit: qty > 0 ? sum(records.map((p) => Math.abs(Number(p.qty) || 0) * (Number(p.cur) || 0))) / qty : 0,
      pnl,
      cost,
      ret: cost > 0 ? (pnl / cost) * 100 : 0,
      days,
      outcome: outcomeOf(pnl),
      mind: records.map((p) => cleanMind(p.mind)).find((m) => m != null) ?? null,
      sector: sectorOf(first),
      weekday: open ? new Date(`${open}T12:00:00Z`).getUTCDay() : null,
      // Each record's life, for its S&P twin; only when every record knows when it began.
      lives: dated.length === records.length ? records.map((p) => tradeLife(p)) : null,
    };
  }).sort((x, y) => x.close.localeCompare(y.close) || String(x.open ?? '').localeCompare(String(y.open ?? '')));
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
    const twins = ix.dates.length && t.lives ? t.lives.map((life) => twinOfLife(life, ix, today)) : null;
    const twin = twins && twins.every(Boolean) ? { pnl: sum(twins.map((x) => x.pnl)), paid: sum(twins.map((x) => x.paid)) } : null;
    const rows = series.get(t.ticker);
    let stock10 = null;
    let dipped = null;
    if (rows?.length && t.open) {
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
      spx5: t.open ? indexBefore(ix, t.open) : null,
      stock10: t.dir === 'Short' ? null : stock10,
      dipped,
      fg: fearGreed.length && t.cls !== 'Crypto' && t.open ? readingOn(fearGreed, fgDates, t.open) : null,
      news: t.open ? newsDays.has(t.open) : null,
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
  ['quick', (t) => (t.days != null ? t.days <= 2 : null), 'were closed within two days'],
  ['long', (t) => (t.days != null ? t.days > 30 : null), 'were held for more than a month'],
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
 * A position's year: everything held on 31 December enters at that day's
 * close, as if bought then, and the year's own buys and sales follow. This is
 * how a holding carried into the year is measured over the year alone, the way
 * the account's year to date measures it. The close on 31 December comes from
 * the stock's own daily closes, put in the trade's terms (its split-adjusted
 * close scaled to the last price the trade knows); without them the position
 * cannot be measured and is counted apart.
 */
export function yearLife(p, yearStart, prices, today) {
  const life = tradeLife(p);
  const before = (e) => e.d <= yearStart;
  const buys = life.buys.filter((b) => !before(b));
  const sells = life.sells.filter((x) => !before(x));
  const heldThen = sum(life.buys.filter(before).map((b) => b.qty)) - sum(life.sells.filter(before).map((x) => x.qty));
  if (!buys.length && !sells.length && !(heldThen > 1e-9)) return null;
  const entry = [];
  if (heldThen > 1e-9) {
    const rows = prices?.get(p.ticker);
    if (!rows?.length) return { missing: true };
    const lastSale = life.sells[life.sells.length - 1];
    const [endDay, endPrice] = life.held > 0 ? [today, life.price] : [lastSale?.d, lastSale?.price];
    const k = endDay ? at(rowDates(rows), endDay) : -1;
    const k0 = at(rowDates(rows), yearStart);
    if (k < 0 || k0 < 0 || !(rows[k].close > 0) || !(endPrice > 0)) return { missing: true };
    entry.push({ d: yearStart, qty: heldThen, price: rows[k0].close * (endPrice / rows[k].close) });
  }
  return { ...life, buys: [...entry, ...buys], sells };
}

/** What a life made: what is held now at its price, plus what the sales brought in, less what the buys cost. */
const lifePnl = (life) => life.dir * (life.held * life.price + sum(life.sells.map((x) => x.qty * x.price)) - sum(life.buys.map((b) => b.qty * b.price)));

/** One spelling for a symbol: IBKR writes "BRK B", the app "BRK.B", Yahoo "BRK-B". */
const symbolKey = (t) => String(t ?? '').toUpperCase().replace(/[\s.\-/]/g, '');

/**
 * The year from the broker's own ledger (November 2026), when there is one.
 *
 * A statement import folds a year's purchases into a position's average
 * price, so a holding added to in the year looked, from the positions alone,
 * as if every share had been held on 31 December at that day's price: ETHA,
 * bought down to $12–17 through 2026 and sold near $20, read −$856 where IBKR
 * says +$304. The ledger keeps every purchase and sale with its date and
 * price, and what was held on 31 December with IBKR's own price for it, all
 * in today's share terms (the import restates them across splits). So each
 * symbol's year is read from it: the holding on 31 December entered at that
 * price, then every trade as it happened, then what is held now at today's
 * price. Trades entered in the app after the last statement join it.
 *
 * Returns { items, unmeasured } or null when there is no ledger for the year.
 */
export function ledgerYear({ ledger, positions, prices, yearStart, today }) {
  if (!ledger?.from || !(ledger.from <= addDays(yearStart, 1))) return null;
  const opensOnYear = ledger.from > yearStart;
  const bySymbol = new Map((positions ?? []).filter((p) => p?.ticker).map((p) => [symbolKey(p.ticker), p]));
  const current = (key) => [...(positions ?? [])].filter((p) => symbolKey(p.ticker) === key && p.status !== 'Closed' && p.cur > 0)[0];

  // Every share-moving event, the app's own after the last statement, in date order.
  const events = [
    ...(ledger.events ?? []).filter((e) => (e.kind === 'trade' || e.kind === 'transfer') && e.ticker && Number.isFinite(e.qty)),
    ...appTradeEventsAfter(positions, ledger.to),
  ].map((e) => ({ ...e, key: symbolKey(e.ticker) })).sort((a, b) => a.date.localeCompare(b.date));

  // What was held on 31 December: the opening holdings, rolled on to the year if the ledger starts earlier.
  const held = new Map(Object.entries(ledger.openingHoldings ?? {}).map(([t, q]) => [symbolKey(t), Number(q) || 0]));
  if (!opensOnYear) for (const e of events) if (e.date <= yearStart) held.set(e.key, (held.get(e.key) ?? 0) + e.qty);
  const marks = new Map(Object.entries(ledger.openingMarks ?? {}).map(([t, v]) => [symbolKey(t), Number(v)]));

  const keys = new Set([...[...held].filter(([, q]) => Math.abs(q) > 1e-9).map(([k]) => k), ...events.filter((e) => e.date > yearStart).map((e) => e.key)]);
  const items = [];
  const unmeasured = [];
  for (const key of keys) {
    const p = bySymbol.get(key);
    const ticker = p?.ticker ?? events.find((e) => e.key === key)?.ticker ?? key;
    const series = prices?.get(p?.ticker ?? ticker);
    const seriesOn = (d) => { if (!series?.length) return null; const i = at(rowDates(series), d); return i >= 0 ? series[i].close : null; };
    const start = held.get(key) ?? 0;
    let startPrice = null;
    if (Math.abs(start) > 1e-9) {
      startPrice = opensOnYear && marks.get(key) > 0 ? marks.get(key) : seriesOn(yearStart);
      if (!(startPrice > 0)) { unmeasured.push({ ticker, why: 'no price for 31 December' }); continue; }
    }
    const mine = events.filter((e) => e.key === key && e.date > yearStart);
    let h = start;
    const dir = (start || mine.find((e) => e.qty)?.qty || 1) < 0 ? -1 : 1;
    const buys = Math.abs(start) > 1e-9 ? [{ d: yearStart, qty: Math.abs(start), price: startPrice }] : [];
    const sells = [];
    let priced = true;
    for (const e of mine) {
      const price = e.price > 0 ? e.price : seriesOn(e.date);
      if (!(price > 0)) { priced = false; break; }
      const grows = h === 0 || Math.sign(e.qty) === Math.sign(h);
      if (grows) buys.push({ d: e.date, qty: Math.abs(e.qty), price });
      else {
        const shrink = Math.min(Math.abs(e.qty), Math.abs(h));
        sells.push({ d: e.date, qty: shrink, price });
        if (Math.abs(e.qty) > shrink) buys.push({ d: e.date, qty: Math.abs(e.qty) - shrink, price });
      }
      h += e.qty;
    }
    if (!priced) { unmeasured.push({ ticker, why: 'a trade without a price' }); continue; }
    const now = Math.abs(h) > 1e-9;
    const nowPrice = now ? current(key)?.cur ?? seriesOn(today) : 0;
    if (now && !(nowPrice > 0)) { unmeasured.push({ ticker, why: 'no price today' }); continue; }
    if (!buys.length) continue;
    items.push({
      id: p?.id ?? key, ticker,
      life: { dir, buys, sells, held: now ? Math.abs(h) : 0, price: nowPrice },
      close: now ? null : sells[sells.length - 1]?.d ?? null,
      live: now,
    });
  }
  return { items, unmeasured };
}

/** The app's own buys and sales after the last statement, as ledger trades. */
function appTradeEventsAfter(positions, after) {
  if (!after) return [];
  return appTradeEvents(positions, after);
}

/**
 * The S&P twin, trade by trade: every time you bought, the same money went
 * into the S&P 500 that day, and came out as you sold. Open positions count
 * to today.
 *  - This year: every position held during the year, from its value at the
 *    close on 31 December (or from the day it was bought, if later), so the
 *    holdings carried into the year count, as they do in the year to date.
 *  - All time: every trade over its whole life, from the day it was opened.
 * The whole-account comparison (every deposit into the S&P, held) rides along:
 * it also counts cash left idle and time out of the market.
 */
function twin(history, ix, trades, open, today, prices, positions, ledger, yearPnl = null) {
  const periods = {};
  const yearStart = `${Number(today.slice(0, 4)) - 1}-12-31`;
  const fromLedger = ledgerYear({ ledger, positions, prices, yearStart, today });
  const yearItems = [];
  // Every position of the year that cannot be measured is named, never dropped in silence.
  const unmeasured = fromLedger ? [...fromLedger.unmeasured] : [];
  for (const item of fromLedger?.items ?? []) {
    const t = twinOfLife(item.life, ix, today);
    if (!t) { unmeasured.push({ ticker: item.ticker, why: 'no S&P 500 price for its dates' }); continue; }
    const you = lifePnl(item.life);
    yearItems.push({ ...item, cost: t.paid, open: item.life.buys[0].d, you, spx: t.pnl, ret: t.paid > 0 ? (you / t.paid) * 100 : null, spxRet: t.paid > 0 ? (t.pnl / t.paid) * 100 : null });
  }
  for (const p of fromLedger ? [] : positions ?? []) {
    if (!p?.ticker) continue;
    const closed = p.status === 'Closed';
    if (closed && !(p.close > yearStart)) continue;
    // An imported short can carry its share count as a negative number.
    if (!(Math.abs(Number(p.qty)) > 0) || !(p.entry > 0)) { unmeasured.push({ ticker: p.ticker, why: 'no share count or price recorded' }); continue; }
    const life = yearLife(p, yearStart, prices, today);
    if (!life) continue;
    if (life.missing) { unmeasured.push({ ticker: p.ticker, why: 'its price history has not loaded' }); continue; }
    const t = twinOfLife(life, ix, today);
    if (!t) { unmeasured.push({ ticker: p.ticker, why: 'no S&P 500 price for its dates' }); continue; }
    const you = lifePnl(life);
    yearItems.push({
      id: p.id, ticker: p.ticker, life, cost: t.paid, open: life.buys[0].d, close: closed ? p.close : null,
      you, spx: t.pnl, ret: t.paid > 0 ? (you / t.paid) * 100 : null, spxRet: t.paid > 0 ? (t.pnl / t.paid) * 100 : null, live: !closed,
    });
  }
  /**
   * All time, from the broker's ledger when there is one: since its first day,
   * what was held then at that day's price, then every trade as it happened,
   * the same reading as This year. Without one, every closed record that knows
   * when it began, and every open position.
   */
  const sinceStart = ledger?.from ? ledgerYear({ ledger, positions, prices, yearStart: addDays(ledger.from, -1), today }) : null;
  const allItems = [];
  if (sinceStart) {
    for (const item of sinceStart.items) {
      const t = twinOfLife(item.life, ix, today);
      if (!t) continue;
      const you = lifePnl(item.life);
      allItems.push({ ...item, cost: t.paid, open: item.life.buys[0].d, you, spx: t.pnl, ret: t.paid > 0 ? (you / t.paid) * 100 : null, spxRet: t.paid > 0 ? (t.pnl / t.paid) * 100 : null });
    }
  } else {
    for (const p of positions ?? []) {
      if (p?.status !== 'Closed' || !p.open || !p.close || !(p.entry > 0)) continue;
      const life = tradeLife(p);
      const t = ix.dates.length ? twinOfLife(life, ix, today) : null;
      if (!t) continue;
      const you = realized(p);
      allItems.push({ id: p.id, ticker: p.ticker, life, cost: t.paid, open: p.open, close: p.close, you, spx: t.pnl, ret: t.paid > 0 ? (you / t.paid) * 100 : null, spxRet: t.paid > 0 ? (t.pnl / t.paid) * 100 : null, live: false });
    }
    allItems.push(...open.filter((p) => p.spxPnl != null).map((p) => ({ id: p.id, ticker: p.ticker, life: p.life, cost: p.cost, open: p.open, close: null, you: p.pnl, spx: p.spxPnl, live: true })));
  }
  for (const [key, from, items] of [['year', `${today.slice(0, 4)}-01-01`, yearItems], ['all', sinceStart ? ledger.from : null, allItems]]) {
    const rows = items.map((r) => ({ ...r, diff: r.you - r.spx })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    if (!rows.length) continue;
    const closed = rows.filter((r) => !r.live);
    const you = sum(rows.map((r) => r.you));
    const spx = sum(rows.map((r) => r.spx));
    const traded = sum(rows.map((r) => r.cost));
    const byDiff = [...closed].sort((a, b) => b.diff - a.diff);
    const excess = closed.filter((r) => r.spxRet != null && r.ret != null).map((r) => r.ret - r.spxRet);
    const account = twinSeries(history, ix, from);
    const accEnd = account[account.length - 1];
    /**
     * This year at the top is the whole account, in the same dollars Home shows
     * under YTD, beside the same deposits in the S&P 500 on the same days: both
     * as gains, the money paid in taken out. The table below stays position by
     * position.
     */
    let whole = null;
    if (key === 'year' && yearPnl != null && account.length >= 2) {
      const flowOn = new Map(history.map((r) => [r.date, Number(r.externalCashFlow) || 0]));
      const first = account[0];
      let flows = 0;
      const series = account.map((pt, i) => {
        if (i) flows += flowOn.get(pt.date) ?? 0;
        return { date: pt.date, you: pt.you - first.you - flows, twin: pt.twin - first.twin - flows };
      });
      whole = { you: yearPnl, twin: series[series.length - 1].twin, series };
    }
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
      whole,
      unmeasured: key === 'year' ? unmeasured : [],
      // What the whole account made over the same span, to set the positions' total against.
      accountPnl: from && history.length ? periodReturnFromHistory(history, from, today)?.pnl ?? null : null,
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
  if (!periods.all && !periods.year) return null;
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

/**
 * What the stocks did after you sold them, over every sale since the journal
 * began (November 2026). Each sale counts once: the records an import keeps
 * for one stock sold on one day (one per tax lot) are one sale, and a closed
 * position with no opening date counts like any other. For each sale, the
 * stock's close 7 and 30 calendar days later against its close on the day you
 * sold (for a short, a fall is the stock moving your way); each average is the
 * sum of those moves over the number of sales that have that many days behind
 * them. Sales whose stock has no price history are counted apart.
 */
export function afterSold(positions, series) {
  const sales = new Map();
  for (const p of positions ?? []) {
    if (p?.status !== 'Closed' || !p.ticker || !p.close || !(p.cur > 0)) continue;
    const qty = Math.abs(Number(p.qty) || 0);
    if (!(qty > 0)) continue;
    const key = `${symbolKey(p.ticker)}|${p.close}|${p.dir === 'Short' ? 'S' : 'L'}`;
    const sale = sales.get(key) ?? { id: p.id, ids: [], ticker: p.ticker, close: p.close, dir: p.dir, qty: 0, value: 0, pnl: 0 };
    sale.ids.push(p.id);
    sale.qty += qty;
    sale.value += qty * p.cur;
    sale.pnl += realized(p);
    sales.set(key, sale);
  }
  const rows = [];
  let unpriced = 0;
  for (const sale of sales.values()) {
    const s = series.get(sale.ticker);
    const base = s?.length ? stockAt(s, sale.close) : null;
    // The stock's close on the day sold (or the last before it, within a long weekend).
    if (!base || !(base.close > 0) || ms(sale.close) - ms(s[base.i].date) > 4 * DAY) { unpriced += 1; continue; }
    const sign = sale.dir === 'Short' ? -1 : 1;
    const later = (n) => {
      const c = closeAfter(s, sale.close, n);
      return c != null ? (c / base.close - 1) * 100 * sign : null;
    };
    const week = later(7);
    if (week == null) continue;
    const month = later(30);
    const quarter = later(90);
    rows.push({ ...sale, outcome: outcomeOf(sale.pnl), week, month, quarter, money: month != null ? (sale.value * month) / 100 : null });
  }
  const full = rows.filter((r) => r.month != null);
  const long = rows.filter((r) => r.quarter != null);
  const base = {
    id: 'after', group: 'habits', topic: 'What happens after you sell',
    how: 'Every position you have closed since your first trade, each sale counted once (several records for one stock sold on one day are one sale). For each, the stock’s close 7, 30 and 90 days after the day you sold, against its close that day; for a short, a fall counts as the stock moving your way. Each average is the sum of those moves divided by the number of sales. In money: what you sold it for × the 30-day move. "Left on the table" adds up the stocks that kept moving your way; "saved" the ones that turned against you.',
  };
  if (full.length < MIN_GROUP) return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: MIN_GROUP - full.length, unit: 'sales at least a month old' } };
  const avgWeek = mean(rows.map((r) => r.week));
  const avgMonth = mean(full.map((r) => r.month));
  const avgQuarter = long.length ? mean(long.map((r) => r.quarter)) : null;
  const left = sum(full.filter((r) => r.money > 0).map((r) => r.money));
  const saved = -sum(full.filter((r) => r.money < 0).map((r) => r.money));
  const winners = full.filter((r) => r.outcome === 'win');
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
    data: [
      `1 week after you sold: ${pct(avgWeek)} on average, over ${plural(rows.length, 'sale')}.`,
      `1 month after you sold: ${pct(avgMonth)} on average, over ${plural(full.length, 'sale')}.`,
      ...(avgQuarter != null ? [`3 months after you sold: ${pct(avgQuarter)} on average, over ${plural(long.length, 'sale')}.`] : []),
      ...(early ? [`The winners you sold rose a further ${plainPct(winnersRan)} on average in the month after.`] : []),
    ].join('\n'),
    more: `Over the month after: ${plain$(left)} left on the table by the stocks that kept going your way, ${plain$(saved)} saved by getting out of those that turned.${unpriced ? ` ${plural(unpriced, 'sale')} could not be measured: no price history for the stock.` : ''}`,
    tone: early || avgMonth > 2 ? 'bad' : avgMonth < -2 ? 'good' : 'neutral',
    impact: Math.abs(left - saved),
    confidence: confidenceOne(full.map((r) => r.month)),
    bars: [['A week later', avgWeek], ['A month later', avgMonth], ...(avgQuarter != null ? [['3 months later', avgQuarter]] : [])],
    // Every sale and its moves, newest first, so the averages can be checked one by one.
    sales: [...rows].sort((a, b) => b.close.localeCompare(a.close)).map((r) => ({ ticker: r.ticker, close: r.close, week: r.week, month: r.month, quarter: r.quarter })),
    averages: { week: avgWeek, month: avgMonth, quarter: avgQuarter, weekCount: rows.length, monthCount: full.length, quarterCount: long.length },
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

/** "14 of 18 won (78%)": how often a group of trades worked out, flat trades left out. */
const wonLine = (ts) => {
  const decided = ts.filter((t) => t.outcome !== 'even');
  const won = decided.filter((t) => t.outcome === 'win').length;
  return `${won} of ${decided.length} won (${Math.round(share(won, decided.length))}%)`;
};
const isWin = (t) => (t.outcome === 'win' ? 1 : 0);

/**
 * Counted in wins and losses, as the weekday card is (November 2026): one
 * lucky trade that made 1,000% could otherwise decide the comparison alone.
 */
function moodAtEntry(trades) {
  const rated = trades.filter((t) => t.fg != null && t.outcome !== 'even');
  const fear = rated.filter((t) => t.fg < 45);
  const greed = rated.filter((t) => t.fg > 55);
  const base = {
    id: 'mood', group: 'habits', topic: 'The market\'s mood when you buy',
    how: 'CNN\'s Fear & Greed index (0 = extreme fear, 100 = extreme greed) on the day you opened each stock trade (crypto is left out: the index measures the stock market). Of the trades bought below 45 (fear) and above 55 (greed), the share that closed in profit. Only winning or losing counts, not by how much; flat trades are left out. The difference is checked against chance.',
  };
  if (fear.length < MIN_GROUP || greed.length < MIN_GROUP) {
    return { ...base, tone: 'neutral', impact: 0, confidence: { level: 'early', needed: Math.max(0, MIN_GROUP - fear.length) + Math.max(0, MIN_GROUP - greed.length), unit: 'stock trades bought in fear or greed' } };
  }
  const groups = MOODS.map(([label]) => ({ label, ts: rated.filter((t) => moodOf(t.fg) === label) })).filter((g) => g.ts.length);
  const f = winRate(fear);
  const g = winRate(greed);
  const worse = f < g ? fear : greed;
  return {
    ...base,
    headline: f > g ? 'You win more often buying when other investors are fearful' : 'You win more often buying when other investors are confident',
    matters: f > g ? 'Buying when others are nervous often means buying at better prices.' : 'Your trades work out more often when the market is in a good mood; fearful markets have been harder for you.',
    data: `Bought in fear: ${wonLine(fear)}. Bought in greed: ${wonLine(greed)}.`,
    more: `Your ${f < g ? 'fear' : 'greed'} trades added up to ${usd(sum(worse.map((t) => t.pnl)))}.`,
    tone: f > g ? 'good' : 'neutral',
    impact: Math.abs(sum(worse.map((t) => t.pnl))),
    confidence: confidence(fear, greed, isWin),
    bars: groups.map((x) => [x.label, winRate(x.ts)]),
    unit: 'rate',
    trades: ids(worse),
  };
}

/* ── emotional against confident ── */

function emotion(trades) {
  const rated = trades.filter((t) => t.mind != null && t.outcome !== 'even');
  const emotional = rated.filter((t) => t.mind <= 4);
  const confident = rated.filter((t) => t.mind >= 7);
  const base = {
    id: 'emotion', group: 'habits', topic: 'Your state of mind and your results',
    how: 'The state of mind you rated when opening each trade (1 = emotional, 10 = calm and confident). Of the trades rated 1–4 and those rated 7–10, the share that closed in profit. Only winning or losing counts, not by how much; flat trades, trades rated 5–6 and unrated trades are left out. The difference is checked against chance.',
  };
  if (emotional.length < MIN_GROUP || confident.length < MIN_GROUP) {
    return {
      ...base, tone: 'neutral', impact: 0,
      confidence: { level: 'early', needed: Math.max(0, MIN_GROUP - emotional.length) + Math.max(0, MIN_GROUP - confident.length), unit: 'rated trades' },
      hint: 'Rate your state of mind when you open a trade (New trade → State of mind).',
    };
  }
  const e = winRate(emotional);
  const c = winRate(confident);
  const why = whyOf(emotional, confident, ['emotional']);
  const total = sum(emotional.map((t) => t.pnl));
  return {
    ...base,
    headline: c > e ? 'Your calm, confident trades win more often' : 'Your emotional trades have won as often or more',
    matters: c > e ? 'Pausing to notice how you feel before a trade is one of the simplest ways to improve.' : 'Your instincts have served you well so far, even when you felt unsure.',
    data: `Confident (rated 7–10): ${wonLine(confident)}. Emotional (rated 1–4): ${wonLine(emotional)}.`,
    more: `Your emotional trades added up to ${usd(total)}; your confident trades ${usd(sum(confident.map((t) => t.pnl)))}.`,
    cause: why ? `Your emotional trades: ${why.text}` : null,
    tone: c > e ? 'good' : 'neutral',
    impact: Math.abs(total),
    confidence: confidence(emotional, confident, isWin),
    bars: [['Emotional', e], ['Confident', c]],
    unit: 'rate',
    trades: ids(emotional),
  };
}

/* ── how long you hold losers against winners ── */

function holding(all) {
  const trades = all.filter((t) => t.days != null);
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
  const lossDays = losses.filter((t) => t.days != null).map((t) => t.days);
  const typical = lossDays.length >= 3 ? median(lossDays) : null;
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

/** Who gets each style, in plain words, for the screen that shows every card. */
export const TITLE_RULES = {
  homerun: 'Wins under 45% of trades, but the wins are at least 3× the size of the losses.',
  sharpshooter: 'Wins more than 70% of trades.',
  sniper: 'Most trades close within a day, and more than 60% win.',
  adrenaline: 'Most trades close within a day, with big moves both ways.',
  scalper: 'Most trades close within a day.',
  labrat: '40 trades or more, across many different stocks, mostly small moves.',
  surfer: 'Holds for days to weeks, and often buys after a stock has already risen.',
  wave: 'Usually holds for days to weeks.',
  tortoise: 'Holds for months, calmer than the market, and ahead of it.',
  fortress: 'Holds for months, spread across 8 sectors or more.',
  hunter: 'Holds for months.',
  oak: 'Typically holds a trade for more than six months.',
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
  const timed = trades.filter((t) => t.days != null);
  const held = median(timed.map((t) => t.days));
  const dayShare = share(timed.filter((t) => t.days <= 1).length, timed.length);
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

/* ── achievements: a collection of 30 cards ──
 *
 * Personal accomplishments, collected once and kept: surviving a market fall,
 * a trade that doubled, a year held, a hundred trades. Each has a rarity, worth
 * points toward the level in the title (common 1, rare 2, epic 3, legendary 5),
 * and the date it was first earned. A card that cannot be judged from the data
 * on this device (no market history, no stock prices for the trade) stays
 * locked rather than being guessed.
 */

export const RARITY = { common: 1, rare: 2, epic: 3, legendary: 5 };

/** Levels by points; the next one is what the title's progress bar points to. */
export const LEVELS = [
  ['Rookie', 0],
  ['Apprentice', 5],
  ['Trader', 12],
  ['Pro', 22],
  ['Veteran', 35],
  ['Legend', 50],
];

export const FAMILIES = [
  ['survival', 'Market survival'],
  ['wins', 'Big wins and streaks'],
  ['patience', 'Patience and comebacks'],
  ['milestones', 'Milestones and discipline'],
];

/** The S&P 500's fall from its highest close so far, by day, from its price (not total return). */
function marketDrawdowns(index) {
  const out = new Map();
  let peak = 0;
  for (const r of index ?? []) {
    if (!r?.date || !(r.close > 0)) continue;
    peak = Math.max(peak, r.close);
    out.set(r.date, (r.close / peak - 1) * 100);
  }
  return out;
}

/** The first trade, in order of `key`, that passes `test`: its date is when the card was earned. */
const firstBy = (list, test, key) => [...list].filter(test).sort((a, b) => a[key].localeCompare(b[key]))[0] ?? null;

export function achievementsFor({ trades, open, positions, index, ix, paired, history, bigDays, today }) {
  const cards = [];
  const add = (family, key, icon, name, rarity, how, earned) => cards.push({
    family, key, icon, name, rarity, points: RARITY[rarity], how,
    earned: earned ? earned.date : null, detail: earned ? earned.detail : null,
  });
  const got = (date, detail) => (date ? { date, detail } : null);

  // Every holding as a span of days, closed or still open.
  const spans = [
    ...trades.filter((t) => t.open).map((t) => ({ ticker: t.ticker, from: t.open, to: t.close })),
    ...open.map((p) => ({ ticker: p.ticker, from: p.open, to: today })),
  ];
  const heldOn = (date) => spans.find((s) => s.from <= date && date <= s.to) ?? null;

  /* market survival */
  const falls = marketDrawdowns(index);
  const marketDay = (test) => [...falls].find(([date, dd]) => test(dd, date) && heldOn(date)) ?? null;
  const correction = marketDay((dd) => dd <= -10);
  add('survival', 'correction', '🛡️', 'Correction Survivor', 'rare',
    'Hold a position while the S&P 500 is 10% or more below its high.',
    correction && got(correction[0], `The S&P 500 was ${Math.abs(correction[1]).toFixed(1)}% below its high, and you held ${heldOn(correction[0]).ticker}.`));
  const bear = marketDay((dd) => dd <= -20);
  add('survival', 'bear', '🐻', 'Bear Survivor', 'legendary',
    'Hold a position through a bear market: the S&P 500 20% or more below its high.',
    bear && got(bear[0], `The S&P 500 was ${Math.abs(bear[1]).toFixed(1)}% below its high, and you held ${heldOn(bear[0]).ticker}.`));
  const crashDays = [...ix.daily].filter(([, r]) => r <= -3);
  const storm = crashDays.find(([date]) => heldOn(date));
  add('survival', 'storm', '🌪️', 'Storm Rider', 'rare',
    'Hold a position on a day the S&P 500 falls 3% or more.',
    storm && got(storm[0], `The S&P 500 fell ${Math.abs(storm[1]).toFixed(1)}% that day, and you held ${heldOn(storm[0]).ticker}.`));
  const beatCrash = paired.find((d) => d.spx <= -3 && d.ret > 0);
  add('survival', 'crashproof', '🧯', 'Crash-Proof', 'epic',
    'Finish a day in the green while the S&P 500 falls 3% or more.',
    beatCrash && got(beatCrash.date, `The S&P 500 fell ${Math.abs(beatCrash.spx).toFixed(1)}%; your account rose ${beatCrash.ret.toFixed(2)}%.`));
  const dip = firstBy(trades, (t) => t.open && (ix.daily.get(t.open) ?? 0) <= -2 && t.outcome === 'win', 'close');
  add('survival', 'dip', '🛒', 'Bought the Dip', 'epic',
    'Buy on a day the S&P 500 falls 2% or more, and close that trade in profit.',
    dip && got(dip.close, `${dip.ticker}, bought on a ${Math.abs(ix.daily.get(dip.open)).toFixed(1)}% down day, closed ${pct(dip.ret)}.`));
  const fedDays = new Set((bigDays ?? []).filter((b) => b.kind === 'Fed decision').map((b) => b.date));
  const fed = firstBy([...trades, ...open].filter((t) => t.open), (t) => fedDays.has(t.open), 'open');
  add('survival', 'fed', '🏛️', 'Fed Day Trader', 'common',
    'Open a trade on the day the Fed announces its interest-rate decision.',
    fed && got(fed.open, `${fed.ticker}, opened on a Fed decision day.`));

  /* big wins and streaks */
  const doubler = firstBy(trades, (t) => t.ret >= 100, 'close');
  add('wins', 'doubler', '🚀', 'Doubler', 'epic', 'Close a trade up 100% or more.',
    doubler && got(doubler.close, `${doubler.ticker}, ${pct(doubler.ret, 0)}.`));
  const tenbag = firstBy(trades, (t) => t.ret >= 1000, 'close');
  add('wins', 'tenbagger', '🌕', 'Ten-Bagger', 'legendary', 'Close a trade up 1,000% or more.',
    tenbag && got(tenbag.close, `${tenbag.ticker}, ${pct(tenbag.ret, 0)}.`));
  const four = firstBy(trades, (t) => t.pnl >= 1000, 'close');
  add('wins', 'fourfigures', '💵', 'Four Figures', 'rare', 'Make $1,000 or more on a single trade.',
    four && got(four.close, `${four.ticker}, ${usd(four.pnl)}.`));
  const five = firstBy(trades, (t) => t.pnl >= 10000, 'close');
  add('wins', 'fivefigures', '💰', 'Five Figures', 'epic', 'Make $10,000 or more on a single trade.',
    five && got(five.close, `${five.ticker}, ${usd(five.pnl)}.`));
  const streakAt = (n) => {
    let run = 0;
    for (const t of trades) {
      if (t.outcome === 'win') run += 1;
      else if (t.outcome === 'loss') run = 0;
      if (run >= n) return t;
    }
    return null;
  };
  const hot = streakAt(5);
  add('wins', 'hotstreak', '🔥', 'Hot Streak', 'rare', 'Win 5 trades in a row.', hot && got(hot.close, 'Five winning trades in a row.'));
  const ten = streakAt(10);
  add('wins', 'unstoppable', '☄️', 'Unstoppable', 'legendary', 'Win 10 trades in a row.', ten && got(ten.close, 'Ten winning trades in a row.'));
  const weeks = new Map();
  for (const t of trades) weeks.set(mondayOf(t.close), [...(weeks.get(mondayOf(t.close)) ?? []), t]);
  const perfect = [...weeks].filter(([, ts]) => ts.length >= 3 && ts.every((t) => t.outcome === 'win')).sort((a, b) => a[0].localeCompare(b[0]))[0];
  add('wins', 'perfectweek', '✨', 'Perfect Week', 'rare', 'Close 3 or more trades in one week, all of them winners.',
    perfect && got(addDays(perfect[0], 4), `${perfect[1].length} trades closed in the week of ${shortDate(perfect[0])}, all winners.`));
  let beatYear = null;
  for (let y = Number((history[0]?.date ?? today).slice(0, 4)); y < Number(today.slice(0, 4)); y++) {
    const you = periodReturnFromHistory(history, `${y}-01-01`, `${y}-12-31`);
    const spx = indexBetween(ix, `${y - 1}-12-31`, `${y}-12-31`);
    if (you && spx != null && you.returnPct > spx) { beatYear = { y, you: you.returnPct, spx }; break; }
  }
  add('wins', 'marketbeater', '🏆', 'Market Beater', 'legendary', 'Beat the S&P 500 over a full calendar year.',
    beatYear && got(`${beatYear.y}-12-31`, `${beatYear.y}: you ${pct(beatYear.you)}, the S&P 500 ${pct(beatYear.spx)}.`));

  /* patience and comebacks */
  const held = [...trades.map((t) => ({ ...t, end: t.close, live: false })), ...open.map((p) => ({ ...p, end: today, live: true }))].filter((t) => t.open && t.days != null);
  const reached = (t, n) => addDays(t.open, n);
  const year = firstBy(held, (t) => t.days >= 365, 'open');
  add('patience', 'oneyear', '⏳', 'One-Year Club', 'rare', 'Hold a position for a full year.',
    year && got(reached(year, 365), `${year.ticker}, held ${plural(year.days, 'day')}${year.live ? ' and counting' : ''}.`));
  const three = firstBy(held, (t) => t.days >= 1095, 'open');
  add('patience', 'longhaul', '🌳', 'Long Haul', 'epic', 'Hold a position for three years.',
    three && got(reached(three, 1095), `${three.ticker}, held ${plural(three.days, 'day')}${three.live ? ' and counting' : ''}.`));
  const iron = firstBy(held, (t) => t.days >= 365 && t.pnl < 0, 'open');
  add('patience', 'ironwill', '🪨', 'Iron Will', 'rare', 'Keep a position for over a year while it is below what you paid.',
    iron && got(reached(iron, 365), `${iron.ticker}, ${plural(iron.days, 'day')} at ${pct(iron.ret)}${iron.live ? ', still holding' : ''}.`));
  const diamond = firstBy(trades, (t) => t.dipped != null && t.dipped <= -20 && t.outcome === 'win', 'close');
  add('patience', 'diamond', '💎', 'Diamond Hands', 'rare', 'Hold through a fall of 20% or more and still close in profit.',
    diamond && got(diamond.close, `${diamond.ticker} fell ${Math.abs(diamond.dipped).toFixed(0)}% while you held it, and closed ${pct(diamond.ret)}.`));
  const phoenix = firstBy(trades, (t) => t.dipped != null && t.dipped <= -50 && t.outcome === 'win', 'close');
  add('patience', 'phoenix', '🐦‍🔥', 'Phoenix', 'legendary', 'Hold through a fall of 50% or more and still close in profit.',
    phoenix && got(phoenix.close, `${phoenix.ticker} fell ${Math.abs(phoenix.dipped).toFixed(0)}% while you held it, and closed ${pct(phoenix.ret)}.`));
  const pays = firstBy(trades, (t) => t.days != null && t.days >= 182 && t.ret >= 50, 'close');
  add('patience', 'patiencepays', '🐢', 'Patience Pays', 'epic', 'Hold a trade for six months or more and close it up 50% or more.',
    pays && got(pays.close, `${pays.ticker}, ${plural(pays.days, 'day')}, ${pct(pays.ret)}.`));
  const months = [];
  for (const [key, m] of monthlyReturns(history)) {
    if (m.partial) continue;
    const end = isoOf(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0));
    if (end >= today) continue;
    const spx = indexBetween(ix, addDays(`${key}-01`, -1), end);
    if (spx != null) months.push({ key, end, ahead: m.returnPct > spx });
  }
  let run = 0;
  let steady = null;
  for (const m of months) {
    run = m.ahead ? run + 1 : 0;
    if (run >= 3) { steady = m; break; }
  }
  add('patience', 'steady', '🧭', 'Steady Hand', 'epic', 'Beat the S&P 500 three months in a row.',
    steady && got(steady.end, `Three months in a row ahead of the S&P 500, to ${monthName(steady.key)}.`));

  /* milestones and discipline */
  const nth = (n) => trades[n - 1] ?? null;
  for (const [n, key, icon, name, rarity] of [
    [1, 'first', '🎉', 'First Step', 'common'],
    [10, 'ten', '🔟', 'Getting Started', 'common'],
    [50, 'fifty', '📈', 'Seasoned', 'rare'],
    [100, 'hundred', '💯', 'Centurion', 'epic'],
  ]) {
    const t = nth(n);
    add('milestones', key, icon, name, rarity, n === 1 ? 'Close your first trade.' : `Close ${n} trades.`,
      t && got(t.close, n === 1 ? `${t.ticker}, ${pct(t.ret)}.` : `Your ${n}th closed trade was ${t.ticker}.`));
  }
  const bySector = [...(positions ?? [])].filter((p) => p?.open).sort((a, b) => a.open.localeCompare(b.open));
  const seen = new Set();
  let explorer = null;
  for (const p of bySector) {
    const s = sectorOf(p);
    if (s !== 'Other') seen.add(s);
    if (seen.size >= 5) { explorer = p; break; }
  }
  add('milestones', 'explorer', '🗺️', 'Explorer', 'common', 'Trade in 5 different sectors.',
    explorer && got(explorer.open, `Your fifth sector: ${sectorOf(explorer)}.`));
  const crypto = bySector.find((p) => p.cls === 'Crypto');
  add('milestones', 'crypto', '₿', 'Crypto Pioneer', 'common', 'Make your first crypto trade.',
    crypto && got(crypto.open, `${crypto.ticker}.`));
  const short = firstBy(trades, (t) => t.dir === 'Short' && t.outcome === 'win', 'close');
  add('milestones', 'short', '🐻‍❄️', 'Short Seller', 'rare', 'Close a short trade in profit.',
    short && got(short.close, `${short.ticker}, ${usd(short.pnl)}.`));
  const rated = [...(positions ?? [])].filter((p) => p?.open && cleanMind(p.mind) != null).sort((a, b) => a.open.localeCompare(b.open));
  add('milestones', 'journal', '📓', 'Journal Keeper', 'rare', 'Rate your state of mind on 30 trades.',
    rated[29] && got(rated[29].open, '30 trades with your state of mind written down.'));
  const small = trades.filter((t) => t.outcome === 'loss' && t.ret >= -5);
  add('milestones', 'smalllosses', '✂️', 'Cut Your Losses', 'rare', 'Close 10 losing trades before they lose more than 5%.',
    small[9] && got(small[9].close, '10 losing trades each closed within 5% of what you paid.'));

  const points = sum(cards.filter((c) => c.earned).map((c) => c.points));
  const lvl = LEVELS.reduce((found, l, i) => (points >= l[1] ? i : found), 0);
  const next = LEVELS[lvl + 1] ?? null;
  return {
    cards,
    earned: cards.filter((c) => c.earned).length,
    total: cards.length,
    points,
    level: LEVELS[lvl][0],
    next: next ? { name: next[0], points: next[1], from: LEVELS[lvl][1] } : null,
  };
}

/* ── what stands out, and the summary ── */

/**
 * The three things to show first: the strongest edge (the largest strength in
 * money), the biggest area to improve, and the most interesting remaining
 * pattern. Only facts and patterns unlikely to be chance qualify.
 */
function standOut(cards) {
  // "When the market falls" stays in Your habits only: at the top it read as the same card twice (Romy, November 2026).
  const ranked = cards.filter((c) => c.group !== 'market' && c.id !== 'down' && c.headline && c.confidence?.level !== 'early' && solid(c.confidence))
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
  // In money, the same comparison as the percentages: the whole account against
  // every deposit put into the S&P 500 on the same day, over the same year.
  const acc = twinCard?.twin?.year?.account;
  if (acc && year?.you != null) {
    parts.push(acc.diff >= 0
      ? `In money, that is about ${plain$(acc.diff)} more than the same deposits would have made in the S&P 500.`
      : `In money, the same deposits in the S&P 500 would have made about ${plain$(-acc.diff)} more.`);
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
  accountValue = null, year = null, ledger = null, today = new Date(),
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

  const twinCard = twin(history, ix, trades, open, day, series, positions, ledger, year?.pnl ?? null);
  const swingCard = swings(paired);
  const cards = [
    twinCard,
    // Your habits
    downMarket(paired),
    afterSold(positions, series),
    holding(trades),
    emotion(trades),
    moodAtEntry(trades),
    // Explore deeper
    monthsVsIndex(history, ix, day),
    deepestDrop(days, ix),
    swingCard,
    accountWeekdays(paired),
    bigNewsDays(paired, bigDays),
  ].filter(Boolean);

  const yearTwin = twinCard?.twin?.year?.account ?? twinCard?.twin?.all?.account ?? null;
  const sectors = new Set(trades.map((t) => t.sector).filter((s) => s !== 'Other')).size;
  const title = traderTitle(trades, { twinAhead: yearTwin ? yearTwin.diff > 0 : null, calmer: swingCard?.calmer ?? null, sectors });
  const collection = achievementsFor({ trades, open, positions, index, ix, paired, history, bigDays, today: day });
  const picks = standOut(cards);

  return {
    trades: trades.length,
    needed: Math.max(0, MIN_TRADES - trades.length),
    winRate: trades.length ? winRate(trades) : null,
    year: year ?? { you: null, spx: null },
    summary: summaryOf({ year, twinCard, cards, picks, trades: trades.length, days: days.length }),
    standOut: picks,
    // One main title: the level earned by collecting, and the style from how you trade.
    profile: { title, level: collection.level, collection, records: records(days, history, trades, weeks) },
    cards,
    now: openBook(open, trades, accountValue),
  };
}
