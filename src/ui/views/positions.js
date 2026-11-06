/** The Positions page: summary tiles, then open and closed position cards. */
import { state } from '../../core/store.js';
import { unreal, costOf, realized } from '../../core/portfolio.js';
import {
  headerHtml, toolbarHtml, sortByLayout, gridStyle, listContext, bindColumns,
} from './holdingColumns.js';
import { ui } from '../uiState.js';
import { positionCard } from './positionCard.js';
import { money as $u, signedMoney as $s, pnlColor as clr } from '../format.js';
import { MONTHS_LONG } from '../../config/constants.js';

const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

export function renderPositions() {
  const open = state.positions.filter((p) => p.status === 'Open');
  const closed = state.positions.filter((p) => p.status === 'Closed');

  const openPnl = open.reduce((sum, p) => sum + unreal(p), 0);
  const deployed = open.reduce((sum, p) => sum + costOf(p), 0);

  setText('sOpenPnl', $s(openPnl));
  const pnlEl = document.getElementById('sOpenPnl');
  if (pnlEl) pnlEl.style.color = clr(openPnl);
  setText('sOpenCount', open.length);
  setText('sDeployed', $u(deployed).replace('.00', ''));

  // Each card's head shows the columns chosen for this page, sorted by the heading clicked (holdingColumns.js).
  bindColumns(document.getElementById('posColumns'), 'positions', () => renderPositions());
  const layout = state.columns.positions;
  const ctx = listContext();
  const bar = document.getElementById('posColsBar');
  if (bar) bar.innerHTML = open.length ? toolbarHtml('positions', layout) : '';
  const openEl = document.getElementById('openPositions');
  if (openEl) {
    keepOpenPanels(openEl, () => {
      openEl.innerHTML = open.length
        ? `<div class="hc-cards" style="${gridStyle(layout)}">${headerHtml('positions', layout)}${sortByLayout(open, layout, ctx).map((p) => positionCard(p, true, state.positions, { layout, ctx })).join('')}</div>`
        : '<div class="pos-empty-state"><div class="pos-empty-title">No open positions yet</div><div class="pos-empty-sub">Log a trade to start tracking your portfolio</div><button class="btn btn-blue pos-empty-cta" onclick="show(\'add\')">+ Log your first trade</button></div>';
    });
  }

  const closedEl = document.getElementById('closedPositions');
  if (closedEl) {
    keepOpenPanels(closedEl, () => {
      closedEl.innerHTML = closed.length
        ? closedByMonth(closed, new Set(open.map((p) => p.ticker))).map(monthGroup).join('')
        : '<div class="empty">No closed trades</div>';
    });
  }
}

/**
 * Rebuild a list of cards without closing the Edit, DCA or Close panel open in it.
 *
 * Prices refresh every thirty seconds and redraw every card, which put each
 * panel back to closed and threw away what was being typed — an edit had to be
 * finished inside half a minute. The open panel itself is carried over into
 * the new card, with its values, its preview and the cursor where it was. It
 * stays until Cancel, Save or the action it belongs to closes it.
 */
function keepOpenPanels(host, rebuild) {
  const open = [...host.querySelectorAll('.dca-panel')].filter((panel) => panel.style.display !== 'none');
  const active = document.activeElement;
  const focus = active && open.some((panel) => panel.contains(active))
    ? { el: active, start: active.selectionStart, end: active.selectionEnd }
    : null;

  rebuild();

  for (const panel of open) {
    const fresh = panel.id && host.querySelector(`#${CSS.escape(panel.id)}`);
    if (fresh) fresh.replaceWith(panel);
  }
  if (focus?.el.isConnected) {
    focus.el.focus({ preventScroll: true });
    try { focus.el.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ }
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
