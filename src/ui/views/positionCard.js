/**
 * The expandable position card used on the Positions page.
 *
 * Views are pure string builders: they read state and return HTML, and never
 * mutate anything. Interaction is wired through the inline `onclick` handlers,
 * which resolve against the global bridge in src/app/actions.js.
 */
import { ASSET_CLASSES } from '../../config/constants.js';
import {
  unreal, realized, pctD, costOf, curValOf,
  dailyDollarExits, dailyDollarTotal,
  todayStr, baseQtyOf, bookedPnl, hasDailyFigure,
} from '../../core/portfolio.js';
import { priceIsLive } from '../../services/prices.js';
import { ui } from '../uiState.js';
import {
  money as $u, signedMoney as $s, pctText as fp, pnlColor as clr,
  fmtPrice, fmtQty, escapeHtml,
} from '../format.js';

/** Entry-reason note, shown on both open and closed cards. */
function reasonBlock(p) {
  if (!p.reason) return '';
  return `<div style="background:var(--panel2);border:0.5px solid var(--border2);border-radius:7px;padding:10px 13px;margin-bottom:14px;font-size:12px;color:var(--textmid);line-height:1.5"><span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px">Entry reason</span>${escapeHtml(p.reason)}</div>`;
}

/** The exit ledger — every partial sale, with a running total. */
function exitsBlock(p) {
  if (!p.exits || !p.exits.length) return '';
  const total = bookedPnl(p);
  return `<div style="background:var(--panel2);border:0.5px solid var(--border2);border-radius:7px;padding:10px 13px;margin-bottom:14px">
    <span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:6px">Exits — ${p.exits.length}${p.status === 'Open' ? ' so far · not yet in Monthly' : ''}</span>
    ${p.exits.map((e) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:0.5px solid var(--hover)">
      <span style="color:var(--text3)">${escapeHtml(e.d)}${p.summary ? '' : ` · ${fmtQty(e.qty)} @ $${fmtPrice(e.price)}`}</span>
      <span style="color:${clr(e.pnl)};font-weight:500">${$s(+e.pnl.toFixed(2))}</span>
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;font-size:12px;padding-top:7px;margin-top:4px;border-top:0.5px solid var(--border2)">
      <span style="color:var(--text3)">${p.status === 'Open' ? 'Banked so far' : 'Overall realised'}</span>
      <span style="color:${clr(total)};font-weight:600">${$s(+total.toFixed(2))}</span>
    </div>
  </div>`;
}

/** The grid of key figures at the top of an expanded card. */
function detailGrid(p, pnl) {
  const today = todayStr();
  const soldToday = dailyDollarExits(p, today);
  return `<div class="dg">
    ${p.summary
    // Entered from a statement as a result, with no prices behind it. Showing
    // the stake in a box labelled "entry price" would be inventing one.
    ? `<div class="dgi"><div class="dgi-k">Recorded as</div><div class="dgi-v" style="font-size:13px">Result only</div></div>`
    : `<div class="dgi"><div class="dgi-k">Entry price</div><div class="dgi-v">$${fmtPrice(p.entry)}</div></div>`}
    <div class="dgi"><div class="dgi-k">Amount invested</div><div class="dgi-v">${$u(costOf(p))}</div></div>
    <div class="dgi"><div class="dgi-k">Current value</div><div class="dgi-v" style="color:${clr(pnl)}">${$u(curValOf(p))}</div></div>
    ${p.dailyChg != null ? `<div class="dgi"><div class="dgi-k">Today D%</div><div class="dgi-v" style="color:${clr(p.dailyChg)}">${fp(p.dailyChg)}</div></div>` : ''}
    ${hasDailyFigure(p, today) ? `<div class="dgi"><div class="dgi-k">Today P&L</div><div class="dgi-v" style="color:${clr(dailyDollarTotal(p))}">${$s(+dailyDollarTotal(p).toFixed(2))}</div>${soldToday !== 0 ? `<div style="font-size:10px;color:var(--text3);margin-top:3px">incl. ${$s(+soldToday.toFixed(2))} sold today</div>` : ''}</div>` : ''}
    ${p.weeklyChg != null ? `<div class="dgi"><div class="dgi-k">This week</div><div class="dgi-v" style="color:${clr(p.weeklyChg)}">${fp(p.weeklyChg)}</div></div>` : ''}
  </div>`;
}

/**
 * Shared edit form. Closed trades additionally get exit price and close date,
 * which is the only difference between the two edit panels.
 */
