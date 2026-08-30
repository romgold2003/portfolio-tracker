/** The overview page: account value, today's move, KPIs and a compact watchlist. */
import { state } from '../../core/store.js';
import {
  accountTotals, dailyPortfolioMove, unreal, costOf, pctD,
  dailyDollar, dailyDollarExits, dailyDollarTotal, sortPositions, todayStr,
  sectorBreakdown, yearToDatePnl, periodPnl,
} from '../../core/portfolio.js';
import { priceIsLive } from '../../services/prices.js';
import { ui } from '../uiState.js';
import { renderCurve, renderSectorChart } from '../charts.js';
import {
  benchmarkSeries, benchmarkKey, benchmarkFailure,
  benchmarkSpot, benchmarkYearToDate,
} from '../../services/benchmark.js';
import { pricesOn } from '../../services/history.js';
import { periodStart, cutoffFor } from '../../core/snapshots.js';
import {
  money as $u, signedMoney as $s, pctText as fp, pnlColor as clr,
  fmtPrice, escapeHtml,
} from '../format.js';

const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
const setColor = (id, color) => { const el = document.getElementById(id); if (el) el.style.color = color; };

/**
 * Hiding the figures, for when someone can see the screen.
 *
 * Only the amounts that reveal how much money is here are masked — the account
 * value, cash, the gain and unrealised P&L. Percentages, tickers and the
 * allocation stay visible, because they give away nothing about size and
 * blanking them would leave an app you cannot use.
 *
 * The choice is remembered: someone who hid the numbers on a train wants them
 * still hidden when they reopen the tab, not exposed by a reload.
 */
export const MASK = '••••••';
const HIDDEN_KEY = 'pt_hide_amounts';

let hidden = (() => {
  try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
})();

export function amountsHidden() { return hidden; }

export function toggleAmounts() {
  hidden = !hidden;
  try { localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0'); } catch { /* ignore */ }
  renderHome();
}

/** Keep the eye in step with what it is currently doing. */
function renderPrivacyToggle() {
  const button = document.getElementById('hideAmounts');
  if (!button) return;
  button.textContent = hidden ? '🙈' : '👁';
  button.title = hidden ? 'Show amounts' : 'Hide amounts';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(hidden));
}

/** Header row above the compact position list. */
const LIST_HEADER = `<div style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:0;margin-bottom:6px;padding:0 2px">
  <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em">Asset</div>
  <div style="font-size:10px;color:var(--text3);text-align:center;padding:0 12px">D%</div>
  <div style="font-size:10px;color:var(--text3);text-align:center;padding:0 12px">7D%</div>
  <div style="font-size:10px;color:var(--text3);text-align:right;min-width:80px">P&L</div>
</div>`;

function miniRow(p) {
  const pnl = unreal(p);
  const retPct = pctD(pnl, costOf(p));
  const live = priceIsLive(p);
  const daily = p.dailyChg ?? null;
  const weekly = p.weeklyChg ?? null;
  const dailyMoney = dailyDollar(p) == null && dailyDollarExits(p, todayStr()) === 0
    ? null
    : dailyDollarTotal(p);

  // Colour the % by what it means for THIS position: a short gains when the
  // price falls, so the raw percentage and its colour can disagree.
  const dailySign = daily == null ? 0 : (p.dir === 'Long' ? daily : -daily);
  const dailyText = daily != null
    ? `<span style="color:${clr(dailySign)}">${fp(daily)}</span>`
    : '<span style="color:var(--text4)">—</span>';
  const weeklyText = weekly != null
    ? `<span style="color:${clr(weekly)}">${fp(weekly)}</span>`
    : '<span style="color:var(--text4)">—</span>';

  return `<div class="mini-row" style="display:grid;grid-template-columns:1fr auto auto auto;gap:0;align-items:center">
    <div style="display:flex;align-items:center;gap:6px">
      <span class="mini-tk">${escapeHtml(p.ticker)}</span>
      <span class="mini-dir d-${p.dir.toLowerCase()}">${p.dir}</span>
      <span class="mini-live" style="color:${live ? 'var(--green)' : 'var(--text3)'}">$${fmtPrice(p.cur)}${live ? ' ▲' : ''}</span>
    </div>
    <div style="text-align:center;padding:0 12px;font-size:12px">
      ${dailyText}
      ${dailyMoney != null ? `<div style="font-size:10px;color:${clr(dailyMoney)};margin-top:2px">${$s(+dailyMoney.toFixed(2))}</div>` : ''}
    </div>
    <div style="text-align:center;padding:0 12px;font-size:12px">${weeklyText}</div>
    <div style="text-align:right;min-width:80px">
      <div class="mini-tk" style="color:${clr(pnl)}">${$s(pnl)}</div>
      <div style="font-size:10px;color:${clr(retPct)}">${fp(retPct)}</div>
    </div>
  </div>`;
}

