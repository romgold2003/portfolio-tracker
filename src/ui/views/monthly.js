/**
 * The Monthly page: a twelve-bar year chart, a summary table of every month
 * with activity, and a drill-down into the trades of one chosen month.
 *
 * Only fully closed positions are booked to a month. Partially closed trades
 * stay out until their last exit, which is what keeps the monthly totals equal
 * to money actually taken off the table.
 */
import { state } from '../../core/store.js';
import { realized, costOf, pctD, avgTradeReturn, outcomeOf } from '../../core/portfolio.js';
import { monthlyReturns } from '../../core/portfolioHistory.js';
import { authoritativeHistory, portfolioHistory } from '../../core/snapshots.js';
import { MONTHS_SHORT, MONTHS_LONG, YEAR_PICKER } from '../../config/constants.js';
import { renderMonthlyChart } from '../charts.js';
import { mindStats } from '../../core/mind.js';
import { ui } from '../uiState.js';
import {
  money as $u, signedMoney as $s, pctText as fp, pnlColor as clr,
  fmtPrice, fmtQty, escapeHtml,
} from '../format.js';

const el = (id) => document.getElementById(id);

/** Years offered by both pickers: a little ahead, a few back. */
function pickerYears() {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now + YEAR_PICKER.forward; y >= now - YEAR_PICKER.back; y--) years.push(y);
  return years;
}

/** Realised P&L for each of the twelve months of one year. */
function yearTotals(year) {
  return MONTHS_SHORT.map((_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const trades = state.positions.filter((p) => p.status === 'Closed' && p.close?.startsWith(key));
    return +trades.reduce((sum, p) => sum + realized(p), 0).toFixed(2);
  });
}

/** Every month a trade was closed in, keyed YYYY-MM: what the trades did. */
function closedByMonth() {
  const months = {};
  state.positions.forEach((p) => {
    if (p.status !== 'Closed' || !p.close) return;
    const bucket = (months[p.close.slice(0, 7)] ??= { real: 0, closed: 0, trades: [] });
    bucket.real += realized(p);
    bucket.closed++;
    const outcome = outcomeOf(realized(p));
    if (outcome === 'win') bucket.won = (bucket.won ?? 0) + 1;
    if (outcome === 'loss') bucket.lost = (bucket.lost ?? 0) + 1;
    // Kept individually: the average return is per trade, not per dollar.
    bucket.trades.push(p);
  });
  return months;
}

function renderYearSelect(id = 'chartYear') {
  const select = el(id);
  if (!select) return new Date().getFullYear();
  const selected = select.value ? parseInt(select.value, 10) : new Date().getFullYear();
  select.innerHTML = pickerYears()
    .map((y) => `<option value="${y}" ${y === selected ? 'selected' : ''}>${y}</option>`)
    .join('');
  return selected;
}

export function populateYearPicker() {
  const picker = el('pickYear');
  if (!picker) return;
  const current = picker.value || String(new Date().getFullYear());
  picker.innerHTML = pickerYears()
    .map((y) => `<option value="${y}" ${String(y) === current ? 'selected' : ''}>${y}</option>`)
    .join('');
}

