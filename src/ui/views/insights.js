/**
 * Insights, the personal analyst (November 2026): a briefing first (who you
 * are as a trader, your strengths, your weaknesses, what stands out right
 * now), then the evidence behind it — you against the market, your risk,
 * your calendar, what happened after you sold, your mind.
 *
 * Everything about the person is worked out on this device by
 * core/insights.js; only public market data is fetched (the S&P 500, Fear &
 * Greed, big-news days, each stock's closes). Observations about the past,
 * never advice.
 */
import { state } from '../../core/store.js';
import { analyse, MIN_GROUP, MIN_TRADES } from '../../core/insights.js';
import { accountTotals } from '../../core/portfolio.js';
import { authoritativeHistory, portfolioHistory } from '../../core/snapshots.js';
import { benchmarkSeries } from '../../services/benchmark.js';
import { dailySeries, historySymbol } from '../../services/history.js';
import { amountsHidden, MASK, ensureHistory } from './home.js';
import { escapeHtml, pnlColor as clr } from '../format.js';

const el = (id) => document.getElementById(id);
const pct = (n, d = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`;
const usd = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
/** With the eye closed, dollar amounts in sentences are masked too; percentages stay, as everywhere. */
const masked = (text) => (amountsHidden() ? String(text ?? '').replace(/[+−-]?\$[\d,]+(\.\d+)?/g, MASK) : String(text ?? ''));
const safe = (text) => escapeHtml(masked(text));
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const SECTIONS = [
  ['market', 'You vs the market'],
  ['risk', 'Your risk'],
  ['calendar', 'Your calendar'],
  ['after', 'After you sold'],
  ['mind', 'Your mind'],
];

const BADGE = {
  strong: ['Strong', 'Very unlikely to be chance'],
  likely: ['Likely', 'Probably a real pattern, not yet certain'],
  possible: ['Possible', 'Could easily be chance: a hint, not a fact'],
  early: ['Too early', 'Not enough evidence to say yet'],
};

/* ── what the page remembers between draws ── */

let opened = null;
let period = 'year';
let allRows = false;
let index = null;
let market = null;
const series = new Map();
const asked = new Set();
let drawn = 0;

/* ── the market data, fetched once ── */

const MARKET_KEY = 'pt_insights_market';
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

/* ── pieces ── */

function badgeHtml(c) {
  if (!c) return '';
  const [label, why] = BADGE[c.level ?? 'early'];
  const more = c.level === 'early' && c.needed ? ` · ${c.needed} more` : '';
  return `<span class="ins-badge ins-${c.level}" title="${escapeHtml(why)}">${label}${more}</span>`;
}

function fmt(v, unit) {
  if (unit === 'usd') return masked(usd(v));
  if (unit === 'days') return `${Math.round(v)} d`;
  if (unit === 'pts') return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pts`;
  if (unit === 'vol') return `${v.toFixed(0)}%`;
  return pct(v, unit === 'pct2' ? 2 : 1);
}

