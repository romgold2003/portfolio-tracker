/**
 * Insights (November 2026): what a person's own closed trades say about how
 * they trade — their behaviour, their timing, what they trade, and their risk.
 *
 * Observations about the past, never advice about what to buy or sell (the
 * Terms are explicit that nothing in Riskbook is advice). Worked out here, on
 * the device, from the decrypted journal; nothing is sent anywhere.
 *
 * Two rules keep it honest, the same two every indicator in this project had
 * to pass:
 *  - Enough evidence. A comparison needs MIN_GROUP trades on each side, and a
 *    fact about the whole book MIN_TRADES; until then it says how many more.
 *  - Better than chance. A difference between two groups is checked against
 *    the same trades shuffled at random (a permutation test). Under 5% chance:
 *    "Strong". Under 20%: "Likely". Otherwise "Possible" — shown as a hint,
 *    never as a fact.
 */
import { realized, costOf, outcomeOf } from './portfolio.js';
import { cleanMind } from './mind.js';
import { sectorOf } from '../config/sectors.js';

export const MIN_GROUP = 8;
export const MIN_TRADES = 10;
const SHUFFLES = 2000;
const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A closed trade as the insights read it. */
export function tradesOf(positions) {
  return (positions ?? [])
    .filter((p) => p?.status === 'Closed' && p.open && p.close)
    .map((p) => {
      const pnl = realized(p);
      const cost = Math.abs(costOf(p));
      const days = Math.max(0, Math.round((Date.parse(`${p.close}T00:00:00Z`) - Date.parse(`${p.open}T00:00:00Z`)) / DAY));
      return {
        id: p.id,
        ticker: p.ticker,
        dir: p.dir,
        open: p.open,
        close: p.close,
        pnl,
        cost,
        ret: cost > 0 ? (pnl / cost) * 100 : 0,
        days,
        outcome: outcomeOf(pnl),
        mind: cleanMind(p.mind),
        sector: sectorOf(p),
        cls: p.cls,
        weekday: new Date(`${p.open}T12:00:00Z`).getUTCDay(),
        averagedDown: averagedDown(p),
      };
    })
    .sort((a, b) => a.close.localeCompare(b.close) || a.open.localeCompare(b.open));
}

/**
 * Added to while the trade was losing: a long bought more below the first
 * price, a short sold more above it. The first price is not stored; it is
 * what is left of the average once every add's own shares and cost are taken out.
 */
function averagedDown(p) {
  const adds = (p.adds ?? []).filter((a) => Number(a?.price) > 0 && Number(a?.qty) > 0);
  if (!adds.length) return false;
  const qty = Number(p.origQty ?? p.qty);
  const addedQty = sum(adds.map((a) => a.qty));
  const firstQty = qty - addedQty;
  if (!(firstQty > 0)) return false;
  const first = (p.entry * qty - sum(adds.map((a) => a.qty * a.price))) / firstQty;
  return adds.some((a) => (p.dir === 'Short' ? a.price > first : a.price < first));
}

/* ── the statistics ── */

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const winRate = (ts) => {
  const decided = ts.filter((t) => t.outcome !== 'even');
  return decided.length ? (decided.filter((t) => t.outcome === 'win').length / decided.length) * 100 : 0;
};

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

/** Strong, likely or possible, from the chance; "early" while either side is short of trades. */
export function confidence(a, b, values = (t) => t.ret) {
  const short = Math.max(0, MIN_GROUP - a.length) + Math.max(0, MIN_GROUP - b.length);
  if (short > 0) return { level: 'early', needed: short };
  const p = chanceOf(a.map(values), b.map(values));
  return { level: p < 0.05 ? 'strong' : p < 0.2 ? 'likely' : 'possible', chance: p };
}

const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
const usd = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const plain$ = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const ids = (ts) => ts.map((t) => t.id);
const tone = (n) => (n > 0 ? 'good' : n < 0 ? 'bad' : 'neutral');

/* ── the insights ── */