function renderDailyMove(totals) {
  const move = dailyPortfolioMove(state.positions, totals.account);
  const pctEl = document.getElementById('portfolioDailyPct');
  const amtEl = document.getElementById('portfolioDailyAmt');
  if (!pctEl || !amtEl) return;

  if (!move.hasData) {
    pctEl.textContent = '—';
    pctEl.style.color = 'var(--text3)';
    amtEl.textContent = 'loading…';
    amtEl.style.color = 'var(--text3)';
    return;
  }

  pctEl.textContent = fp(move.percent);
  pctEl.style.color = clr(move.percent);

  // Today's move in currency is masked with the rest: left visible it sits
  // beside its own percentage, and the two together give the account size away.
  if (hidden) {
    amtEl.textContent = MASK;
    amtEl.style.color = 'var(--text3)';
    return;
  }

  const notes = [];
  if (move.sold !== 0) notes.push(`incl. ${$s(+move.sold.toFixed(2))} sold`);
  if (move.pending > 0) notes.push(`${move.pending} pending`);
  amtEl.textContent = $s(+move.dollars.toFixed(2)) + (notes.length ? ' · ' + notes.join(' · ') : '');
  amtEl.style.color = clr(move.dollars);
}

/**
 * Sector allocation: the doughnut plus its legend.
 *
 * Every sector is listed even when its wedge is too thin to carry a label, so
 * the small holdings are still readable somewhere.
 */
function renderAllocation() {
  const rows = sectorBreakdown(state.positions, state.cash);
  renderSectorChart(rows);

  const legend = document.getElementById('sectorLegend');
  if (!legend) return;
  legend.innerHTML = rows.map((r) => `<div class="alloc-row">
      <span class="alloc-dot" style="background:${r.colour}"></span>
      <span class="alloc-name">${escapeHtml(r.name)}</span>
      <span class="alloc-pct">${r.pct.toFixed(1)}%</span>
    </div>`).join('');
}

/**
 * The year, for the market and for you. Fixed.
 *
 * This corner deliberately ignores the timeframe buttons. Those drive the chart
 * and the KPIs below, and having the scoreboard flicker between a week and a
 * year as you scrubbed through them made it useless as a reference — the thing
 * you look up at is meant to be the one number that stays still.
 *
 * So both rows are the year: the index from 1 January, and your account from 1
 * January or the day it opened, whichever is later. Those coincide from 2027,
 * and until then yours is the honest window rather than a year you were not
 * invested for.
 */
