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
      ? closedByMonth(closed, new Set(open.map((p) => p.ticker))).map(monthGroup).join('')
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
function closedByMonth(closed, stillHeld = new Set()) {
  const cards = [];

  for (const [ticker, trades] of groupBy(closed, (p) => p.ticker)) {
    if (stillHeld.has(ticker)) {
      /**
       * Part sold, part still held. The sales stay in the months they happened
       * in, because the position is not finished and there is no final month to
       * move them to yet. Badged so it is clear this is not the whole story.
       */
      for (const [, sameMonth] of groupBy(trades, monthKeyOf)) {
        cards.push(merge(sameMonth, { stillHeld: true }));
      }
    } else {
      /**
       * Fully out. Every sale of this name becomes one card, filed under the
       * month the last of them happened — so an exit staged over August and
       * October reads as one position closed in October rather than two
       * unrelated trades, which is what it was.
       */
      cards.push(merge(trades, { stillHeld: false }));
    }
  }

  const months = groupBy(cards, monthKeyOf);
  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, inMonth]) => ({
      key,
      trades: inMonth.sort((a, b) => (b.close || '').localeCompare(a.close || '')),
      pnl: inMonth.reduce((sum, p) => sum + realized(p), 0),
      count: inMonth.reduce((sum, p) => sum + (p.partCount || 1), 0),
    }));
}

/** A trade with no close date would otherwise vanish from the page entirely. */
const monthKeyOf = (p) => (p.close ? p.close.slice(0, 7) : 'undated');

function groupBy(list, keyOf) {
  const out = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

/**
 * Several sales of one name, shown as one card.
 *
 * Selling in six pieces is one decision to get out, not six trades to scroll
 * past. The individual sales are not lost: they become the exits inside the
 * card, each with its own date and profit, which is where you look to see how
 * the exit was staged.
 *
 * The merged card is a view, never a stored position. It carries no id that
 * would survive a click, so it is marked `merged` and rendered without the
 * edit and delete buttons — those act on one trade, and this is several.
 */
function merge(group, { stillHeld }) {
  if (group.length === 1) {
    return stillHeld ? { ...group[0], stillHeld: true } : group[0];
  }

  const parts = [...group].sort((a, b) => (a.close || '').localeCompare(b.close || ''));
  const cost = parts.reduce((sum, p) => sum + costOf(p), 0);
  const pnl = parts.reduce((sum, p) => sum + realized(p), 0);

  // Every sale, oldest first, each keeping its own date and result. A trade
  // that was itself closed in slices contributes each of those slices rather
  // than one lump.
  const exits = parts.flatMap((p) => (
    p.exits?.length
      ? p.exits.map((e) => ({ ...e, d: e.d || p.close }))
      : [{ d: p.close, qty: 1, price: costOf(p) + realized(p), pnl: realized(p), pct: 100 }]
  ));

  const reasons = [...new Set(parts.map((p) => p.reason).filter(Boolean))];
  const months = [...new Set(parts.map(monthKeyOf))];

  return {
    ...parts[parts.length - 1],
    merged: true,
    stillHeld,
    partCount: parts.length,
    // The months the sales actually fell in. When an exit was staged across
    // more than one, the card sits under the last of them and says so, rather
    // than leaving the earlier ones looking like separate positions.
    soldAcross: months.length > 1 ? months : null,
    status: 'Closed',
    open: null,
    close: parts[parts.length - 1].close,
    // Priced as a single unit standing for the whole exit, so cost, profit and
    // percentage all come out right.
    entry: cost,
    cur: cost + pnl,
    qty: 1,
    origQty: 1,
    amount: cost,
    summary: true,
    reason: reasons.join('\n\n') || null,
    exits: exits.sort((a, b) => (a.d || '').localeCompare(b.d || '')),
  };
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
function monthGroup({ key, trades, pnl, count }) {
  const isOpen = ui.openClosedMonth === key;
  // Counts the sales, not the cards: several sales of one name merge into one
  // card, and a month saying "3 trades" over five rows would be the lie.
  const label = `${count} trade${count === 1 ? '' : 's'}`;
  return `<div class="month-group${isOpen ? ' open' : ''}">
    <div class="month-head" onclick="toggleClosedMonth('${key}')">
      <div class="month-left">
        <span class="chevron">▶</span>
        <span class="month-name">${monthLabel(key)}</span>
        <span class="month-count">${label}</span>
      </div>
      <span class="month-pnl" style="color:${clr(pnl)}">${$s(pnl)}</span>
    </div>
    ${isOpen ? `<div class="month-body">${trades.map((p) => positionCard(p, false)).join('')}</div>` : ''}
  </div>`;
}
