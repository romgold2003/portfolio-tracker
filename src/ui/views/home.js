/** The overview page: account value, today's move, KPIs and a compact watchlist. */
import { state } from '../../core/store.js';
import {
  accountTotals, dailyPortfolioMove, unreal, costOf, pctD,
  dailyDollar, dailyDollarExits, dailyDollarTotal, sortPositions, todayStr,
  sectorBreakdown,
} from '../../core/portfolio.js';
import { priceIsLive } from '../../services/prices.js';
import { ui } from '../uiState.js';
import { renderCurve, renderSectorChart } from '../charts.js';
import {
  benchmarkSeries, benchmarkReturn, benchmarkKey, benchmarkFailure,
  benchmarkSpot, benchmarkYearToDate,
} from '../../services/benchmark.js';
import { cutoffFor } from '../../core/snapshots.js';
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
 * Are you beating the market?
 *
 * Both figures are measured over the same window — whatever the timeframe
 * buttons are showing — because a return is meaningless without the period it
 * covers, and comparing two different periods would be worse than showing
 * nothing. The window is clamped to the history actually recorded, so the label
 * says "17 days" rather than claiming three months of data that does not exist.
 */
async function renderBenchmark(periodReturn) {
  const valEl = document.getElementById('benchVal');
  const mineEl = document.getElementById('benchMine');
  const noteEl = document.getElementById('benchNote');
  if (!valEl || !mineEl || !noteEl) return;

  const span = trackedSpan();
  mineEl.textContent = periodReturn == null ? '—' : fp(periodReturn);
  mineEl.style.color = periodReturn == null ? 'var(--text3)' : clr(periodReturn);

  const rows = await benchmarkSeries();
  if (!rows || !span) {
    valEl.textContent = '—';
    valEl.style.color = 'var(--text3)';
    // Say what actually went wrong. "Unavailable" left someone who had just
    // pasted a key with no way to tell a typo from a spent daily quota.
    noteEl.textContent = benchmarkKey()
      ? (benchmarkFailure() || 'Market data unavailable right now')
      : 'Add a market data key in settings to compare';
    noteEl.title = noteEl.textContent;
    return;
  }

  // Live where the window runs to today, so both sides are measured at the
  // same moment rather than yours now against the index's last close.
  const spot = span.to === todayStr() ? benchmarkSpot() : null;
  const marketReturn = benchmarkReturn(rows, span.from, span.to, spot);
  if (marketReturn == null) {
    valEl.textContent = '—';
    valEl.style.color = 'var(--text3)';
    noteEl.textContent = 'No index data for this period';
    return;
  }

  valEl.textContent = fp(marketReturn);
  valEl.style.color = clr(marketReturn);

  const edge = (periodReturn ?? 0) - marketReturn;
  const verdict = edge >= 0 ? 'ahead of' : 'behind';

  // The market's own year is appended because it is the question people
  // actually ask — "what has the S&P done this year" — and it cannot be read
  // off the comparison above, which is deliberately clipped to your own window.
  const ytd = benchmarkYearToDate(rows, benchmarkSpot());
  const ytdNote = ytd == null ? '' : ` · S&P ${fp(ytd)} YTD`;

  noteEl.textContent = `${fp(Math.abs(edge)).replace('+', '')} ${verdict} the market · ${span.days}d${ytdNote}`;
  noteEl.style.color = edge >= 0 ? 'var(--green)' : 'var(--red)';
}

/** The first and last day the account curve actually has data for. */
function trackedSpan() {
  const snaps = state.snapshots;
  if (!snaps?.length) return null;
  const cutoff = cutoffFor(ui.timeframe);
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
function renderPeriodGain(series) {
  const pnlEl = document.getElementById('acctPnl');
  if (!pnlEl) return;

  if (!series) {
    pnlEl.textContent = '—';
    return;
  }

  const { gain, returnPct } = series;
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

  // The period figures come from the series the chart actually plotted, so the
  // headline gain, the KPI and the benchmark all describe the same window.
  const series = renderCurve(ui.timeframe);
  const periodReturn = series ? series.returnPct : 0;
  setText('kReturn', fp(periodReturn));
  setColor('kReturn', clr(periodReturn));

  renderPeriodGain(series);

  // Needs the network, so it settles in after the rest of the page is drawn.
  renderBenchmark(periodReturn);

  updateLivePill();
}
