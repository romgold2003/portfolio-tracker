/**
 * The holdings lists' columns (November 2026), built the way Interactive
 * Brokers lets a trader build them: any columns from config/columns.js, in any
 * order, sorted by any of them up or down by clicking its header. The Home
 * list and the Positions list each keep their own layout, saved with the
 * account (store.js, setColumns).
 *
 * This file works out each column's figure for a position, draws the header
 * and the cells, sorts the list, and runs the picker. The pages draw the rows.
 */
import { state, setColumns } from '../../core/store.js';
import {
  COLUMNS, COLUMN_GROUPS, COLUMN_PRESETS, MAX_COLUMNS, defaultLayout,
} from '../../config/columns.js';
import {
  unreal, costOf, posValue, realisedSoFar, dailyPercent, dailyDollar, dailyDollarExits,
  dailyDollarTotal, accountTotals, todayStr,
} from '../../core/portfolio.js';
import { cutoffFor } from '../../core/snapshots.js';
import { sectorOf } from '../../config/sectors.js';
import { dayStillRunning } from '../dayReset.js';
import {
  signedMoney as $s, money as $u, pctText as fp, pnlColor as clr, fmtPrice, fmtShares, escapeHtml,
} from '../format.js';

/**
 * Past closes come from the Home page's price histories, handed over here at
 * start-up rather than imported, so the two modules do not import each other.
 */
let priceSource = { pastPrice: () => null, rowsOf: () => [] };
export function setPriceSource(source) { priceSource = { ...priceSource, ...source }; }

const DAY = 86400000;
const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
const sign = (p) => (p.dir === 'Short' ? -1 : 1);

/**
 * A holding's move over a window: from the close before the window opened, or
 * from what was paid if it was bought inside the window. Signed for the
 * position, so a short whose price fell gains. Null until the history is in.
 */
function windowMove(p, timeframe) {
  const start = cutoffFor(timeframe).toISOString().slice(0, 10);
  const base = p.open && p.open >= start ? p.entry : priceSource.pastPrice(p.ticker, dayBefore(start));
  if (!(base > 0) || !(p.cur > 0)) return null;
  return { pct: ((p.cur - base) / base) * 100 * sign(p), usd: (p.cur - base) * p.qty * sign(p) };
}

/** The highest and lowest close of the last year, on today's split-adjusted scale. */
function yearRange(p) {
  const since = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  const closes = (priceSource.rowsOf(p.ticker) ?? []).filter((r) => r.date >= since && r.close > 0).map((r) => r.close);
  if (p.cur > 0) closes.push(p.cur);
  if (closes.length < 2) return null;
  return { high: Math.max(...closes), low: Math.min(...closes) };
}

/** Everything a row needs that is the same for every row: worked out once per draw. */
export function listContext(positions = state.positions) {
  const account = accountTotals(positions, state.cash).account;
  return { account, positions, today: todayStr(), memo: new Map() };
}

const memo = (ctx, p, key, work) => {
  const k = `${p.id ?? p.ticker}:${key}`;
  if (!ctx.memo.has(k)) ctx.memo.set(k, work());
  return ctx.memo.get(k);
};

