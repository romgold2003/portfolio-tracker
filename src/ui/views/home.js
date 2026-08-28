/** The overview page: account value, today's move, KPIs and a compact watchlist. */
import { state } from '../../core/store.js';
import {
  accountTotals, dailyPortfolioMove, unreal, costOf, pctD,
  dailyDollar, dailyDollarExits, dailyDollarTotal, sortPositions, todayStr,
} from '../../core/portfolio.js';
import { priceIsLive } from '../../services/prices.js';
import { ui } from '../uiState.js';
import { renderCurve } from '../charts.js';
import {
  money as $u, signedMoney as $s, pctText as fp, pnlColor as clr,
  fmtPrice, escapeHtml,
} from '../format.js';

const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
const setColor = (id, color) => { const el = document.getElementById(id); if (el) el.style.color = color; };

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

  const notes = [];
  if (move.sold !== 0) notes.push(`incl. ${$s(+move.sold.toFixed(2))} sold`);
  if (move.pending > 0) notes.push(`${move.pending} pending`);
  amtEl.textContent = $s(+move.dollars.toFixed(2)) + (notes.length ? ' · ' + notes.join(' · ') : '');
  amtEl.style.color = clr(move.dollars);
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

  setText('acctValue', $u(totals.account).replace('.00', ''));

  // Total return is measured against the capital actually put in — the account
  // value with every dollar of P&L stripped back out.
  const netDeposits = totals.account - totals.total;
  const returnBase = netDeposits > 0 ? netDeposits : (totals.invested + state.cash) || 1;
  const pnlEl = document.getElementById('acctPnl');
  if (pnlEl) {
    pnlEl.innerHTML = (totals.total >= 0 ? '▲ ' : '▼ ') + $s(totals.total)
      + ` <span style="color:${clr(totals.total)}">(${fp(pctD(totals.total, returnBase))})</span>`;
    pnlEl.style.color = clr(totals.total);
  }
  setText('acctPnlSub', `Total P&L · Realised ${$u(totals.realised)} · Unrealised ${$u(totals.unrealised)} · Cash ${$u(state.cash)}`);
  setText('cashDisplay', $u(state.cash));

  renderDailyMove(totals);

  setText('kUnreal', $s(totals.unrealised));
  setColor('kUnreal', clr(totals.unrealised));
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

  // The "N-month return" KPI is the return of the drawn curve, not of the whole
  // book, so it is filled in from the series the chart actually plotted.
  const periodReturn = renderCurve(ui.timeframe);
  setText('kReturn', fp(periodReturn));
  setColor('kReturn', clr(periodReturn));

  updateLivePill();
}
