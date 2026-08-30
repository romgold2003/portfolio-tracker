/** The Positions page: summary tiles, then open and closed position cards. */
import { state } from '../../core/store.js';
import {
  unreal, costOf, portfolioBeta, sortPositions, realized, accountTotals,
} from '../../core/portfolio.js';
import { measuredBetas } from '../../services/benchmark.js';
import { ui } from '../uiState.js';
import { positionCard } from './positionCard.js';
import { money as $u, signedMoney as $s, pnlColor as clr } from '../format.js';
import { MONTHS_LONG } from '../../config/constants.js';

const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

/**
 * Betas measured from real returns, refreshed in the background.
 *
 * Rendering is synchronous but the index history is not, so the page draws with
 * whatever is known and improves once the fetch lands. Empty means every beta
 * falls back to its published assumption, which is the state until enough
 * history has been collected.
 */
let measuredBetaCache = new Map();

export async function refreshMeasuredBetas() {
  const open = state.positions.filter((p) => p.status === 'Open');
  if (!open.length) return;
  const next = await measuredBetas(open.map((p) => p.ticker));
  if (!next.size) return;
  measuredBetaCache = next;
  renderPositions();
}

export function renderPositions() {
  const open = state.positions.filter((p) => p.status === 'Open');
  const closed = state.positions.filter((p) => p.status === 'Closed');

  const openPnl = open.reduce((sum, p) => sum + unreal(p), 0);
  const deployed = open.reduce((sum, p) => sum + costOf(p), 0);
  // Beta is measured against total equity, so cash has to come with it.
  const account = accountTotals(state.positions, state.cash).account;
  const beta = portfolioBeta(open, measuredBetaCache, account);

  setText('sOpenPnl', $s(openPnl));
  const pnlEl = document.getElementById('sOpenPnl');
  if (pnlEl) pnlEl.style.color = clr(openPnl);
  setText('sOpenCount', open.length);
  setText('sDeployed', $u(deployed).replace('.00', ''));
  setText('sBeta', beta == null ? '—' : beta.beta.toFixed(2));

  // Say plainly whether this was measured from returns or assumed. They are
  // very different claims, and the number alone cannot tell them apart.
  const betaNote = document.querySelector('.sum-beta .sum-sub');
  if (betaNote) {
    if (beta == null) betaNote.textContent = 'size-weighted';
    else {
      const source = beta.measuredPct >= 99 ? 'measured vs S&P 500'
        : beta.measuredPct < 1 ? 'estimated · not yet measured'
          : `${Math.round(beta.measuredPct)}% measured`;
      const drag = beta.cashDragPct >= 1 ? ` · ${Math.round(beta.cashDragPct)}% cash` : '';
      betaNote.textContent = source + drag;
    }
  }

  const openEl = document.getElementById('openPositions');
  if (openEl) {
    openEl.innerHTML = open.length
      ? sortPositions(open, ui.posSort).map((p) => positionCard(p, true)).join('')
      : '<div class="empty">No open positions. Add one from New trade.</div>';
  }

  const closedEl = document.getElementById('closedPositions');
  if (closedEl) {
    closedEl.innerHTML = closed.length
      ? closedByMonth(closed).map(monthGroup).join('')
      : '<div class="empty">No closed trades</div>';
  }
}

/**
 * Closed trades, newest month first.
 *
 * A year of trading is a hundred cards, and scrolling past all of them to reach
 * last March is not reading a journal. Grouped by the month each trade closed —
 * the same bucket the Monthly page uses, so the two never disagree about which
 * month a trade belongs to.
 */
function closedByMonth(closed) {
  const months = new Map();
  for (const p of closed) {
    // A trade with no close date would otherwise vanish from the page entirely.
    const key = p.close ? p.close.slice(0, 7) : 'undated';
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(p);
  }

  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, trades]) => ({
      key,
      trades: trades.sort((a, b) => (b.close || '').localeCompare(a.close || '')),
      pnl: trades.reduce((sum, p) => sum + realized(p), 0),
    }));
}

function monthLabel(key) {
  if (key === 'undated') return 'No close date';
  const [year, month] = key.split('-').map(Number);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/**
 * One collapsed month. Only the month that is open renders its cards, so a
 * hundred closed trades cost a hundred rows of nothing until asked for.
 */
function monthGroup({ key, trades, pnl }) {
  const isOpen = ui.openClosedMonth === key;
  const count = `${trades.length} trade${trades.length === 1 ? '' : 's'}`;
  return `<div class="month-group${isOpen ? ' open' : ''}">
    <div class="month-head" onclick="toggleClosedMonth('${key}')">
      <div class="month-left">
        <span class="chevron">▶</span>
        <span class="month-name">${monthLabel(key)}</span>
        <span class="month-count">${count}</span>
      </div>
      <span class="month-pnl" style="color:${clr(pnl)}">${$s(pnl)}</span>
    </div>
    ${isOpen ? `<div class="month-body">${trades.map((p) => positionCard(p, false)).join('')}</div>` : ''}
  </div>`;
}
