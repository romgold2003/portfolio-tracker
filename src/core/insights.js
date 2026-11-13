/**
 * Insights, the personal analyst (November 2026): everything a person's own
 * trades and account say about them, read the way an analyst would — what
 * happened, why it seems to have happened, and what it meant in money.
 *
 * Observations about the past, never advice about what to buy or sell (the
 * Terms are explicit that nothing in Riskbook is advice). Worked out here, on
 * the device; nothing about the person is sent anywhere. The market side
 * (S&P 500 total return, Fear & Greed, big-news days, each stock's closes) is
 * the same public data for everyone.
 *
 * Two rules keep it honest, the same two every indicator in this project had
 * to pass:
 *  - Enough evidence. A comparison needs MIN_GROUP on each side, and anything
 *    about the trades MIN_TRADES closed trades; until then it says how many more.
 *  - Better than chance. A difference is checked against the same values
 *    dealt at random (a permutation test). Under 5%: "Strong". Under 20%:
 *    "Likely". Otherwise "Possible" — a hint, never a fact. Plain facts (last
 *    week, the months, records) carry no label: they are just what happened.
 *
 * "Why" is measured, not guessed: each trade carries its context (the S&P's
 * five days before entry, the stock's own two weeks before, the market's mood,
 * big-news days, size, holding time, state of mind) and a pattern's "why" is
 * the context its trades share far more often than the rest. When nothing
 * stands out, it says so.
 */
import { realized, costOf, outcomeOf, marketValueOf, unreal } from './portfolio.js';
import { cleanMind } from './mind.js';
import { sectorOf } from '../config/sectors.js';
import { dayGrowth, measurable, monthlyReturns, periodReturnFromHistory } from './portfolioHistory.js';

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
const pts = (n) => `${Math.abs(n).toFixed(1)} point${Math.abs(n).toFixed(1) === '1.0' ? '' : 's'}`;
const usd = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const plain$ = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const ids = (ts) => ts.map((t) => t.id);
const tone = (n) => (n > 0 ? 'good' : n < 0 ? 'bad' : 'neutral');
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

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

export function levelOn(ix, date) {
  const i = at(ix.dates, date);
  return i >= 0 ? ix.level[i] : null;
}

/** The S&P's total return from one day's close to another's, in per cent; null before the series begins. */
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

/** The account day by day: each day's return (deposits taken out), profit and value. */
export function accountDays(rows) {
  const out = [];
  for (let i = 1; i < (rows?.length ?? 0); i++) {
    const prev = rows[i - 1];
    const row = rows[i];
    if (!row?.date || !measurable(prev, row)) continue;
    const flow = Number(row.externalCashFlow) || 0;
    const g = dayGrowth(prev.totalAccountValue, row.totalAccountValue, flow, row.joinedAtClose);
    out.push({ date: row.date, ret: (g - 1) * 100, pnl: row.totalAccountValue - (prev.totalAccountValue || 0) - flow, value: row.totalAccountValue });
  }
  return out;
}

/** Days the market traded, with the account's move and the S&P's side by side. */
function pairDays(days, ix) {
  return days.filter((d) => ix.daily.has(d.date)).map((d) => ({ ...d, spx: ix.daily.get(d.date) }));
}

/* ── the trades ── */

/** A closed trade as the analyst reads it. */
export function tradesOf(positions) {
  return (positions ?? [])
    .filter((p) => p?.status === 'Closed' && p.open && p.close)
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
      };
    })
    .sort((a, b) => a.close.localeCompare(b.close) || a.open.localeCompare(b.open));
}

/** The reading on or before a date (within five days) from a sorted [{ date, value }] list. */
function readingOn(list, dates, date) {
  const i = at(dates, date);
  return i >= 0 && ms(date) - ms(list[i].date) <= 5 * DAY ? list[i].value : null;
}

/** A stock's close on or before a date, and its position, from its daily rows. */
function stockAt(rows, date) {
  const i = at(rows.map((r) => r.date), date);
  return i >= 0 ? { i, close: rows[i].close } : null;
}

/**
 * Each trade's context: what the S&P had done in the five days before entry,
 * what the stock itself had done in the two weeks before, the market's mood,
 * whether it was a big-news day, its size against the rest, and how the S&P
 * did over the same days.
 */