/** Each column's number (or text) for one position: what it sorts by. Null is "not known yet". */
export function columnValue(id, p, ctx) {
  const running = dayStillRunning(p);
  switch (id) {
    case 'symbol': return p.ticker;
    case 'cls': return p.cls ?? '';
    case 'sector': return sectorOf(p);
    case 'dir': return p.dir;
    case 'account': return p.account ?? 'Main';
    case 'qty': return p.qty;
    case 'avg': return p.entry;
    case 'cost': return costOf(p);
    case 'price': return p.cur > 0 ? p.cur : null;
    case 'value': return posValue(p);
    case 'weight': return ctx.account > 0 ? (posValue(p) / ctx.account) * 100 : null;
    case 'held': return p.open ? Math.max(0, Math.round((Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${p.open}T00:00:00Z`)) / DAY)) : null;
    case 'opened': return p.open ?? null;
    case 'dayUsd':
      if (!running) return 0;
      return dailyDollar(p) == null && dailyDollarExits(p) === 0 ? null : dailyDollarTotal(p);
    case 'dayPct': return running ? dailyPercent(p) : 0;
    case 'weekUsd': return memo(ctx, p, '1W', () => windowMove(p, '1W'))?.usd ?? null;
    case 'weekPct': return memo(ctx, p, '1W', () => windowMove(p, '1W'))?.pct ?? null;
    case 'monthUsd': return memo(ctx, p, '1M', () => windowMove(p, '1M'))?.usd ?? null;
    case 'monthPct': return memo(ctx, p, '1M', () => windowMove(p, '1M'))?.pct ?? null;
    case 'quarterPct': return memo(ctx, p, '3M', () => windowMove(p, '3M'))?.pct ?? null;
    case 'ytdUsd': return memo(ctx, p, 'YTD', () => windowMove(p, 'YTD'))?.usd ?? null;
    case 'ytdPct': return memo(ctx, p, 'YTD', () => windowMove(p, 'YTD'))?.pct ?? null;
    case 'unrealUsd': return unreal(p);
    case 'realUsd': return realisedSoFar(p, ctx.positions);
    case 'totalUsd': return unreal(p) + realisedSoFar(p, ctx.positions);
    case 'unrealPct': return costOf(p) ? (unreal(p) / Math.abs(costOf(p))) * 100 : null;
    case 'totalPct': return costOf(p) ? ((unreal(p) + realisedSoFar(p, ctx.positions)) / Math.abs(costOf(p))) * 100 : null;
    case 'contrib': return ctx.account > 0 ? (unreal(p) / ctx.account) * 100 : null;
    case 'high52': return memo(ctx, p, 'range', () => yearRange(p))?.high ?? null;
    case 'low52': return memo(ctx, p, 'range', () => yearRange(p))?.low ?? null;
    case 'fromHigh': {
      const r = memo(ctx, p, 'range', () => yearRange(p));
      return r && p.cur > 0 ? ((p.cur - r.high) / r.high) * 100 : null;
    }
    default: return null;
  }
}

const dash = '<span class="hc-none">—</span>';
const coloured = (v, text) => `<span style="color:${clr(v)}">${text}</span>`;

/** One column's cell, as shown. */
export function columnCell(id, p, ctx) {
  const v = columnValue(id, p, ctx);
  let body;
  if (v == null || v === '') body = dash;
  else {
    switch (id) {
      case 'qty': body = escapeHtml(fmtShares(v)); break;
      case 'avg': case 'price': case 'high52': case 'low52': body = `$${fmtPrice(v)}`; break;
      case 'cost': case 'value': body = $u(v); break;
      case 'weight': body = `${v.toFixed(1)}%`; break;
      case 'held': body = `${v}d`; break;
      case 'opened': body = new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: '2-digit' }); break;
      case 'dayUsd': case 'weekUsd': case 'monthUsd': case 'ytdUsd': case 'unrealUsd': case 'realUsd': case 'totalUsd':
        body = coloured(v, $s(+v.toFixed(2))); break;
      // The day's % is the price's move, coloured by what it means for this position.
      case 'dayPct': body = coloured(v, fp(p.dir === 'Short' ? -v : v)); break;
      case 'weekPct': case 'monthPct': case 'quarterPct': case 'ytdPct': case 'unrealPct': case 'totalPct': case 'contrib': case 'fromHigh':
        body = coloured(v, fp(v)); break;
      default: body = escapeHtml(String(v));
    }
  }
  return `<div class="hc-cell${COLUMNS[id]?.text ? ' hc-left' : ''}" data-col="${id}">${body}</div>`;
}

/** The list in the layout's order: by the chosen column, unknown figures always last. */
export function sortByLayout(list, layout, ctx) {
  const { id, dir } = layout.sort;
  const factor = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = columnValue(id, a, ctx);
    const y = columnValue(id, b, ctx);
    const xMissing = x == null || x === '';
    const yMissing = y == null || y === '';
    if (xMissing || yMissing) return xMissing === yMissing ? 0 : xMissing ? 1 : -1;
    if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * factor;
    return (x - y) * factor;
  });
}

/** The grid every row of a list shares: the symbol, then one track per column. */
export function gridStyle(layout) {
  return `--hc-cols:${layout.cols.length};--hc-min:${120 + layout.cols.length * 86}px`;
}

const arrow = (layout, id) => (layout.sort.id !== id ? '' : layout.sort.dir === 'asc' ? ' ▲' : ' ▼');

/** The header row: every heading sorts, the ⚙ button opens the picker. */
export function headerHtml(page, layout) {
  const head = (id, label, help, extra = '') => `<button type="button" class="hc-head${extra}${layout.sort.id === id ? ' on' : ''}" data-hc-sort="${id}" data-hc-page="${page}" title="${escapeHtml(help)} — click to sort" aria-sort="${layout.sort.id !== id ? 'none' : layout.sort.dir === 'asc' ? 'ascending' : 'descending'}">${escapeHtml(label)}${arrow(layout, id)}</button>`;
  return `<div class="hc-row hc-header" style="${gridStyle(layout)}">
      ${head('symbol', 'Symbol', 'The ticker', ' hc-left hc-sym')}
      ${layout.cols.map((id) => head(id, COLUMNS[id].label, COLUMNS[id].help, COLUMNS[id].text ? ' hc-left' : '')).join('')}
    </div>`;
}

/**
 * The bar above a list: what it is sorted by, and the Columns button. Redrawn
 * with the list; the picker below it (#hcPicker-page, in index.html) is not,
 * so it stays open through a price refresh.
 */
export function toolbarHtml(page, layout) {
  const by = layout.sort.id === 'symbol' ? 'Symbol' : COLUMNS[layout.sort.id]?.label ?? '';
  const text = layout.sort.id === 'symbol' || COLUMNS[layout.sort.id]?.text;
  const order = layout.sort.dir === 'asc' ? (text ? 'A to Z' : 'lowest first') : (text ? 'Z to A' : 'highest first');
  const open = typeof document !== 'undefined' && document.getElementById(`hcPicker-${page}`)?.hidden === false;
  return `<div class="hc-bar">
      <span class="hc-by">Sorted by <b>${escapeHtml(by)}</b>, ${order} · click a heading to change</span>
      <button type="button" class="sort-btn hc-open" data-hc-picker="${page}" aria-expanded="${open}">⚙ Columns</button>
    </div>`;
}

/* ── The picker ── */

let dragging = null;

function pickerHtml(page, layout) {
  const shown = layout.cols.map((id, i) => `<li class="hc-item" draggable="true" data-hc-item="${id}">
      <span class="hc-grip" aria-hidden="true">⋮⋮</span>
      <span class="hc-name">${escapeHtml(COLUMNS[id].label)}</span>
      <span class="hc-moves">
        <button type="button" data-hc-move="up" data-hc-id="${id}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${escapeHtml(COLUMNS[id].label)} left">↑</button>
        <button type="button" data-hc-move="down" data-hc-id="${id}" ${i === layout.cols.length - 1 ? 'disabled' : ''} aria-label="Move ${escapeHtml(COLUMNS[id].label)} right">↓</button>
        <button type="button" data-hc-remove="${id}" aria-label="Remove ${escapeHtml(COLUMNS[id].label)}">✕</button>
      </span>
    </li>`).join('');
  const full = layout.cols.length >= MAX_COLUMNS;
  const groups = COLUMN_GROUPS.map(([g, title]) => `<div class="hc-group"><div class="hc-gtitle">${escapeHtml(title)}</div>
      ${Object.entries(COLUMNS).filter(([, c]) => c.group === g).map(([id, c]) => {
    const on = layout.cols.includes(id);
    return `<label class="hc-check" title="${escapeHtml(c.help)}"><input type="checkbox" data-hc-toggle="${id}" ${on ? 'checked' : ''} ${!on && full ? 'disabled' : ''}><span>${escapeHtml(c.label)}</span></label>`;
  }).join('')}
    </div>`).join('');
  return `<div class="hc-presets"><span class="hc-ptitle">Layouts</span>${Object.entries(COLUMN_PRESETS).map(([key, pr]) => `<button type="button" class="sort-btn" data-hc-preset="${key}">${escapeHtml(pr.label)}</button>`).join('')}
      <button type="button" class="sort-btn" data-hc-preset="reset">Reset</button></div>
    <div class="hc-cols">
      <div class="hc-shown"><div class="hc-gtitle">Shown, in order (drag to move)${full ? ` · ${MAX_COLUMNS} at most` : ''}</div><ol class="hc-list">${shown || '<li class="hc-empty">Only the symbol. Tick columns to add them.</li>'}</ol></div>
      <div class="hc-all">${groups}</div>
    </div>
    <div class="hc-done"><button type="button" class="btn btn-blue" data-hc-close="${page}">Done</button></div>`;
}

function update(page, change) {
  const layout = state.columns[page];
  setColumns(page, change({ cols: [...layout.cols], sort: { ...layout.sort } }));
}

function redrawPicker(page) {
  const box = document.getElementById(`hcPicker-${page}`);
  if (box && !box.hidden) box.innerHTML = pickerHtml(page, state.columns[page]);
}

/**
 * Wire a list's container once: header sorting, the picker, and its changes.
 * `redraw` draws the list again after any change.
 */
export function bindColumns(container, page, redraw) {
  if (!container || container.dataset.hcBound === '1') return;
  container.dataset.hcBound = '1';
  const changed = () => { redraw(); redrawPicker(page); };

  container.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t('[data-hc-sort]')) {
      const id = t('[data-hc-sort]').dataset.hcSort;
      update(page, (l) => {
        const firstDir = id === 'symbol' || COLUMNS[id]?.text ? 'asc' : 'desc';
        l.sort = l.sort.id === id ? { id, dir: l.sort.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: firstDir };
        return l;
      });
      changed();
      return;
    }
    if (t('[data-hc-picker]')) {
      const box = document.getElementById(`hcPicker-${page}`);
      const open = box.hidden;
      box.hidden = !open;
      t('[data-hc-picker]').setAttribute('aria-expanded', String(open));
      if (open) box.innerHTML = pickerHtml(page, state.columns[page]);
      return;
    }
    if (t('[data-hc-close]')) {
      const box = document.getElementById(`hcPicker-${page}`);
      box.hidden = true;
      container.querySelector('[data-hc-picker]')?.setAttribute('aria-expanded', 'false');
      return;
    }
    if (t('[data-hc-preset]')) {
      const key = t('[data-hc-preset]').dataset.hcPreset;
      update(page, (l) => (key === 'reset' ? defaultLayout() : { ...l, cols: [...COLUMN_PRESETS[key].cols] }));
      changed();
      return;
    }
    if (t('[data-hc-remove]')) {
      const id = t('[data-hc-remove]').dataset.hcRemove;
      update(page, (l) => ({ ...l, cols: l.cols.filter((c) => c !== id) }));
      changed();
      return;
    }
    if (t('[data-hc-move]')) {
      const b = t('[data-hc-move]');
      update(page, (l) => {
        const i = l.cols.indexOf(b.dataset.hcId);
        const j = b.dataset.hcMove === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= l.cols.length) return l;
        [l.cols[i], l.cols[j]] = [l.cols[j], l.cols[i]];
        return l;
      });
      changed();
    }
  });

  container.addEventListener('change', (e) => {
    const id = e.target.dataset?.hcToggle;
    if (!id) return;
    update(page, (l) => ({ ...l, cols: e.target.checked ? [...l.cols, id] : l.cols.filter((c) => c !== id) }));
    changed();
  });

  // Drag a shown column onto another to put it there.
  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest?.('[data-hc-item]');
    if (!item) return;
    dragging = item.dataset.hcItem;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragging);
    item.classList.add('dragging');
  });
  container.addEventListener('dragover', (e) => {
    if (dragging && e.target.closest?.('[data-hc-item]')) e.preventDefault();
  });
  container.addEventListener('drop', (e) => {
    const over = e.target.closest?.('[data-hc-item]');
    if (!dragging || !over) return;
    e.preventDefault();
    const target = over.dataset.hcItem;
    const moving = dragging;
    dragging = null;
    if (target === moving) { redrawPicker(page); return; }
    update(page, (l) => {
      const cols = l.cols.filter((c) => c !== moving);
      cols.splice(cols.indexOf(target) + (l.cols.indexOf(moving) < l.cols.indexOf(target) ? 1 : 0), 0, moving);
      return { ...l, cols };
    });
    changed();
  });
  container.addEventListener('dragend', () => { dragging = null; redrawPicker(page); });
}
