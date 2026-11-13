/**
 * Insights, the personal analyst (November 2026), laid out for someone new
 * to investing: a short summary in plain words, the three things that stand
 * out, a simple "you against the market", your investing style, then your
 * habits and the deeper statistics, each one closed until it is opened.
 *
 * Every finding reads the same way: what we found, why it matters, your data
 * — and, for anyone who wants it, how it is calculated.
 *
 * Everything about the person is worked out on this device by
 * core/insights.js; only public market data is fetched. Observations about
 * the past, never advice.
 */
import { state } from '../../core/store.js';
import { analyse, MIN_GROUP, MIN_TRADES, FAMILIES as FAMILY_LIST, TITLES, TITLE_RULES, LEVELS } from '../../core/insights.js';
import { art } from '../art/cards.js';
import { accountTotals } from '../../core/portfolio.js';
import { authoritativeHistory, portfolioHistory } from '../../core/snapshots.js';
import { benchmarkSeries, benchmarkSpot, benchmarkYearToDate } from '../../services/benchmark.js';
import { dailySeries, historySymbol } from '../../services/history.js';
import { amountsHidden, MASK, ensureHistory, homeYearToDate } from './home.js';
import { escapeHtml, pnlColor as clr } from '../format.js';

const el = (id) => document.getElementById(id);
const pct = (n, d = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`;
const usd = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const dollars = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
/** With the eye closed, dollar amounts in sentences are masked too; percentages stay, as everywhere. */
const masked = (text) => (amountsHidden() ? String(text ?? '').replace(/[+−-]?\$[\d,’]+(\.\d+)?/g, MASK) : String(text ?? ''));
const safe = (text) => escapeHtml(masked(text));
/** Thousands marked with a raised separator in the S&P twin (13’761), so it can never read as a decimal point. */
const tw = (text) => String(text).replace(/(\d),(?=\d{3})/g, '$1’');
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const TONE = { good: 'Strength', bad: 'Area to improve', neutral: 'Worth knowing' };
const SURE = {
  strong: ['Clear pattern', 'Very unlikely to be chance'],
  likely: ['Likely pattern', 'Probably real, not yet certain'],
  possible: ['Early sign', 'Could still be chance: a hint, not a conclusion'],
};

/* ── what the page remembers between draws ── */

const opened = new Set();
let period = 'year';
let allRows = false;
let index = null;
let market = null;
const series = new Map();
const asked = new Set();
let drawn = 0;

/* ── the market data, fetched once ── */

const MARKET_KEY = 'pt_insights_market_v2';
const MARKET_MS = 12 * 3600 * 1000;

async function loadMarket() {
  if (market) return market;
  try {
    const cached = JSON.parse(localStorage.getItem(MARKET_KEY) ?? 'null');
    if (cached?.at && Date.now() - cached.at < MARKET_MS && cached.data) { market = cached.data; return market; }
  } catch { /* fetched below */ }
  try {
    const res = await fetch('/api/insights-data', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    market = { fearGreed: Array.isArray(data?.fearGreed) ? data.fearGreed : [], bigDays: Array.isArray(data?.bigDays) ? data.bigDays : [] };
    try { localStorage.setItem(MARKET_KEY, JSON.stringify({ at: Date.now(), data: market })); } catch { /* kept for the session */ }
    return market;
  } catch {
    return null;
  }
}

/**
 * Each traded stock's closes: for the twin's daily line, the run-up before a
 * buy and the month after a sale. Every open position, and the 40 most
 * recently closed, four at a time.
 */
async function loadSeries() {
  const latest = new Map();
  for (const p of state.positions) {
    if (p?.status !== 'Closed' || !p.ticker || !p.close) continue;
    if (!latest.has(p.ticker) || latest.get(p.ticker).close < p.close) latest.set(p.ticker, p);
  }
  const held = state.positions.filter((p) => p?.status !== 'Closed' && p.ticker);
  const recent = [...latest.values()].sort((a, b) => b.close.localeCompare(a.close)).slice(0, 40);
  const wanted = [...new Map([...held, ...recent].map((p) => [p.ticker, p])).values()]
    .filter((p) => !asked.has(p.ticker));
  for (let i = 0; i < wanted.length; i += 4) {
    await Promise.all(wanted.slice(i, i + 4).map(async (p) => {
      asked.add(p.ticker);
      try {
        const rows = await dailySeries(historySymbol(p.ticker, p.cls));
        if (rows?.length) series.set(p.ticker, rows);
      } catch { /* that stock simply has no context */ }
    }));
  }
  return wanted.length > 0;
}

/* ── small pieces ── */

function fmt(v, unit) {
  if (unit === 'usd') return masked(usd(v));
  if (unit === 'days') return `${Math.round(v)} days`;
  if (unit === 'pts') return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pts`;
  if (unit === 'vol') return `${v.toFixed(0)}% a year`;
  if (unit === 'move') return `±${v.toFixed(2)}%`;
  if (unit === 'rate') return `${Math.round(v)}% won`;
  return pct(v, unit === 'pct2' ? 2 : 1);
}