function enrich(trades, { ix, fearGreed, newsDays, series }) {
  const sizes = trades.map((t) => t.cost).sort((a, b) => a - b);
  const bigFrom = sizes[Math.floor(sizes.length * 0.8)] ?? Infinity;
  const fgDates = fearGreed.map((x) => x.date);
  return trades.map((t) => {
    const spxRet = indexBetween(ix, t.open, t.close);
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
      spxRet,
      spxPnl: spxRet != null ? (t.cost * spxRet) / 100 : null,
      spx5: indexBefore(ix, t.open),
      stock10: t.dir === 'Short' ? null : stock10,
      dipped,
      fg: fearGreed.length ? readingOn(fearGreed, fgDates, t.open) : null,
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
  ['spxUp', (t) => (t.spx5 != null ? t.spx5 >= 1.5 : null), 'came after the S&P had risen 1.5%+ in the five days before'],
  ['spxDown', (t) => (t.spx5 != null ? t.spx5 <= -1.5 : null), 'came after the S&P had fallen 1.5%+ in the five days before'],
  ['chase', (t) => (t.stock10 != null ? t.stock10 >= 10 : null), 'were bought after the stock had already risen 10%+ in two weeks'],
  ['dip', (t) => (t.stock10 != null ? t.stock10 <= -10 : null), 'were bought after the stock had fallen 10%+ in two weeks'],
  ['emotional', (t) => (t.mind != null ? t.mind <= 4 : null), 'were rated emotional or impulsive (1–4)'],
  ['fear', (t) => (t.fg != null ? t.fg < 45 : null), 'were bought while the market was in Fear'],
  ['greed', (t) => (t.fg != null ? t.fg > 55 : null), 'were bought while the market was in Greed'],
  ['news', (t) => t.news, 'were opened on a big-news day (Fed, CPI or jobs report)'],
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

const NO_CAUSE = 'Nothing measured (the market before entry, the stock\'s run-up, mood, news days, size, holding time) sets these trades apart. It may be chance.';

/* ── #1 the best and worst day to open a trade ── */

function weekdayTrades(trades) {
  const days = [1, 2, 3, 4, 5].map((d) => ({ d, ts: trades.filter((t) => t.weekday === d) }));
  const usable = days.filter((x) => x.ts.length >= 3);
  if (usable.length < 2) return null;
  const avg = (x) => mean(x.ts.map((t) => t.ret));
  const worst = usable.reduce((a, b) => (avg(b) < avg(a) ? b : a));
  const best = usable.reduce((a, b) => (avg(b) > avg(a) ? b : a));
  const rest = trades.filter((t) => t.weekday !== worst.d);
  const why = whyOf(worst.ts, rest);
  const total = sum(worst.ts.map((t) => t.pnl));
  return {
    id: 'weekday',
    section: 'calendar',
    title: `${WEEKDAYS[best.d]} is your best day to open a trade (${pct(avg(best))} a trade); ${WEEKDAYS[worst.d]} your worst (${pct(avg(worst))})`,
    why: why ? `Your ${WEEKDAYS[worst.d]} trades: ${why.text}` : NO_CAUSE,
    matters: `${plural(worst.ts.length, 'trade')} opened on a ${WEEKDAYS[worst.d]}, ${usd(total)} in total.`,
    tone: avg(worst) < 0 ? 'bad' : 'neutral',
    impact: Math.abs(total),
    confidence: confidence(worst.ts, rest),
    bars: days.map((x) => [WEEKDAYS[x.d].slice(0, 3), x.ts.length ? avg(x) : 0]),
    trades: ids(worst.ts),
  };
}

/* ── #2 the account by weekday ── */

function accountWeekdays(paired) {
  if (paired.length < 40) return null;
  const days = [1, 2, 3, 4, 5].map((d) => {
    const ds = paired.filter((x) => new Date(`${x.date}T12:00:00Z`).getUTCDay() === d);
    return { d, ds, you: mean(ds.map((x) => x.ret)), spx: mean(ds.map((x) => x.spx)) };
  }).filter((x) => x.ds.length);
  const worst = days.reduce((a, b) => (b.you < a.you ? b : a));
  const best = days.reduce((a, b) => (b.you > a.you ? b : a));
  const rest = paired.filter((x) => !worst.ds.includes(x));
  const marketToo = days.reduce((a, b) => (b.spx < a.spx ? b : a)).d === worst.d;
  const total = sum(worst.ds.map((x) => x.pnl));
  return {
    id: 'account-weekday',
    section: 'calendar',
    title: `Your account does best on ${WEEKDAYS[best.d]}s (${pct(best.you, 2)} a day) and worst on ${WEEKDAYS[worst.d]}s (${pct(worst.you, 2)})`,
    why: marketToo
      ? `The S&P is weakest on ${WEEKDAYS[worst.d]}s too (${pct(worst.spx, 2)} a day over the same days): it is the market, more than your book.`
      : `The S&P averages ${pct(worst.spx, 2)} on ${WEEKDAYS[worst.d]}s over the same days, so the weakness is in your holdings, not the market.`,
    matters: `Your ${WEEKDAYS[worst.d]}s added up to ${usd(total)} over ${plural(worst.ds.length, 'trading day')}.`,
    tone: worst.you < 0 && !marketToo ? 'bad' : 'neutral',
    impact: Math.abs(total),
    confidence: confidence(worst.ds, rest, (x) => x.ret),
    bars: days.map((x) => [WEEKDAYS[x.d].slice(0, 3), x.you]),
    unit: 'pct2',
  };
}

/* ── #4 big-news days ── */

function bigNewsDays(paired, bigDays) {
  const kinds = new Map();
  for (const b of bigDays ?? []) {
    if (b?.date) kinds.set(b.date, [...(kinds.get(b.date) ?? []), b.kind]);
  }
  const news = paired.filter((x) => kinds.has(x.date));
  const other = paired.filter((x) => !kinds.has(x.date));
  if (news.length < 3 || other.length < MIN_GROUP) return null;
  const swing = (xs, k = 'ret') => mean(xs.map((x) => Math.abs(x[k])));
  const youNews = swing(news);
  const youOther = swing(other);
  const spxNews = swing(news, 'spx');
  const ratio = spxNews > 0 ? youNews / spxNews : null;
  const byKind = ['Fed decision', 'CPI', 'Jobs report'].map((k) => {
    const ds = news.filter((x) => kinds.get(x.date).includes(k));
    return [k, ds.length ? mean(ds.map((x) => x.ret)) : 0, ds.length];
  }).filter(([, , n]) => n);
  const total = sum(news.map((x) => x.pnl));
  return {
    id: 'news',
    section: 'calendar',
    title: `On big-news days your account moves ±${youNews.toFixed(2)}% on average, against ±${youOther.toFixed(2)}% on other days`,
    why: ratio != null ? `The S&P moves ±${spxNews.toFixed(2)}% on those days: your book reacts ${ratio.toFixed(1)}× as much as the market to the same news.` : null,
    matters: `${plural(news.length, 'big-news day')} (Fed decisions, CPI, jobs reports) added up to ${usd(total)}.`,
    tone: ratio != null && ratio > 1.3 ? 'bad' : ratio != null && ratio < 0.8 ? 'good' : 'neutral',
    impact: Math.abs(total),
    confidence: confidence(news, other, (x) => Math.abs(x.ret)),
    bars: byKind.map(([k, v]) => [k, v]),
    unit: 'pct2',
  };
}

/* ── #6 the weeks against the S&P ── */

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
  const ahead = last.you >= last.spx;
  let streak = 0;
  for (let i = done.length - 1; i >= 0 && (done[i].you >= done[i].spx) === ahead; i--) streak += 1;
  const closed = trades.filter((t) => t.close >= last.from && t.close <= addDays(last.from, 6));
  const won = closed.filter((t) => t.outcome === 'win').length;
  const aheadWeeks = done.filter((w) => w.you >= w.spx).length;
  return {
    id: 'week',
    section: 'market',
    title: `Last week your account ${pct(last.you, 2)}, the S&P ${pct(last.spx, 2)}: ${ahead ? 'ahead' : 'behind'} by ${pts(last.you - last.spx)}`,
    why: closed.length
      ? `${plural(closed.length, 'trade')} closed, ${won} won, ${usd(sum(closed.map((t) => t.pnl)))}. The rest of the move was the positions you held.`
      : 'No trade closed: the whole move was the positions you held.',
    matters: `${streak > 1 ? `Your ${ordinal(streak)} week in a row ${ahead ? 'ahead of' : 'behind'} the S&P. ` : ''}Ahead in ${aheadWeeks} of ${plural(done.length, 'week')} measured.`,
    tone: tone(last.you - last.spx),
    impact: 0,
    bars: done.slice(-8).map((w) => [`w/c ${shortDate(w.from)}`, w.you - w.spx]),
    unit: 'pts',
  };
}

/* ── #7 the months against the S&P ── */

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
  if (decided.length < 2) return null;
  const won = decided.filter((r) => r.you >= r.spx).length;
  const best = decided.reduce((a, b) => (b.you - b.spx > a.you - a.spx ? b : a));
  const worst = decided.reduce((a, b) => (b.you - b.spx < a.you - a.spx ? b : a));
  const gap = mean(decided.map((r) => r.you - r.spx));
  return {
    id: 'months',
    section: 'market',
    title: `You beat the S&P in ${won} of the last ${plural(decided.length, 'month')}`,
    why: `Best month against it: ${best.label}, ${pct(best.you)} against ${pct(best.spx)}. Worst: ${worst.label}, ${pct(worst.you)} against ${pct(worst.spx)}.`,
    matters: `On average you were ${gap >= 0 ? 'ahead' : 'behind'} by ${pts(gap)} a month.`,
    tone: tone(won - decided.length / 2),
    impact: 0,
    table: [...last12].reverse(),
  };
}

/* ── #8 the S&P twin ── */

/**
 * The account beside a twin that put every dollar into the S&P 500 (total
 * return) instead: the same starting value, every deposit and withdrawal on
 * the same day. A fair "would I have done better just buying the index?".
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
 * The S&P twin, trade by trade: every time you bought, the same money went
 * into the S&P 500 (total return) that day, and came out the day you sold.
 * Open positions count to today. It isolates the picks — what each decision
 * made against the index over exactly the days it was held. The account-wide
 * twin (every deposit into the S&P, held) rides along as one line: it also
 * counts cash left idle and time out of the market, which the trades cannot.
 */
/**
 * Both sides marked every trading day. A trade counts its open profit from
 * the stock's own closes while it is held and its final figure once closed;
 * its twin, the S&P's move over the same days. A stock whose closes could not
 * be loaded counts nothing until it closes (or, still open, until today).
 */
export function dailyTwin(rows, ix, prices, from, today) {
  if (!rows.length) return [];
  const first = rows.map((r) => r.open).sort()[0];
  const start = from && from > first ? from : addDays(first, -1);
  const dates = ix.dates.slice(Math.max(0, at(ix.dates, start))).filter((d) => d <= today);
  if (!dates.length || dates[dates.length - 1] < today) dates.push(today);
  /**
   * The stock's closes are adjusted for later splits; the trade's own prices
   * are not. Scaling each close by the trade's last price over the close on
   * its last day puts the series in the trade's own terms, so the line starts
   * from the price actually paid and ends exactly on the profit actually made.
   */
  const marks = rows.map((r) => {
    const s = prices?.get(r.ticker);
    const sd = s?.map((x) => x.date) ?? null;
    const last = sd ? at(sd, r.live ? today : r.close) : -1;
    const scale = last >= 0 && s[last].close > 0 && r.price > 0 && r.qty > 0 ? r.price / s[last].close : null;
    return { r, s, sd, scale, baseLevel: levelOn(ix, r.open), sign: r.dir === 'Short' ? -1 : 1 };
  });
  return dates.map((d) => {
    let you = 0;
    let twinValue = 0;
    for (const m of marks) {
      const { r } = m;
      if (d < r.open) continue;
      if ((r.close && d >= r.close) || (r.live && d >= today)) { you += r.you; twinValue += r.spx; continue; }
      const lv = levelOn(ix, d);
      if (m.baseLevel > 0 && lv > 0) twinValue += r.cost * (lv / m.baseLevel - 1);
      if (m.scale) {
        const k = at(m.sd, d);
        if (k >= 0) you += (r.qty * m.s[k].close * m.scale - r.cost) * m.sign;
      }
    }
    return { date: d, you, twin: twinValue };
  });
}

function twin(history, ix, trades, open, today, prices) {
  const periods = {};
  for (const [key, from] of [['year', `${today.slice(0, 4)}-01-01`], ['all', null]]) {
    const closed = trades.filter((t) => t.spxPnl != null && (!from || t.close >= from));
    const live = open.filter((p) => p.spxPnl != null);
    if (!closed.length && !live.length) continue;
    const rows = [
      ...closed.map((t) => ({ id: t.id, ticker: t.ticker, dir: t.dir, cost: t.cost, qty: t.qty, price: t.exit, open: t.open, close: t.close, you: t.pnl, spx: t.spxPnl, live: false })),
      ...live.map((p) => ({ id: p.id, ticker: p.ticker, dir: p.dir, cost: p.cost, qty: p.qty, price: p.price, open: p.open, close: null, you: p.pnl, spx: p.spxPnl, live: true })),
    ].map((r) => ({ ...r, diff: r.you - r.spx })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const series = dailyTwin(rows, ix, prices, from, today);
    const you = sum(rows.map((r) => r.you));
    const spx = sum(rows.map((r) => r.spx));

    const traded = sum([...closed.map((t) => t.cost), ...live.map((p) => p.cost)]);
    const byDiff = [...closed].sort((a, b) => (b.pnl - b.spxPnl) - (a.pnl - a.spxPnl));
    const account = twinSeries(history, ix, from);
    const accEnd = account[account.length - 1];
    periods[key] = {
      from: series[0].date,
      series,
      you,
      twin: spx,
      diff: you - spx,
      youPct: traded > 0 ? (you / traded) * 100 : null,
      twinPct: traded > 0 ? (spx / traded) * 100 : null,
      beat: closed.filter((t) => t.pnl > t.spxPnl).length,
      decided: closed.length,
      open: live.length,
      best: byDiff.length ? { ticker: byDiff[0].ticker, diff: byDiff[0].pnl - byDiff[0].spxPnl } : null,
      worst: byDiff.length > 1 ? { ticker: byDiff[byDiff.length - 1].ticker, diff: byDiff[byDiff.length - 1].pnl - byDiff[byDiff.length - 1].spxPnl } : null,
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
    section: 'market',
    title: `If every trade had gone into the S&P 500 instead, same money, same days, you'd have made ${usd(main.twin)}. You made ${usd(main.you)}.`,
    tone: tone(main.diff),
    impact: Math.abs(main.diff),
    twin: periods,
  };
}

/* ── #9 when the market falls ── */

function downMarket(paired) {
  const down = paired.filter((x) => x.spx <= -1);
  const up = paired.filter((x) => x.spx >= 1);
  if (down.length < 3) return null;
  const capture = (xs) => {
    const s = mean(xs.map((x) => x.spx));
    return s ? (mean(xs.map((x) => x.ret)) / s) * 100 : null;
  };
  const dc = capture(down);
  const uc = up.length >= 3 ? capture(up) : null;
  const youDown = mean(down.map((x) => x.ret));
  const total = sum(down.map((x) => x.pnl));
  const verdict = dc < 90 ? ' You lose less than the market when it drops.' : dc > 110 ? ' Your book falls harder than the market when it drops.' : '';
  return {
    id: 'down',
    section: 'market',
    title: `When the S&P falls 1% or more, your account ${youDown <= 0 ? 'falls' : 'rises'} ${Math.abs(youDown).toFixed(2)}% on average`,
    why: `That is ${Math.round(dc)}% of the market's fall on those ${plural(down.length, 'day')}${uc != null ? `; on its 1%+ up days you catch ${Math.round(uc)}% of the rise` : ''}.${verdict}`,
    matters: `Those ${plural(down.length, 'down day')} added up to ${usd(total)}.`,
    tone: dc < 90 ? 'good' : dc > 110 ? 'bad' : 'neutral',
    impact: Math.abs(total),
    confidence: down.length < MIN_GROUP ? { level: 'early', needed: MIN_GROUP - down.length } : null,
    bars: [['Down days · you', youDown], ['Down days · S&P', mean(down.map((x) => x.spx))],
      ...(up.length ? [['Up days · you', mean(up.map((x) => x.ret))], ['Up days · S&P', mean(up.map((x) => x.spx))]] : [])],
    unit: 'pct2',
  };
}

/* ── #10 your picks against the market ── */

function picks(trades) {
  const measured = trades.filter((t) => t.spxRet != null);
  if (measured.length < 3) return null;
  const excess = measured.map((t) => t.ret - t.spxRet);
  const lagged = measured.filter((t) => t.ret < t.spxRet);
  const beat = measured.filter((t) => t.ret >= t.spxRet);
  const extra = sum(measured.map((t) => t.pnl - t.spxPnl));
  const why = lagged.length >= 3 && beat.length >= 3 ? whyOf(lagged, beat) : null;
  return {
    id: 'picks',
    section: 'market',
    title: `Your average trade ${mean(excess) >= 0 ? 'beat' : 'trailed'} the S&P over the same days by ${pts(mean(excess))}; ${beat.length} of ${measured.length} beat it`,
    why: why ? `The trades that trailed it: ${why.text}` : lagged.length >= 3 ? NO_CAUSE : null,
    matters: `Picking your own stocks ${extra >= 0 ? 'made' : 'cost'} ${plain$(extra)} against putting the same money in the S&P for the same days.`,
    tone: tone(mean(excess)),
    impact: Math.abs(extra),
    confidence: confidenceOne(excess),
    bars: [['Your trades', mean(measured.map((t) => t.ret))], ['S&P, same days', mean(measured.map((t) => t.spxRet))]],
    trades: ids(lagged),
  };
}

/* ── #11 after you sold ── */

function afterSold(trades, series) {
  const rows = [];
  for (const t of trades) {
    const s = series.get(t.ticker);
    if (!s?.length || !(t.exit > 0)) continue;
    const base = stockAt(s, t.close);
    if (!base || !(base.close > 0) || s[base.i].date !== t.close) continue;
    const sign = t.dir === 'Short' ? -1 : 1;
    const after = (n) => (s[base.i + n] ? (s[base.i + n].close / base.close - 1) * 100 * sign : null);
    const week = after(5);
    if (week == null) continue;
    const month = after(21);
    rows.push({ ...t, week, month, money: month != null ? (t.qty * t.exit * month) / 100 : null });
  }
  const full = rows.filter((r) => r.month != null);
  if (full.length < 3) return null;
  const left = sum(full.filter((r) => r.money > 0).map((r) => r.money));
  const saved = -sum(full.filter((r) => r.money < 0).map((r) => r.money));
  const winners = full.filter((r) => r.outcome === 'win');
  const losers = full.filter((r) => r.outcome === 'loss');
  const avgMonth = mean(full.map((r) => r.month));
  const parts = [];
  if (winners.length >= 2) {
    const w = mean(winners.map((r) => r.month));
    parts.push(`the winners you sold went on ${w >= 0 ? 'rising' : 'falling'}, ${pct(w)} on average`);
  }
  if (losers.length >= 2) {
    const l = mean(losers.map((r) => r.month));
    parts.push(`the losers you sold ${l <= 0 ? 'kept falling' : 'bounced back'}, ${pct(l)}`);
  }
  const why = parts.join('; ');
  return {
    id: 'after',
    section: 'after',
    title: `In the month after you sold, your stocks went ${avgMonth >= 0 ? 'up' : 'down'} ${Math.abs(avgMonth).toFixed(1)}% on average`,
    why: why ? `${why[0].toUpperCase()}${why.slice(1)}.` : null,
    matters: `Across ${plural(full.length, 'sale')}: ${plain$(left)} left on the table by stocks that kept going your way, ${plain$(saved)} saved by getting out of those that turned.`,
    tone: avgMonth > 2 ? 'bad' : avgMonth < -2 ? 'good' : 'neutral',
    impact: Math.abs(left - saved),
    confidence: confidenceOne(full.map((r) => r.month)),
    bars: [['A week later', mean(rows.map((r) => r.week))], ['A month later', avgMonth]],
    trades: ids([...full].sort((a, b) => b.money - a.money).slice(0, 8)),
  };
}

/* ── #13 personal records ── */

function records(days, history, trades, weeks) {
  const out = [];
  const bestDay = days.reduce((a, b) => (!a || b.pnl > a.pnl ? b : a), null);
  if (bestDay && bestDay.pnl > 0) out.push({ label: 'Best day', value: usd(bestDay.pnl), sub: `${pct(bestDay.ret, 2)} · ${shortDate(bestDay.date)} ${bestDay.date.slice(0, 4)}` });
  const months = [...monthlyReturns(history)].filter(([, m]) => !m.partial);
  const bestMonth = months.reduce((a, b) => (!a || b[1].returnPct > a[1].returnPct ? b : a), null);
  if (bestMonth && bestMonth[1].returnPct > 0) out.push({ label: 'Best month', value: pct(bestMonth[1].returnPct), sub: `${monthName(bestMonth[0])} · ${usd(bestMonth[1].pnl)}` });
  const win = trades.reduce((a, b) => (!a || b.pnl > a.pnl ? b : a), null);
  if (win && win.pnl > 0) out.push({ label: 'Biggest win', value: usd(win.pnl), sub: `${win.ticker} · ${pct(win.ret)} · ${shortDate(win.close)} ${win.close.slice(0, 4)}` });
  let run = 0;
  let longest = 0;
  for (const t of trades) {
    if (t.outcome === 'win') run += 1;
    else if (t.outcome === 'loss') run = 0;
    longest = Math.max(longest, run);
  }
  if (longest >= 2) out.push({ label: 'Longest winning streak', value: plural(longest, 'trade'), sub: 'won in a row' });
  const bestWeek = weeks.reduce((a, b) => (!a || b.you - b.spx > a.you - a.spx ? b : a), null);
  if (bestWeek && bestWeek.you > bestWeek.spx) out.push({ label: 'Best week against the S&P', value: `+${(bestWeek.you - bestWeek.spx).toFixed(1)} pts`, sub: `${pct(bestWeek.you)} against ${pct(bestWeek.spx)} · week of ${shortDate(bestWeek.from)}` });
  return out;
}

/* ── #15 the market's mood when you buy ── */

const MOODS = [
  ['Extreme fear', 0, 25],
  ['Fear', 25, 45],
  ['Neutral', 45, 56],
  ['Greed', 56, 75],
  ['Extreme greed', 75, 101],
];
export const moodOf = (v) => MOODS.find(([, lo, hi]) => v >= lo && v < hi)?.[0] ?? null;

function moodAtEntry(trades) {
  const rated = trades.filter((t) => t.fg != null);
  if (rated.length < 5) return null;
  const groups = MOODS.map(([label]) => ({ label, ts: rated.filter((t) => moodOf(t.fg) === label) })).filter((g) => g.ts.length);
  const most = groups.reduce((a, b) => (b.ts.length > a.ts.length ? b : a));
  const fear = rated.filter((t) => t.fg < 45);
  const greed = rated.filter((t) => t.fg > 55);
  const f = mean(fear.map((t) => t.ret));
  const g = mean(greed.map((t) => t.ret));
  const both = fear.length > 0 && greed.length > 0;
  const worse = both ? (f < g ? fear : greed) : null;
  return {
    id: 'mood',
    section: 'mind',
    title: both
      ? `Trades you bought in Fear return ${pct(f)} on average; those bought in Greed ${pct(g)}`
      : `You buy most often in ${most.label} (${Math.round(share(most.ts.length, rated.length))}% of your trades)`,
    why: `You buy most often in ${most.label.toLowerCase()} (${most.ts.length} of ${rated.length} trades with a reading). The reading is CNN's Fear & Greed index on the day you bought.`,
    matters: worse ? `Your ${worse === fear ? 'Fear' : 'Greed'} trades: ${plural(worse.length, 'trade')}, ${usd(sum(worse.map((t) => t.pnl)))} in total.` : null,
    tone: both ? tone(f - g) : 'neutral',
    impact: worse ? Math.abs(sum(worse.map((t) => t.pnl))) : 0,
    confidence: both ? confidence(fear, greed) : { level: 'early', needed: MIN_GROUP },
    bars: groups.map((x) => [x.label, mean(x.ts.map((t) => t.ret))]),
    trades: worse ? ids(worse) : [],
  };
}

/* ── #16 emotional against confident ── */

function emotion(trades) {
  const rated = trades.filter((t) => t.mind != null);
  const emotional = rated.filter((t) => t.mind <= 4);
  const confident = rated.filter((t) => t.mind >= 7);
  if (!emotional.length || !confident.length) {
    return {
      id: 'emotion',
      section: 'mind',
      title: 'Rate your state of mind when you open a trade to see how it affects your results',
      why: `${rated.length} of your ${trades.length} closed trades have a rating. New trade → State of mind.`,
      tone: 'neutral',
      impact: 0,
      confidence: { level: 'early', needed: Math.max(1, MIN_GROUP * 2 - rated.length) },
    };
  }
  const e = mean(emotional.map((t) => t.ret));
  const c = mean(confident.map((t) => t.ret));
  const why = whyOf(emotional, confident, ['emotional']);
  const total = sum(emotional.map((t) => t.pnl));
  return {
    id: 'emotion',
    section: 'mind',
    title: `Trades you took emotional return ${pct(e)} on average; confident ones ${pct(c)}`,
    why: why ? `Your emotional trades: ${why.text}` : `Win rate ${Math.round(winRate(emotional))}% when emotional, ${Math.round(winRate(confident))}% when confident.`,
    matters: `${plural(emotional.length, 'emotional trade')} (rated 1–4), ${usd(total)} in total; ${plural(confident.length, 'confident one')} (7–10), ${usd(sum(confident.map((t) => t.pnl)))}.`,
    tone: tone(c - e),
    impact: Math.abs(total),
    confidence: confidence(emotional, confident),
    bars: [['Emotional', e], ['Confident', c]],
    trades: ids(emotional),
  };
}

/* ── #17 how long you hold losers against winners ── */

function holding(trades) {
  const wins = trades.filter((t) => t.outcome === 'win');
  const losses = trades.filter((t) => t.outcome === 'loss');
  if (!wins.length || !losses.length) return null;
  const w = mean(wins.map((t) => t.days));
  const l = mean(losses.map((t) => t.days));
  const longer = l > w;
  const ratio = longer ? l / Math.max(w, 1) : w / Math.max(l, 1);
  const even = ratio < 1.2;
  const lingered = losses.filter((t) => t.days > w * 1.5 && t.days > 2);
  const lingeredCost = sum(lingered.map((t) => t.pnl));
  return {
    id: 'holding',
    section: 'mind',
    title: even
      ? `You hold winners and losers about as long (${Math.round(w)} days against ${Math.round(l)})`
      : longer
        ? `You keep losing trades ${ratio.toFixed(1)}× longer than winning ones (${Math.round(l)} days against ${Math.round(w)})`
        : `You close losing trades faster than winners (${Math.round(l)} days against ${Math.round(w)})`,
    why: even
      ? 'No sign of the most common habit in trading: sitting on losers and selling winners early.'
      : longer
        ? 'Holding losers and selling winners quickly is the most common habit in trading, and over time the costliest.'
        : 'Letting winners run and cutting losers early is the discipline most traders find hardest.',
    matters: lingered.length
      ? `${plural(lingered.length, 'losing trade')} stayed open more than half as long again as your average winner; together they lost ${plain$(lingeredCost)}.`
      : null,
    tone: even ? 'neutral' : longer ? 'bad' : 'good',
    impact: longer && !even ? Math.abs(lingeredCost) : 0,
    confidence: confidence(wins, losses, (t) => t.days),
    bars: [['Winners', w], ['Losers', l]],
    unit: 'days',
    trades: ids(lingered),
  };
}

/* ── risk: the deepest drop, and the swings against the market ── */

export function deepestDrop(days, ix) {
  if (days.length < 20) return null;
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
    for (let i = first; i < ix.dates.length; i++) {
      p = Math.max(p, ix.level[i]);
      spx = Math.min(spx, (ix.level[i] / p - 1) * 100);
    }
  }
  const took = worst.recovered ? Math.round((ms(worst.recovered) - ms(worst.trough)) / DAY) : null;
  return {
    id: 'drawdown',
    section: 'risk',
    title: `Your deepest drop: ${pct(worst.depth)}, from ${shortDate(worst.peak)} to ${shortDate(worst.trough)} ${worst.trough.slice(0, 4)}`,
    why: spx != null ? `The S&P's deepest drop over the same time was ${pct(spx)}: ${worst.depth < spx ? 'your book fell further than the market' : 'your book held up better than the market'}.` : null,
    matters: `${worst.recovered ? `It took ${plural(took, 'day')} from the bottom to get back to the high.` : 'Your account has not yet climbed back to that high.'} ${now > -0.5 ? 'Today you are at or near your highest.' : `Today you are ${Math.abs(now).toFixed(1)}% below your highest (${shortDate(peakDate)}).`}`,
    tone: spx != null ? tone(worst.depth - spx) : 'neutral',
    impact: 0,
  };
}

function swings(paired) {
  if (paired.length < 40) return null;
  const year = Math.sqrt(252);
  const you = stdev(paired.map((x) => x.ret)) * year;
  const spx = stdev(paired.map((x) => x.spx)) * year;
  if (!(you > 0 && spx > 0)) return null;
  const yourPer = (mean(paired.map((x) => x.ret)) * 252) / you;
  const spxPer = (mean(paired.map((x) => x.spx)) * 252) / spx;
  const times = (you / spx).toFixed(1);
  const paid = yourPer >= spxPer;
  return {
    id: 'swings',
    section: 'risk',
    title: you >= spx
      ? `Your account swings ${times}× as much as the S&P, and ${paid ? 'earns more for each point of swing' : 'earns less for each point of swing'}`
      : `Your account swings less than the S&P (${times}×), and ${paid ? 'earns more for each point of swing' : 'earns less for each point of swing'}`,
    why: `${you.toFixed(0)}% a year against the S&P's ${spx.toFixed(0)}%. For each point of swing you earned ${yourPer.toFixed(2)} points of return a year; the S&P earned ${spxPer.toFixed(2)}. ${paid ? 'The risk you took paid for itself.' : 'The extra swing did not come with extra return.'}`,
    matters: `Measured on ${plural(paired.length, 'trading day')}: your account's daily moves against the S&P's on the same days.`,
    tone: tone(yourPer - spxPer),
    impact: 0,
    calmer: you < spx,
    bars: [['Your swing', you], ['S&P swing', spx]],
    unit: 'vol',
  };
}

/* ── right now: the open book ── */

function openBook(open, trades, accountValue) {
  const items = [];
  const losses = trades.filter((t) => t.outcome === 'loss');
  const typical = losses.length >= 3 ? median(losses.map((t) => t.days)) : null;
  if (typical != null) {
    for (const p of open.filter((x) => x.pnl < 0 && x.days > Math.max(typical * 1.5, 5)).sort((a, b) => a.pnl - b.pnl).slice(0, 3)) {
      items.push({ tone: 'bad', text: `${p.ticker} has been open ${p.days} days at ${pct(p.ret)}; your closed losing trades lasted ${Math.round(typical)} days (median).` });
    }
  }
  const total = accountValue > 0 ? accountValue : sum(open.map((p) => Math.abs(p.value)));
  if (total > 0 && open.length) {
    const biggest = open.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
    if (share(Math.abs(biggest.value), total) >= 25) {
      items.push({ tone: 'bad', text: `${biggest.ticker} is ${Math.round(share(Math.abs(biggest.value), total))}% of your account: one stock moves the whole book.` });
    }
    const bySector = new Map();
    for (const p of open) bySector.set(p.sector, (bySector.get(p.sector) ?? 0) + Math.abs(p.value));
    const top = [...bySector].sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] !== 'Other' && share(top[1], total) >= 50) {
      items.push({ tone: 'neutral', text: `${Math.round(share(top[1], total))}% of your account is in ${top[0]}: a bad day for the sector is a bad day for you.` });
    }
  }
  const best = open.filter((p) => p.pnl > 0).sort((a, b) => b.pnl - a.pnl)[0];
  if (best) items.push({ tone: 'good', text: `Your best open position: ${best.ticker}, ${usd(best.pnl)} (${pct(best.ret)}) in ${plural(best.days, 'day')}.` });
  return items.length ? { id: 'now', section: 'now', items } : null;
}