function editFields(p, { includeExit }) {
  const opt = (value, selected) => `<option ${selected ? 'selected' : ''}>${value}</option>`;
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
    <div class="dca-field"><label>Ticker</label><input type="text" id="ed-ticker-${p.id}" value="${escapeHtml(p.ticker)}"></div>
    <div class="dca-field"><label>Asset class</label>
      <select id="ed-class-${p.id}">${ASSET_CLASSES.map((c) => opt(c, p.cls === c)).join('')}</select>
    </div>
    <div class="dca-field"><label>Direction</label>
      <select id="ed-dir-${p.id}">${['Long', 'Short'].map((d) => opt(d, p.dir === d)).join('')}</select>
    </div>
    <div class="dca-field"><label>Date opened</label><input type="date" id="ed-date-${p.id}" value="${escapeHtml(p.open)}"></div>
    ${includeExit ? `<div class="dca-field"><label>Date closed</label><input type="date" id="ed-close-${p.id}" value="${escapeHtml(p.close || '')}"></div>` : ''}
    <div class="dca-field"><label>Entry price ($)</label><input type="number" step="any" id="ed-entry-${p.id}" value="${p.entry}"></div>
    ${includeExit ? `<div class="dca-field"><label>Exit price ($)</label><input type="number" step="any" id="ed-exit-${p.id}" value="${p.cur}"></div>` : ''}
    <div class="dca-field"><label>Amount invested ($)</label><input type="number" step="any" id="ed-amount-${p.id}" value="${costOf(p).toFixed(2)}"></div>
    <div class="dca-field" style="grid-column:1/-1"><label>Reason for entry</label>
      <textarea id="ed-reason-${p.id}" style="min-height:60px;resize:vertical;font-size:13px;padding:8px 10px;border-radius:6px;border:0.5px solid var(--border2);background:var(--input);color:var(--text);font-family:inherit;width:100%;outline:none">${escapeHtml(p.reason || '')}</textarea>
    </div>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button class="pbtn" onclick="event.stopPropagation();toggleEdit(${p.id})">Cancel</button>
    <button class="dca-btn" style="background:var(--edit-bg);border-color:var(--edit-br);color:var(--green)" onclick="event.stopPropagation();saveEdit(${p.id})">Save changes</button>
  </div>`;
}

/**
 * The close panel. Percentages are always measured against the ORIGINAL
 * position size, never the remainder, so "50%" means the same thing on the
 * second exit as it did on the first.
 */
function closePanel(p) {
  const base = baseQtyOf(p);
  const openPct = +((p.qty / base) * 100).toFixed(4);
  const quickButtons = [25, 50, 75]
    .map((v) => `<button class="sort-btn" ${v > openPct + 0.0001 ? 'disabled style="opacity:.35;cursor:not-allowed"' : ''} onclick="event.stopPropagation();setClosePct(${p.id},${v})">${v}%</button>`)
    .join('');

  return `<div class="dca-panel" id="close-${p.id}" style="display:none;border-color:var(--red-br)">
    <div class="dca-head" style="color:var(--red)">Close position — full or partial</div>
    <div class="dca-inputs">
      <div class="dca-field"><label>Exit price ($)</label>
        <input type="number" step="any" id="cl-price-${p.id}" value="${p.cur}" oninput="syncClose(${p.id},'price')"></div>
      <div class="dca-field"><label>% of original position</label>
        <input type="number" step="any" min="0" max="100" id="cl-pct-${p.id}" value="${openPct}" oninput="syncClose(${p.id},'pct')"></div>
      <div class="dca-field"><label>Shares / units</label>
        <input type="number" step="any" id="cl-amt-${p.id}" oninput="syncClose(${p.id},'amt')"></div>
    </div>
    <div style="display:flex;gap:5px;margin-bottom:12px;flex-wrap:wrap">
      ${quickButtons}
      <button class="sort-btn" onclick="event.stopPropagation();setClosePct(${p.id},${openPct})">Close the rest</button>
      ${p.exits && p.exits.length ? `<span style="font-size:11px;color:var(--text3);align-self:center;margin-left:4px">${(100 - openPct).toFixed(1)}% already closed · ${openPct.toFixed(1)}% still open</span>` : ''}
    </div>
    <div class="dca-result show" id="cl-preview-${p.id}" style="border-color:var(--border2)"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="pbtn" onclick="event.stopPropagation();toggleClose(${p.id})">Cancel</button>
      <button class="dca-btn" style="background:var(--close-bg);border-color:var(--red-br);color:var(--red)" onclick="event.stopPropagation();confirmClose(${p.id})">Confirm close</button>
    </div>
  </div>`;
}

function dcaPanel(p) {
  return `<div class="dca-panel" id="dca-${p.id}" style="display:none">
    <div class="dca-head">DCA — add to this position</div>
    <div class="dca-inputs">
      <div class="dca-field"><label>Add amount ($)</label><input type="number" step="any" id="dcaAmt-${p.id}" placeholder="1000" oninput="calcDca(${p.id})"></div>
      <div class="dca-field"><label>At price ($)</label><input type="number" step="any" id="dcaPrice-${p.id}" placeholder="${fmtPrice(p.cur)}" oninput="calcDca(${p.id})"></div>
      <button class="dca-btn" onclick="event.stopPropagation();applyDca(${p.id})">Apply</button>
    </div>
    <div class="dca-result" id="dcaRes-${p.id}">
      <div class="dca-res-grid">
        <div><div class="drr-k">New avg entry</div><div class="drr-v" id="dcaAvg-${p.id}">—</div></div>
        <div><div class="drr-k">New quantity</div><div class="drr-v" id="dcaQty-${p.id}">—</div></div>
        <div><div class="drr-k">New total cost</div><div class="drr-v" id="dcaCost-${p.id}">—</div></div>
      </div>
    </div>
  </div>`;
}

function openBody(p) {
  return `<div class="pos-btns">
      <button class="pbtn pbtn-dca" onclick="event.stopPropagation();toggleDca(${p.id})">+ DCA</button>
      <button class="pbtn" onclick="event.stopPropagation();toggleEdit(${p.id})" style="background:var(--edit-bg);border-color:var(--edit-br);color:var(--green)">✎ Edit</button>
      <button class="pbtn" onclick="event.stopPropagation();updatePrice(${p.id})">Update price</button>
      <button class="pbtn pbtn-close" onclick="event.stopPropagation();toggleClose(${p.id})">Close</button>
      <button class="pbtn" style="border-color:var(--danger-br);color:var(--text3)" onclick="event.stopPropagation();del(${p.id})">Delete</button>
    </div>
    ${closePanel(p)}
    <div class="dca-panel" id="edit-${p.id}" style="display:none;border-color:var(--edit-br)">
      <div class="dca-head" style="color:var(--green)">Edit position</div>
      ${editFields(p, { includeExit: false })}
    </div>
    ${dcaPanel(p)}`;
}

function closedBody(p, retPct) {
  return `<div style="font-size:11px;color:var(--text3);margin-bottom:10px">Opened ${escapeHtml(p.open)} · Closed ${escapeHtml(p.close)} · Realised ${$u(realized(p))} · ${fp(retPct)}</div>
    ${reasonBlock(p)}
    ${exitsBlock(p)}
    <div class="pos-btns">
      <button class="pbtn" onclick="event.stopPropagation();toggleEdit(${p.id})" style="background:var(--edit-bg);border-color:var(--edit-br);color:var(--green)">✎ Edit</button>
      <button class="pbtn" onclick="event.stopPropagation();reopen(${p.id})">Reopen</button>
      <button class="pbtn" style="border-color:var(--danger-br);color:var(--text3)" onclick="event.stopPropagation();del(${p.id})">Delete completely</button>
    </div>
    <div class="dca-panel" id="edit-${p.id}" style="display:none;border-color:var(--edit-br);margin-top:10px">
      <div class="dca-head" style="color:var(--green)">Edit closed trade</div>
      ${editFields(p, { includeExit: true })}
    </div>`;
}

/** Small amber badge showing partial-close progress or exit count. */
function progressBadge(p) {
  const badge = (text) => ` <span class="badge" style="background:var(--amber-bg);color:var(--amber);font-size:9px">${text}</span>`;
  if (p.exits && p.exits.length && p.status === 'Open') {
    return badge(`${(100 - (p.qty / baseQtyOf(p)) * 100).toFixed(0)}% closed`);
  }
  if (p.exits && p.exits.length > 1 && p.status === 'Closed') {
    return badge(`${p.exits.length} exits`);
  }
  return '';
}

export function positionCard(p, isOpen) {
  const pnl = isOpen ? unreal(p) : realized(p);
  const retPct = pctD(pnl, costOf(p));
  const expanded = ui.expandedId === p.id;
  const live = priceIsLive(p);
  const priceColor = live ? 'var(--green)' : 'var(--text3)';
  const liveMark = live ? '▲ live' : (isOpen ? 'manual' : 'closed');

  const body = expanded
    ? `<div class="pos-body"><div class="detail-rows">
        ${detailGrid(p, pnl)}
        ${isOpen ? reasonBlock(p) + exitsBlock(p) + openBody(p) : closedBody(p, retPct)}
      </div></div>`
    : '';

  return `<div class="pos-card ${expanded ? 'expanded' : ''}">
    <div class="pos-head" onclick="toggleExpand(${p.id})">
      <div class="pos-left">
        <span class="chevron">▶</span>
        <span class="pos-ticker">${escapeHtml(p.ticker)}</span>${progressBadge(p)}
        <span class="pos-dir d-${p.dir.toLowerCase()}">${p.dir}</span>
        ${p.summary
    // A trade recorded from a statement has no share price, and the figure
    // stored in its place is the whole stake. Printing that where a price goes
    // would read as one.
    ? `<span class="pos-liveprice" style="color:var(--text3)">${$u(costOf(p))} in</span>`
    : `<span class="pos-liveprice" style="color:${priceColor}">$${fmtPrice(p.cur)} <span style="font-size:10px">${liveMark}</span></span>`}
      </div>
      <div><div class="pos-pnl" style="color:${clr(pnl)}">${$s(pnl)}</div><div class="pos-pct" style="color:${clr(retPct)}">${fp(retPct)}</div></div>
    </div>${body}
  </div>`;
}
