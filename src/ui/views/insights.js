/**
 * The Insights page (November 2026): last week in review, then what the
 * person's own closed trades say about them — behaviour, timing, what they
 * trade, risk — each with how sure it is and the trades behind it.
 *
 * Everything is worked out on this device by core/insights.js; nothing is
 * sent anywhere. Observations about the past, never advice.
 */
import { state } from '../../core/store.js';
import {
  insightsFor, weekReview, GROUPS, MIN_GROUP, MIN_TRADES,
} from '../../core/insights.js';
import { periodReturnFromHistory } from '../../core/portfolioHistory.js';
import { authoritativeHistory, portfolioHistory } from '../../core/snapshots.js';
import { benchmarkSeries } from '../../services/benchmark.js';
import { amountsHidden, MASK } from './home.js';
import { escapeHtml, pnlColor as clr } from '../format.js';

const el = (id) => document.getElementById(id);
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
const usd = (n) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
/** With the eye closed, dollar amounts in sentences are masked too; percentages stay, as everywhere. */
const masked = (text) => (amountsHidden() ? String(text).replace(/[+−-]?\$[\d,]+(\.\d+)?/g, MASK) : String(text));
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const BADGE = {
  strong: ['Strong', 'Very unlikely to be chance'],
  likely: ['Likely', 'Probably a real pattern, not yet certain'],
  possible: ['Possible', 'Could easily be chance — a hint, not a fact'],
  early: ['Too early', 'Not enough trades to say yet'],
};

let opened = null;

function badgeHtml(c) {
  const [label, why] = BADGE[c?.level ?? 'early'];
  const more = c?.level === 'early' && c.needed ? ` · ${c.needed} more trade${c.needed === 1 ? '' : 's'}` : '';
  return `<span class="ins-badge ins-${c?.level ?? 'early'}" title="${escapeHtml(why)}">${label}${more}</span>`;
}

function barsHtml(bars, unit) {
  if (!bars?.length) return '';
  const top = Math.max(...bars.map(([, v]) => Math.abs(v)), 1e-9);
  const fmt = (v) => (unit === 'usd' ? masked(usd(v)) : unit === 'days' ? `${Math.round(v)} d` : pct(v));
  return `<div class="ins-bars">${bars.map(([label, v]) => `<div class="ins-bar">
      <span class="ins-bl">${escapeHtml(label)}</span>
      <span class="ins-bt"><span class="${unit === 'days' ? 'is-days' : v >= 0 ? 'is-up' : 'is-down'}" style="width:${Math.max(2, (Math.abs(v) / top) * 100)}%"></span></span>
      <span class="ins-bv" style="color:${unit === 'days' ? 'var(--text2)' : clr(v)}">${fmt(v)}</span>
    </div>`).join('')}</div>`;
}

function tradesHtml(ids) {
  const byId = new Map(state.positions.map((p) => [p.id, p]));
  const rows = ids.map((id) => byId.get(id)).filter(Boolean).map((p) => {
    const cost = Math.abs(p.entry * p.qty);
    const pnl = (p.dir === 'Long' ? p.cur - p.entry : p.entry - p.cur) * p.qty;
    return `<div class="ins-trade"><b>${escapeHtml(p.ticker)}</b><span>${shortDate(p.open)} → ${shortDate(p.close)}</span>
      <span style="color:${clr(pnl)}">${cost ? pct((pnl / cost) * 100) : '—'}</span><span style="color:${clr(pnl)}">${masked(usd(pnl))}</span></div>`;
  });
  return `<div class="ins-trades">${rows.join('')}</div>`;
}

function cardHtml(i) {
  const early = i.confidence?.level === 'early';
  const n = i.trades?.length ?? 0;
  return `<article class="card ins-card ins-${i.tone ?? 'neutral'}${early ? ' is-early' : ''}" data-insight="${i.id}">
      <div class="ins-top">${badgeHtml(i.confidence)}</div>
      <h3 class="ins-title">${escapeHtml(masked(i.title))}</h3>
      ${i.detail ? `<p class="ins-detail">${escapeHtml(masked(i.detail))}</p>` : ''}
      ${early ? '' : barsHtml(i.bars, i.unit)}
      ${n ? `<button type="button" class="ins-more" data-ins-trades="${i.id}" aria-expanded="${opened === i.id}">${opened === i.id ? 'Hide' : 'See'} the ${n === 1 ? 'trade' : `${n} trades`}</button>` : ''}
      ${n && opened === i.id ? tradesHtml(i.trades) : ''}
    </article>`;
}