/* ── #14 the trader title and badges ── */

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

  if (rate < 45 && payoff != null && payoff >= 3) return pick('homerun', `You win ${Math.round(rate)}% of the time, but your average win is ${payoff.toFixed(1)}× your average loss.`);
  if (rate > 70) return pick('sharpshooter', `You win ${Math.round(rate)}% of your trades.`);
  if (dayShare > 50) {
    if (rate > 60) return pick('sniper', `${Math.round(dayShare)}% of your trades close within a day, and ${Math.round(rate)}% of all your trades win.`);
    if (spread > 8) return pick('adrenaline', `${Math.round(dayShare)}% of your trades close within a day, with big swings both ways (±${spread.toFixed(0)}%).`);
    return pick('scalper', `${Math.round(dayShare)}% of your trades close within a day.`);
  }
  if (trades.length >= 40 && tickers >= trades.length * 0.6 && Math.abs(median(trades.map((t) => t.ret))) < 3) {
    return pick('labrat', `${trades.length} trades across ${tickers} different stocks, mostly small moves.`);
  }
  if (held <= 30) {
    if (ran.length >= MIN_GROUP && share(ran.filter((t) => t.stock10 >= 10).length, ran.length) >= 40) {
      return pick('surfer', 'You usually hold for days to weeks, and you often buy a stock after it has already run 10%+.');
    }
    return pick('wave', `You usually hold for days to weeks (median ${Math.round(held)} days).`);
  }
  if (held <= 180) {
    if (twinAhead && calmer) return pick('tortoise', 'You hold for months, your account swings less than the S&P, and you are ahead of it.');
    if (sectors >= 8) return pick('fortress', `You hold for months, across ${sectors} sectors.`);
    return pick('hunter', `You hold for months (median ${Math.round(held)} days)${rate >= 55 ? ` and win ${Math.round(rate)}% of your trades` : ''}.`);
  }
  return pick('oak', `Your median trade is held ${Math.round(held)} days: you rarely sell.`);
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
    if (calmShare >= 60 && (!hot.length || mean(calm.map((t) => t.ret)) > mean(hot.map((t) => t.ret)))) add('icecold', calmShare, `${Math.round(calmShare)}% of your rated trades were taken confident, and they do better.`);
    if (hotShare >= 30 && mean(hot.map((t) => t.ret)) < mean(rated.filter((t) => t.mind > 4).map((t) => t.ret))) add('hothead', hotShare + 10, `${Math.round(hotShare)}% of your rated trades were emotional, and they lose more.`);
  }
  const ran = trades.filter((t) => t.stock10 != null);
  if (ran.length >= MIN_GROUP) {
    const dips = share(ran.filter((t) => t.stock10 <= -5).length, ran.length);
    const chases = share(ran.filter((t) => t.stock10 >= 10).length, ran.length);
    if (dips >= 50) add('dip', dips, `${Math.round(dips)}% of your buys came after the stock fell 5%+ in two weeks.`);
    if (chases >= 40) add('trend', chases, `${Math.round(chases)}% of your buys came after the stock rose 10%+ in two weeks.`);
  }
  const moods = trades.filter((t) => t.fg != null);
  if (moods.length >= MIN_GROUP) {
    const f = share(moods.filter((t) => t.fg < 45).length, moods.length);
    const g = share(moods.filter((t) => t.fg > 55).length, moods.length);
    if (f >= 50) add('fear', f, `${Math.round(f)}% of your buys were made while the market was fearful.`);
    if (g >= 50) add('greed', g, `${Math.round(g)}% of your buys were made while the market was greedy.`);
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
    if (twinPct >= 2) add('beater', 50 + Math.min(twinPct, 40), `Your account is ${twinPct.toFixed(1)}% ahead of putting every deposit in the S&P.`);
    else if (Math.abs(twinPct) < 2 && twinDays >= 120) add('hugger', 35, `Your account is within ${Math.abs(twinPct).toFixed(1)}% of putting every deposit in the S&P.`);
  }
  const held = trades.filter((t) => t.dipped != null && t.dipped <= -20 && t.outcome === 'win');
  if (held.length) add('diamond', 30 + held.length * 5, `${plural(held.length, 'trade')} fell 20%+ while you held, and you closed ${held.length === 1 ? 'it' : 'them'} in profit.`);
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