export function populateMonthPicker() {
  const picker = el('pickMonth');
  if (!picker) return;
  const year = el('pickYear')?.value || String(new Date().getFullYear());
  const current = picker.value || '';
  picker.innerHTML = '<option value="">— Select month —</option>' + MONTHS_LONG.map((name, i) => {
    const value = `${year}-${String(i + 1).padStart(2, '0')}`;
    return `<option value="${value}" ${value === current ? 'selected' : ''}>${name}</option>`;
  }).join('');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * How the typical trade closed in this month did.
 *
 * Equal weight, so it answers "how good were the decisions" rather than "how
 * much money moved" — which is the Account P&L column, and the
 * two disagree whenever one position was much larger than the rest.
 *
 * Open positions are left out entirely. A trade that has not been closed has no
 * result yet, and folding its paper move into an average of finished trades
 * would quietly change what the column means every time a price ticks.
 */
function avgTradeCell(m) {
  const avg = avgTradeReturn(m.trades);
  if (avg == null) {
    return '<td class="muted" title="No trade closed in this month, so there is no average to take">—</td>';
  }
  const title = `Equal-weight average of ${plural(m.closed, 'closed trade')}. `
    + 'Each trade counts once whatever it was sized at, so this is how the '
    + 'typical trade did, not how the money did.';
  return `<td style="color:${clr(avg)}" title="${title}">${fp(avg)}</td>`;
}

/**
 * Two kinds of number, kept apart (November 2026 audit):
 *
 *  - Trade performance — what the trades closed in the month made: realised
 *    P&L, the average trade, how many. A trade's whole result lands in the
 *    month it closed.
 *  - Portfolio performance — what the account did over the month: the change
 *    in value less the money paid in or out, and the time-weighted return of
 *    its days compounded (portfolioHistory.js, monthlyReturns). Open positions,
 *    dividends and fees all count, the way a broker's monthly figure does.
 *
 * The daily account values are the statement's walk when there is one, else
 * the account rebuilt from the trades; none yet shows a dash.
 */
function accountMonths() {
  const forward = authoritativeHistory();
  return monthlyReturns(forward.length ? forward : portfolioHistory());
}

function accountCells(month) {
  if (!month) return '<td class="muted" title="No daily account values for this month yet">—</td><td class="muted">—</td>';
  const note = [
    `${$u(month.startValue)} at the start`,
    month.paidIn ? `${$u(Math.abs(month.paidIn))} ${month.paidIn > 0 ? 'deposited' : 'withdrawn'}, not counted as profit or loss` : null,
    `${$u(month.endValue)} at the end`,
    month.partial ? 'measured from the day the history begins' : null,
  ].filter(Boolean).join('. ');
  return `<td style="color:${clr(month.pnl)}" title="${note}">${$s(month.pnl)}</td>
      <td style="color:${clr(month.returnPct)};font-weight:600" title="${note}. The days of the month compounded, as a broker measures it.">${fp(month.returnPct)}${month.partial ? '*' : ''}</td>`;
}

const monthLabel = (key) => new Date(`${key}-02`).toLocaleString('default', { month: 'long', year: 'numeric' });

/** Monthly realised: what the trades closed each month banked. */
function renderSummaryTable() {
  const body = el('monthTable');
  if (!body) return;
  const trades = closedByMonth();
  const keys = Object.keys(trades).sort().reverse();

  if (!keys.length) {
    body.innerHTML = '<tr><td colspan="5"><div class="empty">No closed trades yet</div></td></tr>';
    return;
  }

  body.innerHTML = keys.map((key) => {
    const m = trades[key];
    return `<tr style="cursor:pointer" onclick="selectMonth('${key}')">
      <td class="mo">${monthLabel(key)}</td>
      <td style="color:${clr(m.real)};font-weight:600">${$s(m.real)}</td>
      ${avgTradeCell(m)}
      <td class="muted">${m.closed}</td>
      <td class="muted">${m.won ?? 0} · ${m.lost ?? 0}</td>
    </tr>`;
  }).join('');
}

/**
 * Monthly unrealised: what the positions still held gained or lost over each
 * month, before anything was sold. The account's result for the month (its
 * change in value, deposits and withdrawals left out) less what closed trades
 * banked — so the two halves of the page add up to the whole. Dividends,
 * interest and fees land on this side, since they are not a sale.
 */
export function unrealisedMonths(account, trades) {
  const out = new Map();
  for (const [key, month] of account) {
    const realised = trades[key]?.real ?? 0;
    const unrealised = month.pnl - realised;
    out.set(key, {
      ...month,
      realised,
      unrealised,
      unrealisedPct: month.startValue > 0 ? (unrealised / month.startValue) * 100 : null,
    });
  }
  return out;
}

function renderUnrealised(year) {
  const months = unrealisedMonths(accountMonths(), closedByMonth());
  renderMonthlyChart(MONTHS_SHORT.map((_, i) => {
    const m = months.get(`${year}-${String(i + 1).padStart(2, '0')}`);
    return m ? +m.unrealised.toFixed(2) : 0;
  }), { canvasId: 'monthChartU', slot: 'monthU' });

  const body = el('monthTableU');
  if (!body) return;
  const keys = [...months.keys()].sort().reverse();
  if (!keys.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty">No daily account values yet — they appear once prices for your holdings have loaded</div></td></tr>';
    return;
  }
  body.innerHTML = keys.map((key) => {
    const m = months.get(key);
    return `<tr>
      <td class="mo">${monthLabel(key)}</td>
      <td style="color:${clr(m.unrealised)};font-weight:600">${$s(m.unrealised)}</td>
      <td style="color:${m.unrealisedPct == null ? 'inherit' : clr(m.unrealisedPct)}">${m.unrealisedPct == null ? '—' : fp(m.unrealisedPct)}</td>
      <td style="color:${clr(m.realised)}">${m.realised ? $s(m.realised) : '—'}</td>
      ${accountCells(m)}
    </tr>`;
  }).join('');
}

/** Which half of the page is showing: what was sold, or what is still held. */
let mode = 'realised';

function bindTabs() {
  const page = el('monthly');
  if (!page || page.dataset.tabsBound === '1') return;
  page.dataset.tabsBound = '1';
  page.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-month-mode]');
    if (!tab || tab.dataset.monthMode === mode) return;
    mode = tab.dataset.monthMode;
    renderMonthly();
  });
}