function emotion(trades) {
  const rated = trades.filter((t) => t.mind != null);
  const emotional = rated.filter((t) => t.mind <= 4);
  const confident = rated.filter((t) => t.mind >= 7);
  if (!emotional.length && !confident.length) {
    return { id: 'emotion', group: 'behaviour', title: 'Rate your state of mind at entry to see how it affects your results', confidence: { level: 'early', needed: MIN_GROUP * 2 }, tone: 'neutral' };
  }
  const e = mean(emotional.map((t) => t.ret));
  const c = mean(confident.map((t) => t.ret));
  return {
    id: 'emotion',
    group: 'behaviour',
    title: `Trades you took emotional return ${pct(e)} on average; confident ones ${pct(c)}`,
    detail: `${emotional.length} emotional trades (rated 1–4), ${confident.length} confident ones (7–10). Win rate ${Math.round(winRate(emotional))}% against ${Math.round(winRate(confident))}%.`,
    tone: tone(c - e),
    confidence: confidence(emotional, confident),
    bars: [['Emotional', e], ['Confident', c]],
    trades: ids(emotional),
  };
}

function holding(trades) {
  const wins = trades.filter((t) => t.outcome === 'win');
  const losses = trades.filter((t) => t.outcome === 'loss');
  if (!wins.length || !losses.length) return null;
  const w = mean(wins.map((t) => t.days));
  const l = mean(losses.map((t) => t.days));
  const longer = l > w;
  const ratio = longer ? l / Math.max(w, 1) : w / Math.max(l, 1);
  if (ratio < 1.2) {
    return {
      id: 'holding',
      group: 'behaviour',
      title: `You hold winners and losers about as long (${Math.round(w)} days against ${Math.round(l)})`,
      detail: 'No sign of the usual habit of sitting on losers and selling winners early.',
      tone: 'neutral',
      confidence: confidence(wins, losses, (t) => t.days),
      bars: [['Winners', w], ['Losers', l]],
      unit: 'days',
      trades: [],
    };
  }
  return {
    id: 'holding',
    group: 'behaviour',
    title: longer
      ? `You keep losing trades ${ratio.toFixed(1)}× longer than winning ones (${Math.round(l)} days against ${Math.round(w)})`
      : `You cut losing trades faster than winners (${Math.round(l)} days against ${Math.round(w)})`,
    detail: longer
      ? 'Holding losers and selling winners quickly is the most common habit in trading, and the costliest over time.'
      : 'Letting winners run and cutting losers early is the discipline most traders find hardest.',
    tone: longer ? 'bad' : 'good',
    confidence: confidence(wins, losses, (t) => t.days),
    bars: [['Winners', w], ['Losers', l]],
    unit: 'days',
    trades: ids(longer ? losses : wins),
  };
}

function revenge(trades) {
  const lossDays = trades.filter((t) => t.outcome === 'loss').map((t) => Date.parse(`${t.close}T00:00:00Z`));
  const after = trades.filter((t) => {
    const opened = Date.parse(`${t.open}T00:00:00Z`);
    return lossDays.some((d) => opened >= d && opened - d <= DAY);
  });
  if (!after.length) return null;
  const rest = trades.filter((t) => !after.includes(t));
  const a = winRate(after);
  const r = winRate(rest);
  return {
    id: 'revenge',
    group: 'behaviour',
    title: `Trades opened within a day of a loss win ${Math.round(a)}% of the time, against ${Math.round(r)}% otherwise`,
    detail: `${after.length} trades taken the day of a loss or the day after, averaging ${pct(mean(after.map((t) => t.ret)))}; the rest average ${pct(mean(rest.map((t) => t.ret)))}.`,
    tone: tone(a - r),
    confidence: confidence(after, rest),
    bars: [['After a loss', mean(after.map((t) => t.ret))], ['Otherwise', mean(rest.map((t) => t.ret))]],
    trades: ids(after),
  };
}