/* ── the briefing ── */

const SECTIONS = ['market', 'risk', 'calendar', 'after', 'mind'];

/**
 * The analyst's summary: the findings solid enough to state (a fact, or
 * Strong / Likely), the good ones as strengths and the bad as weaknesses,
 * the largest in money first.
 */
function briefing(cards) {
  // The twin and last week have their own place at the top; one week is not a trait.
  const ranked = cards.filter((c) => SECTIONS.includes(c.section) && c.title && c.id !== 'twin' && c.id !== 'week' && solid(c.confidence))
    .sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0));
  return {
    strengths: ranked.filter((c) => c.tone === 'good').slice(0, 3).map((c) => ({ id: c.id, text: c.title })),
    weaknesses: ranked.filter((c) => c.tone === 'bad').slice(0, 3).map((c) => ({ id: c.id, text: c.title })),
  };
}

/* ── everything ── */

/**
 * The whole analysis, from what the device already holds:
 *  - positions: the journal
 *  - history: the account valued day by day (totalAccountValue, externalCashFlow)
 *  - index: the S&P 500's daily closes with dividends ({ date, close, div })
 *  - fearGreed: [{ date, value }]; bigDays: [{ date, kind }]
 *  - series: ticker → its daily closes, for the stocks that could be loaded
 * Anything missing simply leaves its cards out.
 */