function showMode() {
  for (const tab of document.querySelectorAll('[data-month-mode]')) {
    const on = tab.dataset.monthMode === mode;
    tab.classList.toggle('on', on);
    tab.setAttribute('aria-selected', String(on));
  }
  const realised = el('monthRealised');
  const unrealised = el('monthUnrealised');
  if (realised) realised.hidden = mode !== 'realised';
  if (unrealised) unrealised.hidden = mode !== 'unrealised';
}

/**
 * Sales of the same holding, shown as one trade.
 *
 * Selling 291 ETHA in four goes is one position being got out of, not four
 * trades. Grouped by ticker, direction and the holding they came from — the
 * date it was bought — so an earlier round trip in the same name stays its own
 * row, and so does a second account's.
 *
 * Every sale survives as an exit inside the row, which is what the expanded
 * breakdown lists. Entry and exit are set so that the row's realised P&L is
 * exactly the sum of its parts rather than a re-derived number.
 */
function holdingKey(p) {
  return `${p.ticker}|${p.dir}|${p.open ?? ''}|${p.account ?? ''}`;
}

function mergeSales(parts) {
  if (parts.length === 1) return parts[0];
  const sorted = [...parts].sort((a, b) => (a.close || '').localeCompare(b.close || ''));
  const cost = sorted.reduce((sum, p) => sum + costOf(p), 0);
  const pnl = sorted.reduce((sum, p) => sum + realized(p), 0);
  // A statement records a sale as a result with no share price, and its "units"
  // are meaningless; real exits keep their units.
  const summary = sorted.every((p) => p.summary);
  const qty = summary ? 1 : sorted.reduce((sum, p) => sum + p.qty, 0);

  const exits = sorted.flatMap((p) => {
    const own = p.exits?.length ? p.exits : [{ d: p.close, qty: p.qty, price: p.cur, pnl: realized(p) }];
    const partCost = costOf(p);
    return own.map((e) => ({
      ...e,
      d: e.d || p.close,
      // What this slice cost, so its share and its own return stay right once
      // the parts sit inside one row.
      cost: p.exits?.length ? p.entry * e.qty : partCost,
    }));
  });
  for (const e of exits) e.pct = cost > 0 ? (e.cost / cost) * 100 : 0;

  return {
    ...sorted[sorted.length - 1],
    merged: true,
    partCount: sorted.length,
    exits,
    qty,
    origQty: qty,
    entry: cost / qty,
    cur: (cost + pnl) / qty,
    amount: cost,
    close: sorted[sorted.length - 1].close,
    firstExit: sorted[0].close,
    reason: [...new Set(sorted.map((p) => p.reason).filter(Boolean))].join('\n\n') || null,
  };
}