function barsHtml(bars, unit) {
  if (!bars?.length) return '';
  const top = Math.max(...bars.map(([, v]) => Math.abs(v)), 1e-9);
  const neutral = unit === 'days' || unit === 'vol';
  return `<div class="ins-bars">${bars.map(([label, v]) => `<div class="ins-bar">
      <span class="ins-bl">${escapeHtml(label)}</span>
      <span class="ins-bt"><span class="${neutral ? 'is-days' : v >= 0 ? 'is-up' : 'is-down'}" style="width:${Math.max(2, (Math.abs(v) / top) * 100)}%"></span></span>
      <span class="ins-bv" style="color:${neutral ? 'var(--text2)' : clr(v)}">${fmt(v, unit)}</span>
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

function moreButton(card) {
  const n = card.trades?.length ?? 0;
  if (!n) return '';
  const open = opened === card.id;
  return `<button type="button" class="ins-more" data-ins-trades="${card.id}" aria-expanded="${open}">${open ? 'Hide' : 'See'} the ${n === 1 ? 'trade' : `${n} trades`}</button>${open ? tradesHtml(card.trades) : ''}`;
}

function monthsTable(rows) {
  return `<div class="ins-table" role="table">
      <div class="ins-tr ins-th" role="row"><span>Month</span><span>You</span><span>S&amp;P</span><span>Gap</span></div>
      ${rows.map((r) => `<div class="ins-tr" role="row"><span>${escapeHtml(r.label)}${r.live ? ' <i>so far</i>' : ''}</span>
        <span style="color:${clr(r.you)}">${pct(r.you)}</span><span style="color:${clr(r.spx)}">${pct(r.spx)}</span>
        <span class="ins-gap ${r.you >= r.spx ? 'is-up' : 'is-down'}">${r.you >= r.spx ? '✓' : '✗'} ${Math.abs(r.you - r.spx).toFixed(1)}</span></div>`).join('')}
    </div>`;
}

function cardHtml(card) {
  if (card.id === 'twin') return twinHtml(card);
  const early = card.confidence?.level === 'early';
  return `<article class="card ins-card ins-${card.tone ?? 'neutral'}${early ? ' is-early' : ''}" id="ins-${card.id}">
      ${card.confidence ? `<div class="ins-top">${badgeHtml(card.confidence)}</div>` : ''}
      <h3 class="ins-title">${safe(card.title)}</h3>
      ${card.why ? `<p class="ins-why"><span>Why</span>${safe(card.why)}</p>` : ''}
      ${card.matters ? `<p class="ins-matters"><span>What it meant</span>${safe(card.matters)}</p>` : ''}
      ${early ? '' : barsHtml(card.bars, card.unit)}
      ${card.table ? monthsTable(card.table) : ''}
      ${moreButton(card)}
    </article>`;
}

/* ── #8 the S&P twin ── */

function chartSvg(points) {
  const step = Math.max(1, Math.ceil(points.length / 160));
  const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const values = pts.flatMap((p) => [p.you, p.twin]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const W = 640;
  const H = 170;
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
  return `<svg class="tw-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Your trades' profit against your S&amp;P twin">
      ${fills.join('')}
      <path class="tw-twin" d="${line('twin')}"/>
      <path class="tw-you" d="${line('you')}"/>
    </svg>
    <div class="tw-axis"><span>${shortDate(pts[0].date)} ${pts[0].date.slice(0, 4)}</span><span>${shortDate(pts[pts.length - 1].date)}</span></div>`;
}

function twinHtml(card) {
  const p = card.twin[period] ?? card.twin.all;
  const which = card.twin[period] ? period : 'all';
  const ahead = p.diff >= 0;
  const rows = allRows ? p.rows : p.rows.slice(0, 8);
  const dollars = (n) => safe(`$${Math.abs(Math.round(n)).toLocaleString('en-US')}`);
  const share = (n) => (n != null ? ` <small>(${pct(n)})</small>` : '');
  const acc = p.account;
  return `<article class="card ins-card ins-twin ins-${ahead ? 'good' : 'bad'}" id="ins-twin">
      <div class="tw-head">
        <span class="card-lbl">Your S&amp;P twin</span>
        <div class="tw-tabs" role="tablist">
          ${card.twin.year ? `<button type="button" role="tab" data-twin-period="year" aria-selected="${which === 'year'}">This year</button>` : ''}
          <button type="button" role="tab" data-twin-period="all" aria-selected="${which === 'all'}">All time</button>
        </div>
      </div>
      <p class="tw-q">What if every trade had gone into the S&amp;P 500 instead: the same money, bought the day you bought and sold the day you sold?</p>
      <div class="tw-nums">
        <div><span>You made</span><b style="color:${clr(p.you)}">${safe(usd(p.you))}${share(p.youPct)}</b></div>
        <div><span>The S&amp;P would have made</span><b style="color:${clr(p.twin)}">${safe(usd(p.twin))}${share(p.twinPct)}</b></div>
        <div><span>${ahead ? 'Your picks beat the S&amp;P by' : 'The S&amp;P beat your picks by'}</span><b style="color:${clr(p.diff)}">${dollars(p.diff)}</b></div>
      </div>
      ${chartSvg(p.series)}
      <div class="tw-legend"><span><i class="tw-k-you"></i>Your trades</span><span><i class="tw-k-twin"></i>S&amp;P twin</span><span><i class="tw-k-ahead"></i>Ahead</span><span><i class="tw-k-behind"></i>Behind</span></div>
      ${p.decided ? `<p class="tw-score">You beat the S&amp;P on <b>${p.beat} of ${p.decided}</b> closed trades.${p.best && p.best.diff > 0 ? ` Your best call: <b>${escapeHtml(p.best.ticker)}</b>, ${safe(usd(p.best.diff))} more than the S&amp;P.` : ''}${p.worst && p.worst.diff < 0 ? ` Your costliest: <b>${escapeHtml(p.worst.ticker)}</b>, ${dollars(p.worst.diff)} worse than the S&amp;P.` : ''}</p>` : ''}
      ${rows.length ? `<div class="ins-table tw-table" role="table">
        <div class="ins-tr ins-th" role="row"><span>Trade</span><span>Held</span><span>You made</span><span>S&amp;P would have</span><span>Result</span></div>
        ${rows.map((r) => `<div class="ins-tr" role="row"><span><b>${escapeHtml(r.ticker)}</b></span>
          <span>${shortDate(r.open)} → ${r.live ? 'open' : shortDate(r.close)}</span>
          <span style="color:${clr(r.you)}">${safe(usd(r.you))}</span><span style="color:${clr(r.spx)}">${safe(usd(r.spx))}</span>
          <span class="ins-gap ${r.diff >= 0 ? 'is-up' : 'is-down'}">${r.diff >= 0 ? 'You' : 'S&amp;P'} ${safe(`$${Math.abs(Math.round(r.diff)).toLocaleString('en-US')}`)}</span></div>`).join('')}
      </div>
      ${p.rows.length > 8 ? `<button type="button" class="ins-more" data-twin-all>${allRows ? 'Show the largest 8' : `Show all ${p.rows.length} trades`}</button>` : ''}` : ''}
      ${acc ? `<p class="tw-account"><b>Your whole account</b> against putting every deposit in the S&amp;P and holding it, since ${shortDate(acc.from)} ${acc.from.slice(0, 4)}: <b style="color:${clr(acc.diff)}">${acc.diff >= 0 ? 'ahead' : 'behind'} by ${dollars(acc.diff)}${acc.diffPct != null ? ` (${pct(acc.diffPct)})` : ''}</b>. This one also counts cash left idle and time out of the market.</p>` : ''}
      <p class="ins-small">Closed trades count on the day they closed; open positions count up to today. Percentages are on the money you put into these trades. S&amp;P 500 with dividends reinvested.</p>
    </article>`;
}

/* ── the briefing and the trader card ── */

function headline(a) {
  const parts = [];
  if (a.year.you != null && a.year.spx != null) {
    const gap = a.year.you - a.year.spx;
    parts.push(`This year your account is <b style="color:${clr(a.year.you)}">${pct(a.year.you)}</b> and the S&amp;P 500 ${pct(a.year.spx)}: you are ${gap >= 0 ? 'ahead' : 'behind'} by ${Math.abs(gap).toFixed(1)} points.`);
  }
  if (a.profile.title) parts.push(`You trade like <b>${a.profile.title.icon} ${escapeHtml(a.profile.title.name)}</b>.`);
  if (a.trades) parts.push(`${a.trades} closed trade${a.trades === 1 ? '' : 's'}, ${Math.round(a.winRate)}% won.`);
  return parts.join(' ');
}

function listHtml(items, kind, empty) {
  if (!items.length) return `<p class="br-empty">${empty}</p>`;
  return `<ul>${items.map((x) => `<li${x.id ? ` data-goto="${x.id}"` : ''} class="br-${kind}${x.tone ? ` is-${x.tone}` : ''}">${safe(x.text)}</li>`).join('')}</ul>`;
}

function briefingHtml(a) {
  return `<section class="card ins-brief">
      <div class="br-head"><span class="br-mark">✦</span><span class="card-lbl">Your analyst's briefing</span></div>
      <p class="br-line">${headline(a) || 'Your briefing fills in as your account history and trades load.'}</p>
      <div class="br-cols">
        <div><h4>Strengths</h4>${listHtml(a.briefing.strengths, 'good', 'Nothing solid enough to call a strength yet.')}</div>
        <div><h4>Weaknesses</h4>${listHtml(a.briefing.weaknesses, 'bad', 'Nothing solid enough to call a weakness yet.')}</div>
        <div><h4>Right now</h4>${listHtml((a.now?.items ?? []).slice(0, 3), 'now', 'Nothing in your open positions stands out.')}</div>
      </div>
    </section>`;
}

function profileHtml(a) {
  const { title, allBadges, records } = a.profile;
  if (!title && !records.length) return '';
  return `<h2 class="ins-group">Your trader card</h2>
    <section class="card ins-profile">
      ${title ? `<div class="pf-title"><span class="pf-icon">${title.icon}</span><div><b>${escapeHtml(title.name)}</b><p>${safe(title.why)}</p></div></div>` : `<p class="ins-small">Your title arrives at ${MIN_TRADES} closed trades.</p>`}
      ${allBadges.length ? `<div class="pf-badges">${allBadges.slice(0, 2).map((b) => `<span class="pf-badge" title="${escapeHtml(b.why)}"><i>${b.icon}</i>${escapeHtml(b.name)}<small>${safe(b.why)}</small></span>`).join('')}</div>
        ${allBadges.length > 2 ? `<p class="ins-small">Also earned: ${allBadges.slice(2).map((b) => `${b.icon} ${escapeHtml(b.name)}`).join(' · ')}</p>` : ''}` : ''}
      ${records.length ? `<div class="pf-records">${records.map((r) => `<div><span>${escapeHtml(r.label)}</span><b>${safe(r.value)}</b><small>${safe(r.sub)}</small></div>`).join('')}</div>` : ''}
    </section>`;
}

function nowHtml(now) {
  if (!now?.items?.length) return '';
  return `<h2 class="ins-group">Right now</h2>
    <section class="card ins-now"><ul>${now.items.map((x) => `<li class="is-${x.tone}">${safe(x.text)}</li>`).join('')}</ul>
    <p class="ins-small">What stands out in your open positions, measured against your own closed trades.</p></section>`;
}

function emptyHtml(trades, needed) {
  return `<section class="card ins-empty">
      <h3>Trade patterns start at ${MIN_TRADES} closed trades</h3>
      <p>You have ${trades}. ${needed} more and your analyst starts reading your trades: your trader title, your best and worst day, how the market's mood and big news affect you, what happened after you sold.</p>
      <p class="ins-small">Rate your state of mind on each trade (New trade → State of mind) to unlock the emotional insights.</p>
    </section>`;
}

/* ── the page ── */

function draw() {
  const body = el('insightsBody');
  if (!body) return;
  const forward = authoritativeHistory();
  const a = analyse({
    positions: state.positions,
    history: forward.length ? forward : portfolioHistory(),
    index: index ?? [],
    fearGreed: market?.fearGreed ?? [],
    bigDays: market?.bigDays ?? [],
    series,
    accountValue: accountTotals(state.positions, state.cash).account,
  });
  const sections = SECTIONS.map(([key, label]) => {
    const cards = a.cards.filter((c) => c.section === key);
    return cards.length ? `<h2 class="ins-group">${escapeHtml(label)}</h2><div class="ins-grid">${cards.map(cardHtml).join('')}</div>` : '';
  }).join('');
  body.innerHTML = `${briefingHtml(a)}
    ${profileHtml(a)}
    ${a.needed ? emptyHtml(a.trades, a.needed) : ''}
    ${sections}
    ${nowHtml(a.now)}
    <p class="ins-foot">Worked out on this device from your own trades and account; only public market data is fetched. These describe what you have done, not what you should do, and are not investment advice. A comparison needs ${MIN_GROUP} on each side and is checked against chance before it is called Strong or Likely.</p>`;
}

let bound = false;
function bind() {
  if (bound) return;
  const page = el('insights');
  if (!page) return;
  bound = true;
  page.addEventListener('click', (e) => {
    const more = e.target.closest('[data-ins-trades]');
    if (more) {
      opened = opened === more.dataset.insTrades ? null : more.dataset.insTrades;
      draw();
      return;
    }
    const tab = e.target.closest('[data-twin-period]');
    if (tab) { period = tab.dataset.twinPeriod; allRows = false; draw(); return; }
    if (e.target.closest('[data-twin-all]')) { allRows = !allRows; draw(); return; }
    const go = e.target.closest('[data-goto]');
    if (go) el(`ins-${go.dataset.goto}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

const historyRows = () => (authoritativeHistory().length ? authoritativeHistory() : portfolioHistory());
const visible = () => el('insights')?.classList.contains('active') || el('insights')?.offsetParent != null;
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