function barsHtml(bars, unit) {
  if (!bars?.length) return '';
  const top = Math.max(...bars.map(([, v]) => Math.abs(v)), 1e-9);
  const neutral = unit === 'days' || unit === 'vol' || unit === 'move';
  // A win rate is good above half and weak below it; the bar runs from 0 to 100.
  const sign = (v) => (unit === 'rate' ? v - 50 : v);
  const width = (v) => (unit === 'rate' ? v : (Math.abs(v) / top) * 100);
  return `<div class="ins-bars">${bars.map(([label, v]) => `<div class="ins-bar">
      <span class="ins-bl">${escapeHtml(label)}</span>
      <span class="ins-bt"><span class="${neutral ? 'is-days' : sign(v) >= 0 ? 'is-up' : 'is-down'}" style="width:${Math.max(2, width(v))}%"></span></span>
      <span class="ins-bv" style="color:${neutral ? 'var(--text2)' : clr(sign(v))}">${fmt(v, unit)}</span>
    </div>`).join('')}</div>`;
}

function tradesHtml(list) {
  const byId = new Map(state.positions.map((p) => [p.id, p]));
  const rows = list.map((id) => byId.get(id)).filter(Boolean).map((p) => {
    const cost = Math.abs(p.entry * p.qty);
    const pnl = (p.dir === 'Long' ? p.cur - p.entry : p.entry - p.cur) * p.qty;
    return `<div class="ins-trade"><b>${escapeHtml(p.ticker)}</b><span>${shortDate(p.open)} → ${p.close ? shortDate(p.close) : 'open'}</span>
      <span style="color:${clr(pnl)}">${cost ? pct((pnl / cost) * 100) : '—'}</span><span style="color:${clr(pnl)}">${masked(usd(pnl))}</span></div>`;
  });
  return `<div class="ins-trades">${rows.join('')}</div>`;
}

function monthsTable(rows) {
  return `<div class="ins-table" role="table">
      <div class="ins-tr ins-th" role="row"><span>Month</span><span>You</span><span>S&amp;P 500</span><span>Result</span></div>
      ${rows.map((r) => `<div class="ins-tr" role="row"><span>${escapeHtml(r.label)}${r.live ? ' <i>so far</i>' : ''}</span>
        <span style="color:${clr(r.you)}">${pct(r.you)}</span><span style="color:${clr(r.spx)}">${pct(r.spx)}</span>
        <span class="ins-gap ${r.you >= r.spx ? 'is-up' : 'is-down'}">${r.you >= r.spx ? 'Ahead' : 'Behind'}</span></div>`).join('')}
    </div>`;
}

const early = (c) => c.confidence?.level === 'early' || !c.headline;

function waitingText(c) {
  const n = c.confidence?.needed ?? 1;
  const unit = c.confidence?.unit ?? 'closed trades';
  return `We need ${n} more ${unit} before we can say anything here.${c.hint ? ` ${c.hint}` : ''}`;
}