export function analyse({
  positions = [], history = [], index = [], fearGreed = [], bigDays = [], series = new Map(),
  accountValue = null, today = new Date(),
} = {}) {
  const day = typeof today === 'string' ? today : today.toISOString().slice(0, 10);
  const ix = indexLevels(index);
  const newsDays = new Set((bigDays ?? []).map((b) => b?.date).filter(Boolean));
  const fg = [...(fearGreed ?? [])].filter((x) => x?.date && Number.isFinite(x.value)).sort((a, b) => a.date.localeCompare(b.date));
  const trades = enrich(tradesOf(positions), { ix, fearGreed: fg, newsDays, series });

  const open = (positions ?? []).filter((p) => p?.status !== 'Closed' && p?.open && p.qty).map((p) => {
    const pnl = unreal(p);
    const cost = Math.abs(costOf(p));
    const spxRet = indexBetween(ix, p.open, day);
    return {
      id: p.id, ticker: p.ticker, dir: p.dir, open: p.open, cls: p.cls, sector: sectorOf(p), qty: Math.abs(Number(p.qty) || 0), price: Number(p.cur) || 0,
      pnl, cost, ret: cost ? (pnl / cost) * 100 : 0, value: marketValueOf(p),
      days: Math.max(0, Math.round((ms(day) - ms(p.open)) / DAY)),
      spxPnl: spxRet != null ? (cost * spxRet) / 100 : null,
    };
  });

  const days = accountDays(history);
  const paired = pairDays(days, ix);
  const weeks = weeksOf(paired);
  const enough = trades.length >= MIN_TRADES;

  const twinCard = twin(history, ix, trades, open, day, series);
  const swingCard = swings(paired);
  const cards = [
    lastWeek(weeks, trades, day),
    twinCard,
    monthsVsIndex(history, ix, day),
    downMarket(paired),
    enough ? picks(trades) : null,
    deepestDrop(days, ix),
    swingCard,
    enough ? weekdayTrades(trades) : null,
    accountWeekdays(paired),
    bigNewsDays(paired, bigDays),
    enough ? afterSold(trades, series) : null,
    enough ? moodAtEntry(trades) : null,
    enough ? emotion(trades) : null,
    enough ? holding(trades) : null,
  ].filter(Boolean);

  // The title and the Market Beater badge read the whole account against the S&P.
  const yearTwin = twinCard?.twin?.year?.account ?? twinCard?.twin?.all?.account ?? null;
  const twinDays = yearTwin ? Math.round((ms(day) - ms(yearTwin.from)) / DAY) : 0;
  const sectors = new Set(trades.map((t) => t.sector).filter((s) => s !== 'Other')).size;
  const title = traderTitle(trades, { twinAhead: yearTwin ? yearTwin.diff > 0 : null, calmer: swingCard?.calmer ?? null, sectors });
  const badges = enough ? traderBadges(trades, { open, accountValue, twinPct: yearTwin?.diffPct ?? null, twinDays }) : [];

  const yearFrom = `${day.slice(0, 4)}-01-01`;
  const yearYou = history.length ? periodReturnFromHistory(history, yearFrom, day)?.returnPct ?? null : null;
  const yearSpx = indexBetween(ix, addDays(yearFrom, -1), day);

  return {
    trades: trades.length,
    needed: Math.max(0, MIN_TRADES - trades.length),
    winRate: trades.length ? winRate(trades) : null,
    year: { you: yearYou, spx: yearSpx },
    profile: { title, badges: badges.slice(0, 2), allBadges: badges, records: records(days, history, trades, weeks) },
    cards,
    now: openBook(open, trades, accountValue),
    briefing: briefing(cards),
  };
}
