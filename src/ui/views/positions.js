/** The Positions page: summary tiles, then open and closed position cards. */
import { state } from '../../core/store.js';
import { unreal, costOf, portfolioBeta, sortPositions } from '../../core/portfolio.js';
import { measuredBetas } from '../../services/benchmark.js';
import { ui } from '../uiState.js';
import { positionCard } from './positionCard.js';
import { money as $u, signedMoney as $s, pnlColor as clr } from '../format.js';

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
  const beta = portfolioBeta(open, measuredBetaCache);

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
    else if (beta.measuredPct >= 99) betaNote.textContent = 'measured vs S&P 500';
    else if (beta.measuredPct < 1) betaNote.textContent = 'estimated · not yet measured';
    else betaNote.textContent = `${Math.round(beta.measuredPct)}% measured`;
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
      ? [...closed].sort((a, b) => new Date(b.close) - new Date(a.close))
        .map((p) => positionCard(p, false)).join('')
      : '<div class="empty">No closed trades</div>';
  }
}
