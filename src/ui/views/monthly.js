/**
 * The Monthly page: a twelve-bar year chart, a summary table of every month
 * with activity, and a drill-down into the trades of one chosen month.
 *
 * Only fully closed positions are booked to a month. Partially closed trades
 * stay out until their last exit, which is what keeps the monthly totals equal
 * to money actually taken off the table.
 */
import { state } from '../../core/store.js';
import { realized, unreal, costOf, pctD } from '../../core/portfolio.js';
import { MONTHS_SHORT, MONTHS_LONG, YEAR_PICKER } from '../../config/constants.js';
import { renderMonthlyChart } from '../charts.js';
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

/**
 * Every month that has activity, keyed YYYY-MM.
 * The current month also carries open unrealised P&L, so the table shows where
 * the book stands today rather than only what has been banked.
 */
function monthsWithActivity() {
  const months = {};
  const ensure = (key) => (months[key] ??= { real: 0, unreal: 0, cost: 0, closed: 0 });

  state.positions.forEach((p) => {
    if (p.status !== 'Closed' || !p.close) return;
    const bucket = ensure(p.close.slice(0, 7));
    bucket.real += realized(p);
    bucket.cost += costOf(p);
    bucket.closed++;
  });

  const open = state.positions.filter((p) => p.status === 'Open');
  const openUnreal = open.reduce((sum, p) => sum + unreal(p), 0);
  if (openUnreal !== 0) {
    const bucket = ensure(new Date().toISOString().slice(0, 7));
    bucket.unreal += openUnreal;
    bucket.cost += open.reduce((sum, p) => sum + costOf(p), 0);
  }
  return months;
}

function renderYearSelect() {
  const select = el('chartYear');
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

function renderSummaryTable() {
  const body = el('monthTable');
  if (!body) return;
  const months = monthsWithActivity();
  const keys = Object.keys(months).sort().reverse();

  if (!keys.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty">No closed trades yet</div></td></tr>';
    return;
  }

  body.innerHTML = keys.map((key) => {
    const m = months[key];
    const total = m.real + m.unreal;
    const ret = m.cost ? (total / m.cost) * 100 : 0;
    const label = new Date(`${key}-02`).toLocaleString('default', { month: 'long', year: 'numeric' });
    return `<tr style="cursor:pointer" onclick="selectMonth('${key}')">
      <td class="mo">${label}</td>
      <td style="color:${clr(m.real)}">${$s(m.real)}</td>
      <td style="color:${clr(m.unreal)}">${m.unreal ? $s(m.unreal) : '—'}</td>
      <td style="color:${clr(total)};font-weight:600">${$s(total)}</td>
      <td style="color:${clr(ret)}">${fp(ret)}</td>
      <td class="muted">${m.closed}</td>
    </tr>`;
  }).join('');
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
          const sliceCost = p.entry * e.qty;
          const sliceRet = sliceCost ? (e.pnl / sliceCost) * 100 : 0;
          return `<tr>
            <td style="color:var(--text3);font-size:12px">${e.d}</td>
            <td style="font-weight:600;color:var(--amber)">${slicePct.toFixed(1)}%</td>
            <td style="font-size:12px">${fmtQty(e.qty)}</td>
            <td style="font-size:12px">$${fmtPrice(e.price)}</td>
            <td style="font-size:12px">${$u(e.qty * e.price)}</td>
            <td style="color:${clr(e.pnl)};font-weight:600">${$s(+e.pnl.toFixed(2))}</td>
            <td style="color:${clr(sliceRet)}">${fp(sliceRet)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
      <div style="margin-top:12px;padding-top:12px;border-top:0.5px solid var(--border2);display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="font-size:12px;color:var(--text3)">
          Entry $${fmtPrice(p.entry)} · ${fmtQty(totalQty)} units · invested ${$u(costOf(p))}
          ${p.exits?.length > 1 ? ` · avg exit $${fmtPrice(p.cur)}` : ''}
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
    <td style="font-weight:600"><span style="color:${expanded ? 'var(--blue)' : 'var(--text3)'};font-size:10px;display:inline-block;width:10px">${expanded ? '▼' : '▶'}</span> ${escapeHtml(p.ticker)}${exitCount > 1 ? ` <span class="badge" style="background:var(--amber-bg);color:var(--amber);font-size:9px">${exitCount} exits</span>` : ''}<div style="font-size:10px;color:var(--text4);font-weight:400;margin-left:14px">bought ${p.open}</div></td>
    <td><span class="badge b-${p.dir.toLowerCase()}">${p.dir}</span></td>
    <td style="color:var(--text3);font-size:12px">${p.open}</td>
    <td style="color:var(--text3);font-size:12px">${p.close}${p.firstExit && p.firstExit !== p.close ? `<div style="font-size:10px;color:var(--text4)">from ${p.firstExit}</div>` : ''}</td>
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
  const wins = trades.filter((p) => realized(p) > 0).length;
  const headers = ['Asset', 'Direction', 'Opened', 'Closed', 'Entry', 'Exit', 'Invested', 'Realised P&L', 'Return %', 'Reason'];

  detail.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-size:14px;font-weight:600;color:var(--text)">${title}</div>
      <div style="display:flex;gap:16px;font-size:12px">
        <span style="color:var(--text3)">${trades.length} trade${trades.length !== 1 ? 's' : ''} · ${wins}W ${trades.length - wins}L</span>
        <span style="color:${clr(total)};font-weight:600">${$s(total)}</span>
      </div>
    </div>
    <table>
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${[...trades].sort((a, b) => new Date(b.close) - new Date(a.close)).map(tradeRow).join('')}</tbody>
    </table>`;
}

export function renderMonthly() {
  const year = renderYearSelect();
  renderMonthlyChart(yearTotals(year));
  renderSummaryTable();
  populateYearPicker();
  populateMonthPicker();
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