/** What we found → why it matters → your data, then the deeper layer behind a toggle. */
function findingHtml(c) {
  if (early(c)) return `<p class="ins-wait">${escapeHtml(waitingText(c))}</p>`;
  const sure = c.confidence && SURE[c.confidence.level];
  const n = c.trades?.length ?? 0;
  const more = opened.has(`trades:${c.id}`);
  return `<p class="ins-matters">${safe(c.matters)}</p>
    <div class="ins-data"><span>Your data</span>${safe(c.data)}</div>
    ${c.more ? `<p class="ins-moretext">${safe(c.more)}</p>` : ''}
    ${barsHtml(c.bars, c.unit)}
    ${c.table ? monthsTable(c.table) : ''}
    ${c.cause ? `<div class="ins-cause"><span>What these trades have in common</span>${safe(c.cause)}</div>` : ''}
    <details class="ins-how"><summary>How we calculate this</summary><p>${escapeHtml(c.how ?? '')}${sure ? ` <b>${sure[0]}:</b> ${escapeHtml(sure[1].toLowerCase())}.` : ''}</p></details>
    ${n ? `<button type="button" class="ins-more" data-ins-trades="${c.id}" aria-expanded="${more}">${more ? 'Hide' : 'See'} the ${n === 1 ? 'trade' : `${n} trades`}</button>${more ? tradesHtml(c.trades) : ''}` : ''}`;
}

function chips(c) {
  if (early(c)) return '<span class="ins-chip is-wait">Not enough data yet</span>';
  const sure = c.confidence && SURE[c.confidence.level];
  return `<span class="ins-chip is-${c.tone ?? 'neutral'}">${TONE[c.tone ?? 'neutral']}</span>${sure ? `<span class="ins-chip is-sure" title="${escapeHtml(sure[1])}">${sure[0]}</span>` : ''}`;
}

/** A closed row that opens into the finding. */
function rowHtml(c) {
  const open = opened.has(c.id);
  return `<div class="ins-row${open ? ' is-open' : ''}${early(c) ? ' is-early' : ''}" id="ins-${c.id}">
      <button type="button" class="ins-rowhead" data-ins-open="${c.id}" aria-expanded="${open}">
        <span class="ins-dot is-${early(c) ? 'wait' : c.tone ?? 'neutral'}"></span>
        <span class="ins-rowtitle">${safe(early(c) ? c.topic : c.headline)}</span>
        <span class="ins-chev" aria-hidden="true">›</span>
      </button>
      ${open ? `<div class="ins-rowbody"><div class="ins-chips">${chips(c)}</div>${findingHtml(c)}</div>` : ''}
    </div>`;
}

/* ── 1. the summary ── */

function summaryHtml(a) {
  const yr = a.year;
  const year = yr.you != null && yr.spx != null
    ? `<div class="hero-year"><div><span>Your account this year</span><b style="color:${clr(yr.you)}">${pct(yr.you)}</b></div><div><span>S&amp;P 500 this year</span><b style="color:${clr(yr.spx)}">${pct(yr.spx)}</b></div></div>`
    : '';
  return `<section class="card ins-hero${year ? ' has-year' : ''}">
      <div class="hero-main">
        <div class="hero-head"><span class="hero-mark">✦</span><span>Your analyst</span></div>
        <p class="hero-text">${safe(a.summary)}</p>
      </div>
      ${year}
    </section>`;
}

/* ── 2. what stands out ── */

function standOutHtml(a) {
  if (!a.standOut.length) return '';
  const byId = new Map(a.cards.map((c) => [c.id, c]));
  return `<h2 class="ins-group">What stands out</h2>
    <div class="ins-standout">${a.standOut.map((s) => {
      const c = byId.get(s.id);
      const open = opened.has(`top:${c.id}`);
      return `<article class="card ins-top is-${s.kind}">
          <span class="ins-kind">${escapeHtml(s.label)}</span>
          <h3>${safe(c.headline)}</h3>
          <p class="ins-matters">${safe(c.matters)}</p>
          <div class="ins-data"><span>Your data</span>${safe(c.data)}</div>
          <button type="button" class="ins-more" data-ins-top="${c.id}" aria-expanded="${open}">${open ? 'Show less' : 'Show details'}</button>
          ${open ? `<div class="ins-topmore">${c.more ? `<p class="ins-moretext">${safe(c.more)}</p>` : ''}${barsHtml(c.bars, c.unit)}${c.cause ? `<div class="ins-cause"><span>What these trades have in common</span>${safe(c.cause)}</div>` : ''}<details class="ins-how"><summary>How we calculate this</summary><p>${escapeHtml(c.how ?? '')}</p></details></div>` : ''}
        </article>`;
    }).join('')}</div>`;
}

/* ── 3. you against the market ── */