async function renderBenchmark(totals) {
  const valEl = document.getElementById('benchVal');
  const mineEl = document.getElementById('benchMine');
  const noteEl = document.getElementById('benchNote');
  if (!valEl || !mineEl || !noteEl) return;

  const mine = yearToDateReturn(totals);
  mineEl.textContent = mine == null ? '—' : fp(mine);
  mineEl.style.color = mine == null ? 'var(--text3)' : clr(mine);
  mineEl.title = describeOwnYear();

  const clear = () => { noteEl.textContent = ''; noteEl.title = ''; };

  const rows = await benchmarkSeries();
  if (!rows) {
    valEl.textContent = '—';
    valEl.style.color = 'var(--text3)';
    // The note carries failures only. Saying what actually went wrong beats
    // "unavailable" for anyone who has just pasted a key and is wondering
    // whether they typed it wrong or spent the day's quota.
    noteEl.textContent = benchmarkKey()
      ? (benchmarkFailure() || 'Market data unavailable right now')
      : 'Add a market data key in settings to compare';
    noteEl.title = noteEl.textContent;
    return;
  }

  // Live rather than last night's close, so the index is read at the same
  // moment as the account it is being put beside.
  const marketReturn = benchmarkYearToDate(rows, benchmarkSpot());
  if (marketReturn == null) {
    valEl.textContent = '—';
    valEl.style.color = 'var(--text3)';
    noteEl.textContent = 'No index data for this year';
    noteEl.title = noteEl.textContent;
    return;
  }

  valEl.textContent = fp(marketReturn);
  valEl.style.color = clr(marketReturn);
  valEl.title = `S&P 500 since 1 January ${new Date().getFullYear()}`;
  clear();
}

/**
 * The account's own return for the year.
 *
 * Worked out from the trades rather than from the account curve. The curve only
 * began when the app was first opened, so it cannot see a year of trading
 * entered afterwards — it reported the same figure whether the year had made
 * sixty thousand or nothing, which is no use as the number sat beside the
 * market's own.
 *
 * `startPrices` is filled in the background for holdings carried in from an
 * earlier year; until it arrives those are left out, so the figure can rise
 * slightly on the second pass rather than starting overstated.
 */
let startPrices = new Map();

function yearToDateReturn(totals) {
  const result = yearToDatePnl(state.positions, totals.account, startPrices);
  return result.returnPct;
}

/**
 * Fetch what each already-held position was worth when the window opened.
 *
 * Only positions predating the window need one — for a year that is normally
 * none or a handful — and a past close never changes, so it is cached for good.
 * Until it arrives those positions are left out, so the figure can rise on the
 * second pass rather than starting overstated.
 */
async function loadWindowStartPrices() {
  const from = windowStart();
  if (!from) return;

  const held = state.positions
    .filter((p) => p.status === 'Open' && p.open && p.open < from)
    .map((p) => p.ticker);
  if (!held.length) return;

  const fetched = await pricesOn(held, from);
  // Only redraw when something new actually arrived, or this recurses.
  const changed = [...fetched].some(([t, v]) => startPrices.get(t) !== v);
  if (!changed) return;
  startPrices = new Map([...startPrices, ...fetched]);
  renderHome();
}