/** Last week, Monday to Sunday: the account, the S&P 500 beside it, and what was closed. */
function reviewHtml(review, account, index) {
  const line = [
    account != null ? `<b style="color:${clr(account)}">${pct(account)}</b> your account` : null,
    index != null ? `${pct(index)} the S&P 500` : null,
  ].filter(Boolean).join(' · ');
  const points = [];
  if (review.closed) {
    points.push(`<li><span class="ins-dot is-${review.pnl >= 0 ? 'up' : 'down'}"></span>${review.closed} trade${review.closed === 1 ? '' : 's'} closed, ${review.won} won · ${escapeHtml(masked(usd(review.pnl)))}</li>`);
  } else {
    points.push('<li><span class="ins-dot"></span>No trade closed.</li>');
  }
  if (review.emotional) {
    points.push(`<li><span class="ins-dot is-down"></span>${review.emotional} trade${review.emotional === 1 ? '' : 's'} taken while emotional, ${review.emotionalLost} lost · ${escapeHtml(masked(usd(review.emotionalPnl)))}</li>`);
  }
  return `<section class="card ins-review">
      <div class="ins-rhead"><span class="card-lbl">Last week · ${shortDate(review.from)} – ${shortDate(review.to)}</span></div>
      <div class="ins-rline">${line || 'Your account\'s week appears once its daily values have loaded.'}</div>
      <ul class="ins-rlist">${points.join('')}</ul>
    </section>`;
}

/** The S&P 500's total return over a week: the close before Monday to the last close by Sunday. */
function indexWeek(rows, from, to) {
  if (!rows?.length) return null;
  let start = -1;
  let end = -1;
  rows.forEach((r, i) => {
    if (r.date < from) start = i;
    if (r.date <= to) end = i;
  });
  if (start < 0 || end <= start) return null;
  let growth = 1;
  for (let i = start + 1; i <= end; i++) growth *= (rows[i].close + (Number(rows[i].div) || 0)) / rows[i - 1].close;
  return (growth - 1) * 100;
}

function emptyHtml(trades, needed) {
  return `<section class="card ins-empty">
      <h3>Insights start at ${MIN_TRADES} closed trades</h3>
      <p>You have ${trades}. ${needed} more and Riskbook starts reading your trades for patterns.</p>
      <ul>
        <li>Your behaviour: emotional trades, how long you hold losers, trades right after a loss</li>
        <li>Your timing: your best and worst day, day trades against swing and long term</li>
        <li>What you trade: sectors, your costliest stock, longs against shorts</li>
        <li>Your risk: average win against average loss, the trades that cost the most</li>
      </ul>
      <p class="ins-small">Rate your state of mind on each trade (New trade → State of mind) to unlock the emotional insights.</p>
    </section>`;
}

let bound = false;
function bind() {
  if (bound) return;
  const page = el('insights');
  if (!page) return;
  bound = true;
  page.addEventListener('click', (e) => {
    const more = e.target.closest('[data-ins-trades]');
    if (!more) return;
    opened = opened === more.dataset.insTrades ? null : more.dataset.insTrades;
    renderInsights();
  });
}

export async function renderInsights() {
  const body = el('insightsBody');
  if (!body) return;
  bind();
  const { trades, needed, insights } = insightsFor(state.positions);
  const review = weekReview(state.positions);
  const forward = authoritativeHistory();
  const history = forward.length ? forward : portfolioHistory();
  const accountWeek = periodReturnFromHistory(history, review.from, review.to)?.returnPct ?? null;

  const groups = GROUPS.map(([g, title]) => {
    const cards = insights.filter((i) => i.group === g);
    return cards.length ? `<h2 class="ins-group">${escapeHtml(title)}</h2><div class="ins-grid">${cards.map(cardHtml).join('')}</div>` : '';
  }).join('');

  const draw = (index) => {
    body.innerHTML = `${reviewHtml(review, accountWeek, index)}
      ${needed ? emptyHtml(trades, needed) : groups}
      <p class="ins-foot">Worked out on this device from your own trades; nothing is sent anywhere. These describe what you have done, not what you should do, and are not investment advice. A comparison needs ${MIN_GROUP} trades on each side, and is checked against chance before it is called Strong or Likely.</p>`;
  };
  draw(null);
  // The index arrives when it arrives; the page does not wait for it.
  try {
    const index = indexWeek(await benchmarkSeries(), review.from, review.to);
    if (index != null) draw(index);
  } catch { /* the line simply has no S&P 500 */ }
}