function chartSvg(points) {
  if (!points?.length) return '';
  const step = Math.max(1, Math.ceil(points.length / 160));
  const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const values = pts.flatMap((p) => [p.you, p.twin, 0]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const W = 640;
  const H = 160;
  const x = (i) => (pts.length > 1 ? (i / (pts.length - 1)) * W : 0);
  const y = (v) => (hi > lo ? 6 + (1 - (v - lo) / (hi - lo)) * (H - 12) : H / 2);
  const line = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const fills = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const ahead = (a.you - a.twin) + (b.you - b.twin) >= 0;
    fills.push(`<polygon class="${ahead ? 'tw-ahead' : 'tw-behind'}" points="${x(i - 1).toFixed(1)},${y(a.you).toFixed(1)} ${x(i).toFixed(1)},${y(b.you).toFixed(1)} ${x(i).toFixed(1)},${y(b.twin).toFixed(1)} ${x(i - 1).toFixed(1)},${y(a.twin).toFixed(1)}"/>`);
  }
  return `<svg class="tw-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Your trades' profit against the same money in the S&amp;P 500">
      <line class="tw-zero" x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
      ${fills.join('')}
      <path class="tw-twin" d="${line('twin')}"/>
      <path class="tw-you" d="${line('you')}"/>
    </svg>
    <div class="tw-axis"><span>${shortDate(pts[0].date)} ${pts[0].date.slice(0, 4)}</span><span>${shortDate(pts[pts.length - 1].date)}</span></div>`;
}

function marketHtml(a) {
  const card = a.cards.find((c) => c.id === 'twin');
  if (!card) return '';
  const p = card.twin[period] ?? card.twin.all;
  const which = card.twin[period] ? period : 'all';
  const ahead = p.diff >= 0;
  const detail = opened.has('twin:detail');
  const rows = allRows ? p.rows : p.rows.slice(0, 8);
  const acc = p.account;
  return `<h2 class="ins-group">You vs the market</h2>
    <section class="card ins-market" id="ins-twin">
      <div class="tw-head">
        <h3>${ahead ? 'Your picks are beating the market' : 'The market is ahead of your picks'}</h3>
        <div class="tw-tabs" role="tablist">
          ${card.twin.year ? `<button type="button" role="tab" data-twin-period="year" aria-selected="${which === 'year'}">This year</button>` : ''}
          <button type="button" role="tab" data-twin-period="all" aria-selected="${which === 'all'}">All time</button>
        </div>
      </div>
      <p class="tw-q">If every trade${which === 'year' ? ' you opened this year' : ''} had gone into the S&amp;P 500 instead, with the same money on the same days:</p>
      <div class="tw-nums">
        <div><span>You made</span><b style="color:${clr(p.you)}">${safe(tw(usd(p.you)))}</b></div>
        <div><span>The S&amp;P 500 would have made</span><b style="color:${clr(p.twin)}">${safe(tw(usd(p.twin)))}</b></div>
      </div>
      ${chartSvg(p.series)}
      <div class="tw-legend"><span><i class="tw-k-you"></i>Your trades</span><span><i class="tw-k-twin"></i>Same money in the S&amp;P 500</span></div>
      <button type="button" class="ins-more" data-ins-twin aria-expanded="${detail}">${detail ? 'Show less' : 'See trade by trade'}</button>
      ${detail ? `<div class="tw-detail">
        <div class="ins-data"><span>Your data</span>${safe(tw(`You beat the S&P 500 on ${p.beat} of ${p.decided} closed trades${p.open ? `, with ${p.open} still open` : ''}. Your trades made ${p.youPct != null ? pct(p.youPct) : '—'} on the money put in; the S&P 500 would have made ${p.twinPct != null ? pct(p.twinPct) : '—'}.${p.best ? ` Your best call: ${p.best.ticker}, ${dollars(p.best.diff)} more than the S&P 500.` : ''}${p.worst ? ` Your costliest: ${p.worst.ticker}, ${dollars(p.worst.diff)} behind it.` : ''}`))}</div>
        ${p.luck?.level && p.luck.level !== 'early' ? `<p class="ins-matters">${p.luck.level === 'strong' ? 'Your edge over the market is very unlikely to be luck.' : p.luck.level === 'likely' ? 'Your edge over the market is probably real, though not yet certain.' : 'It is still too early to tell whether this is skill or luck.'}</p>` : ''}
        <div class="ins-table tw-table" role="table">
          <div class="ins-tr ins-th" role="row"><span>Trade</span><span>Held</span><span>You made</span><span>S&amp;P 500</span><span>Result</span></div>
          ${rows.map((r) => `<div class="ins-tr" role="row"><span><b>${escapeHtml(r.ticker)}</b></span>
            <span>${shortDate(r.open)} → ${r.live ? 'open' : shortDate(r.close)}</span>
            <span style="color:${clr(r.you)}">${safe(tw(usd(r.you)))}</span><span style="color:${clr(r.spx)}">${safe(tw(usd(r.spx)))}</span>
            <span class="ins-gap ${r.diff >= 0 ? 'is-up' : 'is-down'}">${r.diff >= 0 ? 'You' : 'S&amp;P'} ${safe(tw(dollars(r.diff)))}</span></div>`).join('')}
        </div>
        ${p.rows.length > 8 ? `<button type="button" class="ins-more" data-twin-all>${allRows ? 'Show the largest 8' : `Show all ${p.rows.length} trades`}</button>` : ''}
        ${acc ? `<p class="tw-account"><b>Your whole account</b> against putting every deposit in the S&amp;P 500 and holding it, since ${shortDate(acc.from)} ${acc.from.slice(0, 4)}: <b style="color:${clr(acc.diff)}">${acc.diff >= 0 ? 'ahead' : 'behind'} by ${safe(tw(dollars(acc.diff)))}</b>. This one also counts cash left idle and time out of the market.</p>` : ''}
        <details class="ins-how"><summary>How we calculate this</summary><p>Each time you bought, the same amount buys the S&amp;P 500 (with dividends reinvested) at that day's close. Each time you sold part or all of the position, the same share of that S&amp;P 500 holding is sold that day. Open positions are valued today. The chart adds up both sides every market day. A short is matched with the same money in the S&amp;P 500, bought. "This year" covers the trades you opened this year.</p></details>
      </div>` : ''}
    </section>`;
}

