/**
 * Earnings and revenue on the News page, beside the Fed's next decision
 * (October 2026).
 *
 * Only the companies chosen with the Companies button — every company listed
 * on Nasdaq, alphabetical — and for each: what it last reported, EPS against
 * the estimate and revenue against a year earlier (and against the estimate
 * when this device saw it coming), and when it reports next. A report appears
 * here within minutes of its release: the panel asks again every two minutes
 * while it is on screen. Data: api/_lib/earnings.js.
 */
import { state, setEarningsWatch, EARNINGS_WATCH_MAX } from '../../core/store.js';
import { earningsFor, nasdaqList, estimateFor } from '../../services/earnings.js';
import { cloudEnabled } from '../../services/cloud.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);
const DAY = 86400000;
/** A report this recent is marked new. */
const NEW_DAYS = 2;
const REFRESH_MS = 2 * 60 * 1000;

const SYMBOL = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹' };
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
const tone = (n) => (n > 0 ? 'is-up' : n < 0 ? 'is-down' : '');
const pctText = (n) => (n == null ? '' : `${sign(n)}${Math.abs(n).toFixed(1)}%`);

/** $90.0B, €11.7B, 412.3M CHF. */
export function money(n, currency = 'USD') {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const [v, unit] = abs >= 1e12 ? [abs / 1e12, 'T'] : abs >= 1e9 ? [abs / 1e9, 'B'] : abs >= 1e6 ? [abs / 1e6, 'M'] : [abs / 1e3, 'K'];
  const figure = `${v.toFixed(v >= 100 ? 0 : 1)}${unit}`;
  const s = SYMBOL[currency];
  return `${n < 0 ? '−' : ''}${s ? `${s}${figure}` : `${figure} ${currency}`}`;
}

function perShare(n, currency = 'USD') {
  if (n == null) return '—';
  const s = SYMBOL[currency];
  const figure = Math.abs(n).toFixed(2);
  return `${n < 0 ? '−' : ''}${s ? `${s}${figure}` : `${figure} ${currency}`}`;
}

const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * The order the companies are listed in: a report from the last week first,
 * newest on top; then the ones reporting next, soonest first; then the rest by
 * when they last reported.
 */
export function orderCompanies(companies, today) {
  const recent = (c) => c.last?.reported && daysBetween(c.last.reported, today) <= 7;
  const rank = (c) => (recent(c) ? 0 : c.next ? 1 : 2);
  return [...companies].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 1 ? a.next.date.localeCompare(b.next.date) : (b.last?.reported ?? '').localeCompare(a.last?.reported ?? ''))
    || a.symbol.localeCompare(b.symbol));
}

/** One company. `est` is what the quarter was expected to bring, if remembered. Exported for the tests. */
export function companyHtml(c, today, est = null) {
  const cur = c.currency ?? 'USD';
  const last = c.last;
  const isNew = last?.reported && daysBetween(last.reported, today) <= NEW_DAYS;
  const head = `<div class="earn-head">
      <span class="earn-sym">${escapeHtml(c.symbol)}</span>
      <span class="earn-name">${escapeHtml(c.name ?? '')}</span>
      ${isNew ? '<span class="earn-new">New</span>' : ''}
      ${last ? `<span class="earn-when">${escapeHtml(last.quarter)} · ${escapeHtml(dayLabel(last.reported))}</span>` : ''}
    </div>`;

  if (c.missing) return `<div class="earn-row">${head}<div class="earn-line earn-muted">No earnings found for this ticker.</div></div>`;

  let figures = '';
  if (last) {
    const epsLine = `<span class="earn-k">EPS</span> <b>${perShare(last.eps, cur)}</b>`
      + (last.epsEst != null ? ` <span class="earn-muted">vs ${perShare(last.epsEst, cur)} est</span>` : '')
      + (last.epsSurprise != null ? ` <span class="${tone(last.epsSurprise)}">${pctText(last.epsSurprise)}</span>` : '');
    const vsEst = est?.rev && last.revenue != null ? ((last.revenue - est.rev) / est.rev) * 100 : null;
    const revLine = `<span class="earn-k">Revenue</span> <b>${money(last.revenue, cur)}</b>`
      + (last.revenueYoY != null ? ` <span class="${tone(last.revenueYoY)}">${pctText(last.revenueYoY)} y/y</span>` : '')
      + (vsEst != null ? ` <span class="earn-muted">vs ${money(est.rev, cur)} est</span> <span class="${tone(vsEst)}">${pctText(vsEst)}</span>` : '');
    figures = `<div class="earn-line">${epsLine}</div><div class="earn-line">${revLine}</div>`;
  }

  const n = c.next;
  const nextLine = n
    ? `<div class="earn-line earn-next"><span class="earn-k">Next</span> ${n.estimated ? '~' : ''}${escapeHtml(dayLabel(n.date))}${n.session ? ` ${escapeHtml(n.session)}` : ''}${
      n.epsEst != null ? ` · EPS est ${perShare(n.epsEst, cur)}` : ''}${n.revenueEst != null ? ` · Revenue est ${money(n.revenueEst, cur)}` : ''}</div>`
    : '';
  return `<div class="earn-row${isNew ? ' is-new' : ''}">${head}${figures}${nextLine}</div>`;
}