function averaging(trades) {
  const down = trades.filter((t) => t.averagedDown);
  if (!down.length) return null;
  const rest = trades.filter((t) => !t.averagedDown);
  const wins = down.filter((t) => t.outcome === 'win').length;
  return {
    id: 'averaging',
    group: 'behaviour',
    title: `Adding to a losing position worked ${wins} time${wins === 1 ? '' : 's'} out of ${down.length}`,
    detail: `Positions you averaged down on returned ${pct(mean(down.map((t) => t.ret)))} on average, the rest ${pct(mean(rest.map((t) => t.ret)))}.`,
    tone: tone(mean(down.map((t) => t.ret)) - mean(rest.map((t) => t.ret))),
    confidence: confidence(down, rest),
    bars: [['Averaged down', mean(down.map((t) => t.ret))], ['Did not', mean(rest.map((t) => t.ret))]],
    trades: ids(down),
  };
}

function weekday(trades) {
  const days = [1, 2, 3, 4, 5].map((d) => ({ d, ts: trades.filter((t) => t.weekday === d) }));
  const usable = days.filter((x) => x.ts.length >= 3);
  if (usable.length < 2) return { id: 'weekday', group: 'timing', title: 'Which day of the week you trade best', confidence: { level: 'early', needed: MIN_TRADES - trades.length > 0 ? MIN_TRADES - trades.length : 3 }, tone: 'neutral' };
  const avg = (x) => mean(x.ts.map((t) => t.ret));
  const worst = usable.reduce((a, b) => (avg(b) < avg(a) ? b : a));
  const best = usable.reduce((a, b) => (avg(b) > avg(a) ? b : a));
  const rest = trades.filter((t) => t.weekday !== worst.d);
  return {
    id: 'weekday',
    group: 'timing',
    title: `${WEEKDAYS[best.d]} is your best day to open a trade (${pct(avg(best))}); ${WEEKDAYS[worst.d]} your worst (${pct(avg(worst))})`,
    detail: `Average return by the day the trade was opened. ${WEEKDAYS[worst.d]}: ${worst.ts.length} trades, ${usd(sum(worst.ts.map((t) => t.pnl)))} in total.`,
    tone: avg(worst) < 0 ? 'bad' : 'neutral',
    confidence: confidence(worst.ts, rest),
    bars: days.map((x) => [WEEKDAYS[x.d].slice(0, 3), x.ts.length ? avg(x) : 0]),
    trades: ids(worst.ts),
  };
}

function style(trades) {
  const buckets = [
    ['Day trades', (t) => t.days <= 1],
    ['Swing (2–30 days)', (t) => t.days >= 2 && t.days <= 30],
    ['Long term (30+ days)', (t) => t.days > 30],
  ].map(([label, test]) => ({ label, ts: trades.filter(test) }));
  const usable = buckets.filter((b) => b.ts.length);
  const total = (b) => sum(b.ts.map((t) => t.pnl));
  const best = usable.reduce((a, b) => (total(b) > total(a) ? b : a), usable[0]);
  const worst = usable.reduce((a, b) => (total(b) < total(a) ? b : a), usable[0]);
  return {
    id: 'style',
    group: 'timing',
    title: usable.length > 1
      ? `${best.label} made you ${usd(total(best))}; ${worst.label.toLowerCase()} ${usd(total(worst))}`
      : `All your trades so far are ${best.label.toLowerCase()}`,
    detail: buckets.map((b) => `${b.label}: ${b.ts.length} trades, ${b.ts.length ? `${Math.round(winRate(b.ts))}% won` : '—'}`).join(' · '),
    tone: total(worst) < 0 ? 'bad' : 'good',
    confidence: usable.length > 1 ? confidence(worst.ts, trades.filter((t) => !worst.ts.includes(t))) : { level: 'early', needed: MIN_GROUP },
    bars: buckets.map((b) => [b.label.split(' (')[0], total(b)]),
    unit: 'usd',
    trades: ids(worst.ts),
  };
}