/* ── 4. your investing style ── */

const RARITY_NAME = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
const longDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Two cards fanned out: the button that opens every card. */
const CARDS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="11" height="15" rx="2" transform="rotate(-10 9 12.5)"/><rect x="9.5" y="4" width="11" height="15" rx="2"/></svg>';

/** One collectible card: earned, with its date and story, or locked, with how to earn it. */
function achievementHtml(c) {
  return `<div class="ach r-${c.rarity}${c.earned ? '' : ' is-locked'}" title="${escapeHtml(c.earned ? c.how : `Locked: ${c.how}`)}">
      <span class="ach-icon">${art(c.key)}${c.earned ? '' : '<i class="ach-lock" aria-hidden="true">🔒</i>'}</span>
      <b>${escapeHtml(c.name)}</b>
      <span class="ach-rar">${RARITY_NAME[c.rarity]}</span>
      <small>${c.earned ? `${safe(c.detail)}<em>${longDay(c.earned)}</em>` : escapeHtml(c.how)}</small>
    </div>`;
}

/** The trader card: one main title (level · style), the progress to the next level, and the collection. */
function styleHtml(a) {
  const { title, level, collection, records } = a.profile;
  const rec = opened.has('records');
  const all = opened.has('collection');
  const { next, points } = collection;
  const progress = next ? Math.min(100, ((points - next.from) / (next.points - next.from)) * 100) : 100;
  const earned = collection.cards.filter((c) => c.earned).sort((x, y) => y.earned.localeCompare(x.earned));
  const byFamily = (key) => collection.cards.filter((c) => c.family === key)
    .sort((x, y) => Number(Boolean(y.earned)) - Number(Boolean(x.earned)));
  return `<h2 class="ins-group">Your trader card</h2>
    <section class="card ins-profile">
      <div class="pf-title"><span class="pf-icon">${title ? art(`style:${title.key}`) : art('ten')}</span><div>
        <b><span class="pf-level">${escapeHtml(level)}</span>${title ? ` · ${escapeHtml(title.name)}` : ''}</b>
        <p>${title ? safe(title.why) : `Your trading style appears after ${MIN_TRADES} closed trades. You have ${a.trades}.`}</p>
      </div>
      <button type="button" class="pf-all" data-ins-allcards aria-label="See every title and achievement" title="See every title and achievement">${CARDS_ICON}</button></div>
      <div class="pf-progress">
        <div class="pf-bar" role="progressbar" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(3, progress)}%"></span></div>
        <p>${collection.earned} of ${collection.total} achievements · ${points} points${next ? ` · Next: <b>${escapeHtml(next.name)}</b> at ${next.points} points` : ' · The highest level'}</p>
      </div>
      <div class="pf-collection">
        <div class="pf-colhead"><h3>Your collection</h3><button type="button" class="ins-more" data-ins-collection aria-expanded="${all}">${all ? 'Show only what you have' : `See all ${collection.total} cards`}</button></div>
        ${all
    ? FAMILY_LIST.map(([key, label]) => `<h4 class="pf-family">${escapeHtml(label)}</h4><div class="ach-grid">${byFamily(key).map(achievementHtml).join('')}</div>`).join('')
    : earned.length
      ? `<div class="ach-grid">${earned.slice(0, 8).map(achievementHtml).join('')}</div>${earned.length > 8 ? `<p class="ins-small">And ${earned.length - 8} more.</p>` : ''}`
      : '<p class="ins-wait">No achievements yet. Your first one comes with your first closed trade.</p>'}
      </div>
      ${records.length ? `<button type="button" class="ins-more" data-ins-records aria-expanded="${rec}">${rec ? 'Hide your records' : 'See your personal records'}</button>
        ${rec ? `<div class="pf-records">${records.map((r) => `<div><span>${escapeHtml(r.label)}</span><b>${safe(r.value)}</b><small>${safe(r.sub)}</small></div>`).join('')}</div>` : ''}` : ''}
    </section>`;
}

