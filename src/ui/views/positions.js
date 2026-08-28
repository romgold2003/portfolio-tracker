/** The Positions page: summary tiles, then open and closed position cards. */
import { state } from '../../core/store.js';
import { unreal, costOf, portfolioBeta, sortPositions } from '../../core/portfolio.js';
import { ui } from '../uiState.js';
import { positionCard } from './positionCard.js';
import { money as $u, signedMoney as $s, pnlColor as clr } from '../format.js';

const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

export function renderPositions() {
  const open = state.positions.filter((p) => p.status === 'Open');
  const closed = state.positions.filter((p) => p.status === 'Closed');

  const openPnl = open.reduce((sum, p) => sum + unreal(p), 0);
  const deployed = open.reduce((sum, p) => sum + costOf(p), 0);
  const beta = portfolioBeta(open);

  setText('sOpenPnl', $s(openPnl));
  const pnlEl = document.getElementById('sOpenPnl');
  if (pnlEl) pnlEl.style.color = clr(openPnl);
  setText('sOpenCount', open.length);
  setText('sDeployed', $u(deployed).replace('.00', ''));
  setText('sBeta', beta == null ? '—' : beta.toFixed(2));

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