export function mergedTrades(trades) {
  const groups = new Map();
  for (const p of trades) {
    const key = holdingKey(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.values()].map(mergeSales);
}

/** The per-exit breakdown shown when a trade row is expanded. */
function exitBreakdown(p, pnl, retPct) {
  const exits = p.exits?.length ? p.exits : [{ d: p.close, qty: p.qty, price: p.cur, pnl }];
  const totalQty = p.exits?.length ? p.exits.reduce((sum, e) => sum + e.qty, 0) : p.qty;
  const th = (label) => `<th style="border-bottom:0.5px solid var(--border)">${label}</th>`;

  return `<tr><td colspan="10" style="padding:0;background:var(--panel2)">
    <div style="padding:14px 18px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">How this position was closed</div>
      <table style="width:100%">
        <thead><tr>${['Date', '% of position', 'Units', 'Exit price', 'Value', 'P&L', 'Return'].map(th).join('')}</tr></thead>
        <tbody>
        ${exits.map((e) => {
          const slicePct = e.pct != null ? e.pct : (totalQty ? (e.qty / totalQty) * 100 : 0);
          // A merged row carries each slice's own cost; on a single trade the
          // slice cost is its share of the entry.
          const sliceCost = e.cost ?? p.entry * e.qty;
          const sliceRet = sliceCost ? (e.pnl / sliceCost) * 100 : 0;
          return `<tr>
            <td style="color:var(--text3);font-size:12px">${escapeHtml(e.d)}</td>
            <td style="font-weight:600;color:var(--amber)">${slicePct.toFixed(1)}%</td>
            <td style="font-size:12px">${p.summary ? '—' : fmtQty(e.qty)}</td>
            <td style="font-size:12px">${p.summary ? '—' : `$${fmtPrice(e.price)}`}</td>
            <td style="font-size:12px">${$u(p.summary ? e.cost + e.pnl : e.qty * e.price)}</td>
            <td style="color:${clr(e.pnl)};font-weight:600">${$s(+e.pnl.toFixed(2))}</td>
            <td style="color:${clr(sliceRet)}">${fp(sliceRet)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
      <div style="margin-top:12px;padding-top:12px;border-top:0.5px solid var(--border2);display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="font-size:12px;color:var(--text3)">
          ${p.summary
    // Recorded from a statement as results, with no share prices behind them.
    ? `Invested ${$u(costOf(p))} · sold for ${$u(costOf(p) + pnl)}`
    : `Entry $${fmtPrice(p.entry)} · ${fmtQty(totalQty)} units · invested ${$u(costOf(p))}`
      + (p.exits?.length > 1 ? ` · avg exit $${fmtPrice(p.cur)}` : '')}
        </div>
        <div style="font-size:13px;font-weight:600">
          <span style="color:var(--text3);font-weight:400;font-size:12px">Overall&nbsp;</span>
          <span style="color:${clr(pnl)}">${$s(pnl)}</span>
          <span style="color:${clr(retPct)}">&nbsp;(${fp(retPct)})</span>
        </div>
      </div>
    </div>
  </td></tr>`;
}

function tradeRow(p) {
  const pnl = realized(p);
  const retPct = pctD(pnl, costOf(p));
  const exitCount = p.exits?.length ?? 0;
  const expanded = ui.expandedMonthTradeId === p.id;

  const row = `<tr style="cursor:pointer" onclick="toggleMonthTrade(${p.id})">
    <td style="font-weight:600"><span style="color:${expanded ? 'var(--blue)' : 'var(--text3)'};font-size:10px;display:inline-block;width:10px">${expanded ? '▼' : '▶'}</span> ${escapeHtml(p.ticker)}${exitCount > 1 ? ` <span class="badge" style="background:var(--amber-bg);color:var(--amber);font-size:9px">${exitCount} exits</span>` : ''}<div style="font-size:10px;color:var(--text4);font-weight:400;margin-left:14px">bought ${escapeHtml(p.open)}</div></td>
    <td><span class="badge b-${p.dir.toLowerCase()}">${p.dir}</span></td>
    <td style="color:var(--text3);font-size:12px">${escapeHtml(p.open)}</td>
    <td style="color:var(--text3);font-size:12px">${escapeHtml(p.close)}${p.firstExit && p.firstExit !== p.close ? `<div style="font-size:10px;color:var(--text4)">from ${escapeHtml(p.firstExit)}</div>` : ''}</td>
    <td style="font-size:12px">$${fmtPrice(p.entry)}</td>
    <td style="font-size:12px">$${fmtPrice(p.cur)}${exitCount > 1 ? '<div style="font-size:10px;color:var(--text4)">avg</div>' : ''}</td>
    <td>${$u(costOf(p))}</td>
    <td style="color:${clr(pnl)};font-weight:600">${$s(pnl)}</td>
    <td style="color:${clr(retPct)}">${fp(retPct)}</td>
    <td style="font-size:11px;color:var(--text3);max-width:200px;white-space:normal">${p.reason ? escapeHtml(p.reason) : '—'}</td>
  </tr>`;

  return expanded ? row + exitBreakdown(p, pnl, retPct) : row;
}

export function renderMonthDetail() {
  const detail = el('monthDetail');
  if (!detail) return;
  const key = el('pickMonth')?.value;
  if (!key) {
    detail.innerHTML = '<div class="empty">Select a month above to see its trades</div>';
    return;
  }

  const title = `${MONTHS_LONG[parseInt(key.slice(5), 10) - 1]} ${key.slice(0, 4)}`;
  const trades = state.positions.filter((p) => p.status === 'Closed' && p.close?.startsWith(key));

  if (!trades.length) {
    detail.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text3)">
      <div style="font-size:14px;font-weight:500;color:var(--text);margin-bottom:6px">${title}</div>
      <div style="font-size:13px">No closed trades this month</div>
      <div style="font-size:11px;margin-top:4px">Positions closed in ${title} will appear here automatically</div>
    </div>`;
    return;
  }

  const total = trades.reduce((sum, p) => sum + realized(p), 0);
  const wins = trades.filter((p) => outcomeOf(realized(p)) === 'win').length;
  const losses = trades.filter((p) => outcomeOf(realized(p)) === 'loss').length;
  const headers = ['Asset', 'Direction', 'Opened', 'Closed', 'Entry', 'Exit', 'Invested', 'Realised P&L', 'Return %', 'Reason'];

  detail.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-size:14px;font-weight:600;color:var(--text)">${title}</div>
      <div style="display:flex;gap:16px;font-size:12px">
        <span style="color:var(--text3)">${trades.length} trade${trades.length !== 1 ? 's' : ''} · ${wins}W ${losses}L</span>
        <span style="color:${clr(total)};font-weight:600">${$s(total)}</span>
      </div>
    </div>
    <table>
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${mergedTrades(trades).sort((a, b) => new Date(b.close) - new Date(a.close)).map(tradeRow).join('')}</tbody>
    </table>`;
}

export function renderMonthly() {
  bindTabs();
  showMode();
  // Only the half on screen is drawn: a chart drawn while hidden has no size.
  if (mode === 'unrealised') {
    renderUnrealised(renderYearSelect('chartYearU'));
    return;
  }
  const year = renderYearSelect();
  renderMonthlyChart(yearTotals(year));
  renderSummaryTable();
  renderMindStats();
  populateYearPicker();
  populateMonthPicker();
}

/**
 * Closed trades grouped by the state of mind they were taken in: does the
 * trader do better calm and confident than emotional? Every trade, every year.
 * Exported for the tests.
 */
export function mindStatsHtml(positions) {
  const { groups, unrated } = mindStats(positions);
  const rated = groups.reduce((n, g) => n + g.trades, 0);
  if (!rated) {
    return `<p class="mind-empty">Rate your state of mind when you enter a trade (New trade → State of mind at entry). Once a few rated trades have closed, this shows whether you do better confident or emotional.${unrated ? ` ${unrated} closed trade${unrated === 1 ? ' has' : 's have'} no rating yet — you can add one from Edit on the trade.` : ''}</p>`;
  }
  const best = groups.filter((g) => g.trades).sort((a, b) => b.avgReturn - a.avgReturn)[0];
  const cell = (v, f) => (v == null ? '—' : f(v));
  return `<div class="mind-grid">${groups.map((g) => `<div class="mind-col${g === best && groups.filter((x) => x.trades).length > 1 ? ' best' : ''}" data-group="${g.id}">
      <div class="mind-gl">${g.label}</div>
      <div class="mind-gv"><span>Trades</span><b>${g.trades}</b></div>
      <div class="mind-gv"><span>Win rate</span><b>${cell(g.winRate, (v) => `${Math.round(v)}%`)}</b></div>
      <div class="mind-gv"><span>Avg return</span><b style="color:${g.avgReturn == null ? 'inherit' : clr(g.avgReturn)}">${cell(g.avgReturn, fp)}</b></div>
      <div class="mind-gv"><span>Total P&amp;L</span><b style="color:${clr(g.pnl)}">${g.trades ? $s(g.pnl) : '—'}</b></div>
    </div>`).join('')}</div>
    <p class="mind-foot">${rated} rated closed trade${rated === 1 ? '' : 's'}${unrated ? ` · ${unrated} not rated` : ''}. Rate each trade at entry to make this sharper.</p>`;
}

function renderMindStats() {
  const box = el('mindStats');
  if (box) box.innerHTML = mindStatsHtml(state.positions);
}

/** Clicking a summary row jumps the detail picker to that month. */
export function selectMonth(key) {
  const yearPicker = el('pickYear');
  if (yearPicker) yearPicker.value = key.slice(0, 4);
  populateMonthPicker();
  const monthPicker = el('pickMonth');
  if (monthPicker) monthPicker.value = key;
  renderMonthDetail();
  el('monthDetail')?.scrollIntoView({ behavior: 'smooth' });
}