/* ── 5 and 6. habits, and deeper ── */

function nowRow(now) {
  if (!now?.items?.length) return '';
  const open = opened.has('now');
  return `<div class="ins-row${open ? ' is-open' : ''}" id="ins-now">
      <button type="button" class="ins-rowhead" data-ins-open="now" aria-expanded="${open}">
        <span class="ins-dot is-neutral"></span><span class="ins-rowtitle">Worth a look in your open positions</span><span class="ins-chev" aria-hidden="true">›</span>
      </button>
      ${open ? `<div class="ins-rowbody"><ul class="ins-now">${now.items.map((x) => `<li class="is-${x.tone}">${safe(x.text)}</li>`).join('')}</ul>
        <p class="ins-small">Measured against your own closed trades. An observation, not a recommendation.</p></div>` : ''}
    </div>`;
}

function listHtml(title, intro, cards, extra = '') {
  if (!cards.length && !extra) return '';
  // Findings first, then what is still waiting for data.
  const sorted = [...cards].sort((x, y) => Number(early(x)) - Number(early(y)));
  return `<h2 class="ins-group">${escapeHtml(title)}</h2>
    <p class="ins-intro">${escapeHtml(intro)}</p>
    <section class="card ins-list">${sorted.map(rowHtml).join('')}${extra}</section>`;
}

/* ── every card, on its own screen ── */

let last = null;