function groupBy(trades, key) {
  const map = new Map();
  for (const t of trades) {
    const k = key(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.entries()].map(([k, ts]) => ({ k, ts, total: sum(ts.map((t) => t.pnl)) }));
}

function sectors(trades) {
  const groups = groupBy(trades, (t) => t.sector).filter((g) => g.ts.length >= 2).sort((a, b) => b.total - a.total);
  if (groups.length < 2) return null;
  const best = groups[0];
  const worst = groups[groups.length - 1];
  return {
    id: 'sectors',
    group: 'what',
    title: `${best.k} made you ${usd(best.total)}; ${worst.k} ${usd(worst.total)}`,
    detail: `Realised profit or loss by sector, across ${trades.length} closed trades.`,
    tone: worst.total < 0 ? 'bad' : 'good',
    confidence: confidence(worst.ts, trades.filter((t) => t.sector !== worst.k)),
    bars: groups.slice(0, 6).map((g) => [g.k, g.total]),
    unit: 'usd',
    trades: ids(worst.ts),
  };
}

function worstTicker(trades) {
  const groups = groupBy(trades, (t) => t.ticker).filter((g) => g.ts.length >= 3).sort((a, b) => a.total - b.total);
  const worst = groups[0];
  if (!worst || worst.total >= 0) return null;
  const wins = worst.ts.filter((t) => t.outcome === 'win').length;
  return {
    id: 'ticker',
    group: 'what',
    title: `${worst.k}: ${worst.ts.length} trades, ${wins} win${wins === 1 ? '' : 's'}, ${usd(worst.total)}. Your costliest stock`,
    detail: groups.length > 1 ? `Next: ${groups.slice(1, 3).map((g) => `${g.k} ${usd(g.total)}`).join(', ')}.` : 'The only stock you have traded three times or more.',
    tone: 'bad',
    confidence: { level: worst.ts.length >= 5 ? 'strong' : 'likely' },
    trades: ids(worst.ts),
  };
}

function shorts(trades) {
  const short = trades.filter((t) => t.dir === 'Short');
  if (short.length < 3) return null;
  const long = trades.filter((t) => t.dir !== 'Short');
  const s = mean(short.map((t) => t.ret));
  const l = mean(long.map((t) => t.ret));
  return {
    id: 'shorts',
    group: 'what',
    title: `Your shorts return ${pct(s)} on average, your longs ${pct(l)}`,
    detail: `${short.length} shorts, ${usd(sum(short.map((t) => t.pnl)))} in total; ${long.length} longs, ${usd(sum(long.map((t) => t.pnl)))}.`,
    tone: tone(s - l),
    confidence: confidence(short, long),
    bars: [['Shorts', s], ['Longs', l]],
    trades: ids(short),
  };
}

function size(trades) {
  const bySize = [...trades].sort((a, b) => b.cost - a.cost);
  const big = bySize.slice(0, Math.max(1, Math.round(trades.length / 5)));
  const rest = bySize.slice(big.length);
  const lossTotal = -sum(trades.filter((t) => t.pnl < 0).map((t) => t.pnl));
  const bigLoss = -sum(big.filter((t) => t.pnl < 0).map((t) => t.pnl));
  const share = lossTotal > 0 ? (bigLoss / lossTotal) * 100 : 0;
  return {
    id: 'size',
    group: 'risk',
    title: share >= 40
      ? `Your biggest ${big.length} trades made ${Math.round(share)}% of all your losses`
      : `Your biggest trades return ${pct(mean(big.map((t) => t.ret)))} on average, the rest ${pct(mean(rest.map((t) => t.ret)))}`,
    detail: `The largest fifth by amount invested: ${big.length} trades, ${usd(sum(big.map((t) => t.pnl)))} in total.`,
    tone: share >= 40 ? 'bad' : tone(mean(big.map((t) => t.ret)) - mean(rest.map((t) => t.ret))),
    confidence: confidence(big, rest),
    bars: [['Biggest fifth', mean(big.map((t) => t.ret))], ['The rest', mean(rest.map((t) => t.ret))]],
    trades: ids(big),
  };
}

function payoff(trades) {
  const wins = trades.filter((t) => t.outcome === 'win');
  const losses = trades.filter((t) => t.outcome === 'loss');
  if (!wins.length || !losses.length) return null;
  const w = mean(wins.map((t) => t.pnl));
  const l = -mean(losses.map((t) => t.pnl));
  const needed = (l / (w + l)) * 100;
  const actual = winRate(trades);
  return {
    id: 'payoff',
    group: 'risk',
    title: `Your average win is ${plain$(w)} and your average loss ${plain$(l)}: you need to be right ${Math.round(needed)}% of the time, and you are ${Math.round(actual)}%`,
    detail: actual >= needed
      ? `A cushion of ${Math.round(actual - needed)} points: your edge, on these trades.`
      : `${Math.round(needed - actual)} points short: smaller losses or bigger wins would close it.`,
    tone: actual >= needed ? 'good' : 'bad',
    confidence: { level: trades.length >= 20 ? 'strong' : 'likely' },
    bars: [['Avg win', w], ['Avg loss', -l]],
    unit: 'usd',
    trades: [],
  };
}

function biggestLoss(trades) {
  const losses = trades.filter((t) => t.outcome === 'loss');
  const wins = trades.filter((t) => t.outcome === 'win');
  if (!losses.length || !wins.length) return null;
  const worst = losses.reduce((a, b) => (b.pnl < a.pnl ? b : a));
  const avgWin = mean(wins.map((t) => t.pnl));
  const erased = Math.floor(-worst.pnl / avgWin);
  if (erased < 2) return null;
  return {
    id: 'biggest',
    group: 'risk',
    title: `One trade, ${worst.ticker} (${usd(worst.pnl)}), wiped out the gains of ${erased} average winning trades`,
    detail: `Closed ${worst.close}, held ${worst.days} days, ${pct(worst.ret)}.`,
    tone: 'bad',
    confidence: { level: 'strong' },
    trades: [worst.id],
  };
}

function streak(trades) {
  let longest = [];
  let run = [];
  for (const t of trades) {
    if (t.outcome === 'loss') run.push(t);
    else if (t.outcome === 'win') run = [];
    if (run.length > longest.length) longest = [...run];
  }
  if (longest.length < 3) return null;
  return {
    id: 'streak',
    group: 'risk',
    title: `Your longest losing streak was ${longest.length} trades in a row, ${usd(sum(longest.map((t) => t.pnl)))}`,
    detail: `From ${longest[0].close} to ${longest[longest.length - 1].close}.`,
    tone: 'bad',
    confidence: { level: 'strong' },
    trades: ids(longest),
  };
}

export const GROUPS = [
  ['behaviour', 'Your behaviour'],
  ['timing', 'Your timing'],
  ['what', 'What you trade'],
  ['risk', 'Your risk'],
];

/**
 * Every insight the trades support, strongest first within each group. Below
 * MIN_TRADES closed trades in all, only what is needed to get there.
 */
export function insightsFor(positions) {
  const trades = tradesOf(positions);
  if (trades.length < MIN_TRADES) return { trades: trades.length, needed: MIN_TRADES - trades.length, insights: [] };
  const rank = { strong: 0, likely: 1, possible: 2, early: 3 };
  const insights = [
    emotion(trades), holding(trades), revenge(trades), averaging(trades),
    weekday(trades), style(trades),
    sectors(trades), worstTicker(trades), shorts(trades),
    size(trades), payoff(trades), biggestLoss(trades), streak(trades),
  ].filter(Boolean)
    .sort((a, b) => GROUPS.findIndex(([g]) => g === a.group) - GROUPS.findIndex(([g]) => g === b.group)
      || rank[a.confidence?.level ?? 'early'] - rank[b.confidence?.level ?? 'early']);
  return { trades: trades.length, needed: 0, insights };
}

/** The week before this one, Monday to Sunday: what closed in it, and what a weekly review says about it. */
export function weekReview(positions, today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const from = monday.toISOString().slice(0, 10);
  const to = sunday.toISOString().slice(0, 10);
  const closed = tradesOf(positions).filter((t) => t.close >= from && t.close <= to);
  const emotional = closed.filter((t) => t.mind != null && t.mind <= 4);
  return {
    from,
    to,
    closed: closed.length,
    won: closed.filter((t) => t.outcome === 'win').length,
    pnl: sum(closed.map((t) => t.pnl)),
    emotional: emotional.length,
    emotionalLost: emotional.filter((t) => t.outcome === 'loss').length,
    emotionalPnl: sum(emotional.map((t) => t.pnl)),
  };
}