/** The picker's list, alphabetical as Nasdaq's directory comes, filtered by a search. Exported for the tests. */
export function optionsHtml(list, chosen, query = '') {
  const q = query.trim().toLowerCase();
  const picked = new Set(chosen);
  const shown = q
    ? list.filter((c) => c.s.toLowerCase().startsWith(q) || c.n.toLowerCase().includes(q))
    : list;
  if (!shown.length) return '<div class="earn-muted earn-none">No Nasdaq company matches.</div>';
  return shown.map((c) => `<label class="earn-opt"><input type="checkbox" data-s="${escapeHtml(c.s)}"${picked.has(c.s) ? ' checked' : ''}>
      <span class="earn-opt-name">${escapeHtml(c.n)}${c.c ? ` <span class="earn-muted">· Class ${escapeHtml(c.c)}</span>` : ''}</span>
      <span class="earn-opt-sym">${escapeHtml(c.s)}</span></label>`).join('');
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Draw the list for the companies chosen. */
export async function renderEarnings() {
  const pane = el('earnPane');
  if (!pane) return;
  pane.hidden = !cloudEnabled();
  if (pane.hidden) return;
  bind();
  const chosen = state.earningsWatch ?? [];
  el('earnCount').textContent = chosen.length ? `· ${chosen.length}` : '';
  const host = el('earnList');
  if (!chosen.length) {
    host.innerHTML = '<div class="earn-empty">Choose the companies to follow with <b>Companies</b>. Each report shows here as soon as it is out.</div>';
    return;
  }
  if (!host.children.length || host.querySelector('.earn-empty')) host.innerHTML = '<div class="earn-muted earn-none">Loading earnings…</div>';
  const companies = await earningsFor(chosen);
  if (!companies) { host.innerHTML = '<div class="earn-muted earn-none">Earnings are unavailable right now.</div>'; return; }
  // Only the companies still chosen: one could have been unticked while this loaded.
  const now = state.earningsWatch ?? [];
  const today = todayIso();
  host.innerHTML = orderCompanies(companies.filter((c) => now.includes(c.symbol)), today)
    .map((c) => companyHtml(c, today, estimateFor(c.symbol, c.last?.periodEnd))).join('');
}

/* ───────────────────────── the picker ───────────────────────── */

let list = null;

async function openPicker() {
  const picker = el('earnPicker');
  picker.hidden = false;
  el('earnPickBtn').setAttribute('aria-expanded', 'true');
  el('earnSearch').focus();
  if (!list) {
    el('earnOptions').innerHTML = '<div class="earn-muted earn-none">Loading Nasdaq companies…</div>';
    list = await nasdaqList();
  }
  drawOptions();
}

function closePicker() {
  const picker = el('earnPicker');
  if (picker.hidden) return;
  picker.hidden = true;
  el('earnPickBtn').setAttribute('aria-expanded', 'false');
  renderEarnings();
}

function drawOptions() {
  const chosen = state.earningsWatch ?? [];
  el('earnPickedNote').textContent = `${chosen.length} chosen${chosen.length >= EARNINGS_WATCH_MAX ? ` — ${EARNINGS_WATCH_MAX} at most` : ''}`;
  el('earnOptions').innerHTML = list
    ? optionsHtml(list, chosen, el('earnSearch').value)
    : '<div class="earn-muted earn-none">Nasdaq\'s list is unavailable right now.</div>';
}

function bind() {
  const pane = el('earnPane');
  if (pane.dataset.bound === '1') return;
  pane.dataset.bound = '1';
  el('earnPickBtn').addEventListener('click', () => (el('earnPicker').hidden ? openPicker() : closePicker()));
  el('earnSearch').addEventListener('input', drawOptions);
  el('earnClear').addEventListener('click', () => { setEarningsWatch([]); drawOptions(); });
  el('earnOptions').addEventListener('change', (e) => {
    const box = e.target.closest('input[data-s]');
    if (!box) return;
    const chosen = (state.earningsWatch ?? []).filter((s) => s !== box.dataset.s);
    if (box.checked) {
      if (chosen.length >= EARNINGS_WATCH_MAX) { box.checked = false; return; }
      chosen.push(box.dataset.s);
    }
    setEarningsWatch(chosen);
    el('earnPickedNote').textContent = `${chosen.length} chosen`;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
  document.addEventListener('click', (e) => {
    if (!el('earnPicker').hidden && !e.target.closest('#earnPicker, #earnPickBtn')) closePicker();
  });
}

let timer = null;

/** Asks again every two minutes while the panel is on screen, so a report shows as it lands. */
export function startEarningsRefresh() {
  clearInterval(timer);
  timer = setInterval(() => {
    const pane = el('earnPane');
    const onScreen = pane && pane.offsetParent !== null && document.visibilityState === 'visible';
    if (onScreen && el('earnPicker')?.hidden !== false) renderEarnings();
  }, REFRESH_MS);
}