/** Every level, every style and every achievement, opened from the circle beside the title. */
function openAllCards(a) {
  if (!a) return;
  document.querySelector('.cards-overlay')?.remove();
  const { title, level, collection } = a.profile;
  const styles = Object.keys(TITLE_RULES).map((key) => {
    const mine = title?.key === key;
    return `<div class="ach ${mine ? 'r-epic is-mine' : 'r-common'}">
        <span class="ach-icon">${art(`style:${key}`)}</span>
        <b>${escapeHtml(TITLES[key][1])}</b>
        ${mine ? '<span class="ach-rar">Your style</span>' : ''}
        <small>${escapeHtml(TITLE_RULES[key])}</small>
      </div>`;
  }).join('');
  const levels = LEVELS.map(([name, from]) => `<div class="lv${name === level ? ' is-mine' : ''}"><b>${escapeHtml(name)}</b><span>${from} points</span></div>`).join('');
  const families = FAMILY_LIST.map(([key, label]) => `<h4 class="pf-family">${escapeHtml(label)}</h4>
      <div class="ach-grid">${collection.cards.filter((c) => c.family === key).map(achievementHtml).join('')}</div>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'cards-overlay';
  overlay.innerHTML = `<div class="cards-panel" role="dialog" aria-modal="true" aria-labelledby="cardsTitle">
      <header class="cards-head"><h2 id="cardsTitle">Every card you can collect</h2><button type="button" class="cards-close" aria-label="Close">×</button></header>
      <p class="cards-intro">Your title has two parts: your <b>level</b>, which rises as you collect achievements, and your <b>style</b>, read from how you trade.</p>
      <h3>Levels</h3>
      <div class="lv-row">${levels}</div>
      <p class="ins-small">Each achievement is worth points by rarity: Common 1, Rare 2, Epic 3, Legendary 5. You have ${collection.points}.</p>
      <h3>Styles</h3>
      <div class="ach-grid">${styles}</div>
      <h3>Achievements · ${collection.earned} of ${collection.total}</h3>
      ${families}
    </div>`;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('.cards-close')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('.cards-close').focus();
}

/* ── the page ── */

function draw() {
  const body = el('insightsBody');
  if (!body) return;
  const forward = authoritativeHistory();
  const spx = index ? benchmarkYearToDate(index, benchmarkSpot()) : null;
  const a = analyse({
    positions: state.positions,
    history: forward.length ? forward : portfolioHistory(),
    index: index ?? [],
    fearGreed: market?.fearGreed ?? [],
    bigDays: market?.bigDays ?? [],
    series,
    accountValue: accountTotals(state.positions, state.cash).account,
    year: { you: homeYearToDate(), spx },
  });
  last = a;
  const habits = a.cards.filter((c) => c.group === 'habits');
  const deeper = a.cards.filter((c) => c.group === 'deeper');
  body.innerHTML = `${summaryHtml(a)}
    ${standOutHtml(a)}
    <div class="ins-cols is-market">
      <div class="ins-col">${marketHtml(a)}</div>
      <div class="ins-col">${styleHtml(a)}</div>
    </div>
    <div class="ins-cols">
      <div class="ins-col">${listHtml('Understand your habits', 'Patterns in how you trade. Tap any line to see why it matters and the numbers behind it.', habits, nowRow(a.now))}</div>
      <div class="ins-col">${listHtml('Explore deeper', 'More detailed statistics, for when you want to dig in.', deeper)}</div>
    </div>
    <p class="ins-foot">Worked out on this device from your own trades and account; only public market data is fetched. These describe what you have done, not what you should do, and are not investment advice. A pattern needs at least ${MIN_GROUP} examples on each side and is checked against chance before we call it one.</p>`;
}

let bound = false;
function bind() {
  if (bound) return;
  const page = el('insights');
  if (!page) return;
  bound = true;
  const toggle = (key) => { if (opened.has(key)) opened.delete(key); else opened.add(key); draw(); };
  page.addEventListener('click', (e) => {
    const row = e.target.closest('[data-ins-open]');
    if (row) return toggle(row.dataset.insOpen);
    const top = e.target.closest('[data-ins-top]');
    if (top) return toggle(`top:${top.dataset.insTop}`);
    const more = e.target.closest('[data-ins-trades]');
    if (more) return toggle(`trades:${more.dataset.insTrades}`);
    if (e.target.closest('[data-ins-twin]')) return toggle('twin:detail');
    if (e.target.closest('[data-ins-records]')) return toggle('records');
    if (e.target.closest('[data-ins-collection]')) return toggle('collection');
    if (e.target.closest('[data-ins-allcards]')) { openAllCards(last); return undefined; }
    const tab = e.target.closest('[data-twin-period]');
    if (tab) { period = tab.dataset.twinPeriod; allRows = false; draw(); return undefined; }
    if (e.target.closest('[data-twin-all]')) { allRows = !allRows; draw(); }
    return undefined;
  });
}

const historyRows = () => (authoritativeHistory().length ? authoritativeHistory() : portfolioHistory());
const visible = () => el('insights')?.classList.contains('active');
let waits = 0;

export async function renderInsights() {
  if (!el('insightsBody')) return;
  bind();
  draw();
  const run = ++drawn;
  // The data arrives when it arrives; the page draws with what it has, then again.
  const [ix, mk] = await Promise.allSettled([index ? index : benchmarkSeries(), loadMarket(), ensureHistory()]);
  if (ix.status === 'fulfilled' && ix.value) index = ix.value;
  if (mk.status === 'fulfilled' && mk.value) market = mk.value;
  if (run === drawn) draw();
  if (await loadSeries().catch(() => false)) { if (run === drawn) draw(); }
  // A history still being built (Home started it first) is looked for again, briefly.
  if (!historyRows().length && waits < 10) {
    waits += 1;
    setTimeout(() => { if (visible()) renderInsights(); }, 3000);
  } else if (historyRows().length) waits = 0;
}