/** What window your own figure covers, for the tooltip. */
function describeOwnYear() {
  const span = trackedSpan();
  if (!span) return '';
  const janFirst = `${new Date().getFullYear()}-01-01`;
  if (span.from <= janFirst) return `Your return since 1 January ${new Date().getFullYear()}`;
  const started = new Date(span.from);
  const when = started.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Your return since ${when}, when this account started`;
}

/** The first and last day the year's curve actually has data for. */
function trackedSpan() {
  const snaps = state.snapshots;
  if (!snaps?.length) return null;
  // Never reaches back past the day the account started, so a year-to-date on a
  // three-week-old account measures the three weeks rather than inventing the
  // months before it.
  const cutoff = periodStart('YTD', snaps[0].date);
  const inWindow = snaps.filter((s) => new Date(s.date) >= cutoff);
  const used = inWindow.length >= 2 ? inWindow : snaps;
  if (used.length < 2) return null;
  const from = used[0].date;
  const to = used[used.length - 1].date;
  return {
    from,
    to,
    days: Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000)),
  };
}

/**
 * The gain across the selected timeframe, under the account value.
 *
 * This follows the timeframe buttons rather than showing lifetime P&L, so
 * "1M" answers what the month did.
 */
function renderPeriodGain(period) {
  const pnlEl = document.getElementById('acctPnl');
  if (!pnlEl) return;

  if (!period) {
    pnlEl.textContent = '—';
    return;
  }

  const gain = period.pnl;
  const returnPct = period.returnPct ?? 0;
  const arrow = gain >= 0 ? '▲ ' : '▼ ';

  pnlEl.innerHTML = hidden
    ? `<span style="color:var(--text3)">${MASK}</span>`
    : `${arrow}${$s(gain)} <span style="color:${clr(returnPct)}">(${fp(returnPct)})</span>`;
  pnlEl.style.color = hidden ? 'var(--text3)' : clr(gain);
}

/** The live/partial pill shown on both the home and positions pages. */
export function updateLivePill() {
  const hasUnkeyedStock = state.positions.some((p) => p.status === 'Open' && p.cls !== 'Crypto') && !state.apiKey;
  const label = hasUnkeyedStock ? 'Crypto live · stocks manual' : 'Live prices on';

  [['livePill', 'livePillTxt'], ['livePill2', 'livePill2Txt']].forEach(([pillId, textId], i) => {
    const pill = document.getElementById(pillId);
    if (!pill) return;
    pill.className = 'live-pill' + (hasUnkeyedStock ? ' off' : '');
    const text = document.getElementById(textId);
    if (!text) return;
    if (i === 0) text.textContent = label;
    else text.textContent = hasUnkeyedStock ? 'Partial' : 'Live';
  });
}

export function renderHome() {
  const totals = accountTotals(state.positions, state.cash);

  renderPrivacyToggle();
  setText('acctValue', hidden ? MASK : $u(totals.account).replace('.00', ''));

  setText('cashDisplay', hidden ? MASK : $u(state.cash));

  renderDailyMove(totals);

  setText('kUnreal', hidden ? MASK : $s(totals.unrealised));
  setColor('kUnreal', hidden ? 'var(--text3)' : clr(totals.unrealised));
  setText('kUnrealSub', `${totals.open.length} open position${totals.open.length !== 1 ? 's' : ''}`);

  // Banked, as against the tile beside it, which is still riding.
  const closedCount = state.positions.filter((p) => p.status === 'Closed').length;
  setText('kRealised', hidden ? MASK : $s(totals.realised));
  setColor('kRealised', hidden ? 'var(--text3)' : clr(totals.realised));
  setText('kRealisedSub', `${closedCount} closed position${closedCount !== 1 ? 's' : ''}`);
  setText('kRetLbl', ui.timeframe);
  setText('kWinRate', `${totals.winRate}%`);
  setColor('kWinRate', totals.winRate >= 50 ? 'var(--amber)' : 'var(--red)');
  setText('kWinSub', `${totals.wins}W · ${totals.losses}L closed`);

  const list = document.getElementById('homePositions');
  if (list) {
    list.innerHTML = totals.open.length
      ? LIST_HEADER + sortPositions(totals.open, ui.homeSort).map(miniRow).join('')
      : '<div class="empty">No open positions</div>';
  }

  renderAllocation();

  // The chart still draws the recorded account value; the figures beside it do
  // not come from it. That curve measures the change in what the account holds,
  // which counts money paid in as though it had been earned — it reported 2,450
  // of funding as profit on this book, and disagreed with realised plus
  // unrealised by exactly that. Every number here is counted from the trades.
  renderCurve(ui.timeframe);

  const period = periodPnl(state.positions, totals.account, windowStart(), startPrices);
  setText('kReturn', fp(period.returnPct ?? 0));
  setColor('kReturn', clr(period.returnPct ?? 0));
  renderPeriodGain(period);

  // Needs the network, so it settles in after the rest of the page is drawn.
  renderBenchmark(totals);
  loadWindowStartPrices();

  updateLivePill();
}

/**
 * The first day of the window the buttons are asking for, as a date string.
 *
 * Null for "All", which means the whole life of the account — where the period
 * P&L necessarily equals realised plus unrealised, so the figure under the
 * account value and the two tiles below it finally agree.
 */
function windowStart() {
  if (ui.timeframe === 'All') return null;
  return cutoffFor(ui.timeframe).toISOString().slice(0, 10);
}
