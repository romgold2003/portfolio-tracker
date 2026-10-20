/**
 * The Crypto page's Journal tab: a strategy's trades, entered by hand, read
 * like the Monthly page — the year in bars, a row per month with profit, win
 * rate and the average trade, and the trades of a chosen month.
 *
 * Reference only (October 2026): money outside the account, so nothing here
 * reaches the account's value. The arithmetic is core/cryptoJournal.js.
 */
import { state, setCryptoTrades } from '../../core/store.js';
import { cleanTrade, derive, overall, monthsOf, yearBars, yearsOf } from '../../core/cryptoJournal.js';
import { renderMonthlyChart } from '../charts.js';
import { escapeHtml } from '../format.js';
import { amountsHidden, MASK } from './home.js';

const el = (id) => document.getElementById(id);

let year = null;
let month = null;

const usd = (n) => (amountsHidden() ? MASK
  : `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const plain = (n) => (amountsHidden() ? MASK
  : `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const pct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`);
const tone = (n) => (n > 0 ? 'is-up' : n < 0 ? 'is-down' : '');
const price = (n) => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  : n >= 1 ? n.toFixed(2) : n.toPrecision(4));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthName = (key) => new Date(`${key}-02T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The four figures over everything entered. Exported for the tests. */
export function totalsHtml(trades) {
  const o = overall(trades);
  const tile = (label, value, cls = '') => `<div class="cj-tile"><div class="cj-k">${label}</div><div class="cj-v ${cls}">${value}</div></div>`;
  return tile('Total P&L', usd(o.pnl), tone(o.pnl))
    + tile('Trades', `${o.n}${o.n ? ` <span class="cj-sub">${o.wins}W · ${o.losses}L</span>` : ''}`)
    + tile('Win rate', o.winRate == null ? '—' : `${o.winRate.toFixed(0)}%`, o.winRate == null ? '' : o.winRate >= 50 ? 'is-up' : 'is-down')
    + tile('Avg trade', pct(o.avgPct), tone(o.avgPct ?? 0));
}

/** The table of months. Exported for the tests. */
export function monthsHtml(trades, open = null) {
  const months = monthsOf(trades);
  if (!months.length) return '<div class="empty">No trades yet. Add one with + Add trade.</div>';
  return `<table class="cj-table"><thead><tr><th>Month</th><th>P&L</th><th>Trades</th><th>Win rate</th>
      <th title="Equal-weight average of the month's trades: how the typical trade did">Avg trade %</th><th>Best</th><th>Worst</th></tr></thead>
    <tbody>${months.map((m) => `<tr class="cj-month${m.key === open ? ' active' : ''}" data-month="${m.key}">
      <td class="mo">${escapeHtml(monthName(m.key))}</td>
      <td class="${tone(m.pnl)}" style="font-weight:600">${usd(m.pnl)}</td>
      <td class="muted">${m.n} <span class="cj-sub">${m.wins}W · ${m.losses}L</span></td>
      <td class="${m.winRate >= 50 ? 'is-up' : 'is-down'}">${m.winRate.toFixed(0)}%</td>
      <td class="${tone(m.avgPct)}">${pct(m.avgPct)}</td>
      <td class="is-up">${pct(m.best?.pct)}</td>
      <td class="is-down">${pct(m.worst?.pct)}</td>
    </tr>`).join('')}</tbody></table>`;
}

/** One month's trades, newest first. Exported for the tests. */
export function tradesHtml(trades, key) {
  const m = monthsOf(trades).find((x) => x.key === key);
  if (!m) return '';
  return `<div class="cj-trades-head">${escapeHtml(monthName(key))} · ${m.n} trade${m.n === 1 ? '' : 's'}</div>
    <div class="cj-trade cj-trade-head"><div>Date</div><div>Coin</div><div>Side</div><div>Entry → exit</div><div>Size</div><div>%</div><div>P&L</div><div></div></div>
    ${m.trades.map((t) => `<div class="cj-trade ${tone(t.pnl)}"${t.note ? ` title="${escapeHtml(t.note)}"` : ''}>
      <div class="muted">${escapeHtml(t.d.slice(8))} ${escapeHtml(monthName(key).slice(0, 3))}</div>
      <div class="cj-coin">${escapeHtml(t.coin || '—')}${t.note ? ' <span class="cj-note">✎</span>' : ''}</div>
      <div><span class="badge ${t.dir === 'Long' ? 'b-long' : 'b-short'}">${t.dir}</span></div>
      <div class="muted">${escapeHtml(price(t.entry))} → ${escapeHtml(price(t.exit))}</div>
      <div class="muted">${t.size == null ? '—' : plain(t.size)}</div>
      <div class="cj-pct">${pct(t.pct)}</div>
      <div class="cj-pnl">${usd(t.pnl)}</div>
      <div><button class="cj-del" data-del="${escapeHtml(t.id)}" title="Delete this trade" aria-label="Delete this trade">×</button></div>
    </div>`).join('')}`;
}

/** What the form's figures come to, before saving. Exported for the tests. */
export function previewText(input) {
  const t = cleanTrade({ ...input, d: input.d || today() });
  if (!t) return 'Enter the P&L, the average entry and the average exit.';
  const x = derive(t);
  // A side chosen against what the figures say: fees outweighing a small move,
  // or a figure typed with the wrong sign.
  const odd = t.dir && x.pct !== 0 && t.pnl !== 0 && Math.sign(x.pct) !== Math.sign(t.pnl)
    ? ` · the P&L and the move disagree for a ${x.dir.toLowerCase()} — fees, or a sign?` : '';
  return `${x.dir} · ${pct(x.pct)}${x.size == null ? '' : ` · size at entry ≈ ${plain(x.size)}`}${odd}`;
}

function formValues() {
  const v = (id) => el(id)?.value ?? '';
  return { d: v('cjDate'), coin: v('cjCoin'), entry: v('cjEntry'), exit: v('cjExit'), pnl: v('cjPnl'), dir: v('cjSide'), note: v('cjNote') };
}

function save() {
  const t = cleanTrade(formValues());
  if (!t) { el('cjPreview').textContent = previewText(formValues()); return; }
  setCryptoTrades([...state.cryptoTrades, t]);
  year = Number(t.d.slice(0, 4));
  month = t.d.slice(0, 7);
  for (const id of ['cjEntry', 'cjExit', 'cjPnl', 'cjNote', 'cjSide']) if (el(id)) el(id).value = '';
  el('cjForm').hidden = true;
  renderCryptoJournal();
}

function bind() {
  const card = el('cjCard');
  if (!card || card.dataset.bound === '1') return;
  card.dataset.bound = '1';
  card.addEventListener('click', (e) => {
    if (e.target.closest('#cjAdd')) {
      const form = el('cjForm');
      form.hidden = !form.hidden;
      if (!form.hidden) {
        if (!el('cjDate').value) el('cjDate').value = today();
        el('cjPnl').focus();
      }
      return;
    }
    if (e.target.closest('#cjSave')) { save(); return; }
    if (e.target.closest('#cjCancel')) { el('cjForm').hidden = true; return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const t = state.cryptoTrades.find((x) => x.id === del.dataset.del);
      if (t && confirm(`Delete the ${t.coin || 'crypto'} trade of ${t.d} (${usd(t.pnl)})?`)) {
        setCryptoTrades(state.cryptoTrades.filter((x) => x.id !== t.id));
        renderCryptoJournal();
      }
      return;
    }
    const row = e.target.closest('[data-month]');
    if (row) { month = month === row.dataset.month ? null : row.dataset.month; renderCryptoJournal(); }
  });
  card.addEventListener('change', (e) => {
    if (e.target.id === 'cjSide') el('cjPreview').textContent = previewText(formValues());
  });
  card.addEventListener('input', (e) => {
    if (e.target.closest('#cjForm')) el('cjPreview').textContent = previewText(formValues());
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('#cjForm') && e.target.tagName === 'INPUT') save();
  });
  el('cjYear')?.addEventListener('change', (e) => { year = Number(e.target.value); renderCryptoJournal(); });
}

export function renderCryptoJournal() {
  if (!el('cjCard')) return;
  bind();
  const trades = state.cryptoTrades ?? [];
  el('cjTotals').innerHTML = totalsHtml(trades);

  const years = yearsOf(trades);
  const now = new Date().getFullYear();
  if (!years.includes(now)) years.unshift(now);
  if (year == null || !years.includes(year)) year = years[0];
  el('cjYear').innerHTML = years.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('');
  renderMonthlyChart(yearBars(trades, year), { canvasId: 'cjChart', slot: 'cryptoJournal' });

  el('cjMonths').innerHTML = monthsHtml(trades, month);
  el('cjTrades').innerHTML = month ? tradesHtml(trades, month) : '';
}
