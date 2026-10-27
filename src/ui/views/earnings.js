/**
 * Earnings and revenue on the News page, beside the Fed's next decision
 * (October 2026).
 *
 * Only the companies chosen with the Companies button — every company on
 * Nasdaq, the NYSE and NYSE American, alphabetical — and for each only this:
 * the revenue and EPS forecast for the coming quarter, and once it reports,
 * the actual figures beside the forecast for seven days, after which the next
 * quarter's forecast takes its place. A report appears within minutes of its
 * release: the panel asks again every two minutes while it is on screen.
 * Data: api/_lib/earnings.js.
 */
import { state, setEarningsWatch, EARNINGS_WATCH_MAX } from '../../core/store.js';
import { earningsFor, companyList, earningsProblem } from '../../services/earnings.js';
import { cloudEnabled } from '../../services/cloud.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);
const DAY = 86400000;
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
  // Three significant figures: SoFi's $1.264B forecast read "$1.3B" at one decimal.
  const figure = `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${unit}`;
  const s = SYMBOL[currency];
  return `${n < 0 ? '−' : ''}${s ? `${s}${figure}` : `${figure} ${currency}`}`;
}

function perShare(n, currency = 'USD') {
  if (n == null) return '—';
  const s = SYMBOL[currency];
  // A forecast under a dollar keeps its third decimal (SoFi's $0.1675 is $0.168,
  // not $0.17); a reported figure is in whole cents and stays as reported.
  const cents = Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
  const figure = Math.abs(n).toFixed(Math.abs(n) < 1 && !cents ? 3 : 2);
  return `${n < 0 ? '−' : ''}${s ? `${s}${figure}` : `${figure} ${currency}`}`;
}

const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
// "Wed 28 Oct 2026", built by hand: browsers disagree on the comma after the weekday.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDay = (d) => {
  const t = new Date(`${d}T12:00:00Z`);
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** How long a report's actual figures stay beside its forecast (Romy, October 2026). */
const SHOWN_DAYS = 7;

/**
 * What a company shows: for seven days after it reports, the quarter's
 * forecast beside its actual figures; otherwise the coming quarter's
 * forecast, and nothing else. `forecasts` are the ones kept before the report
 * (store.rememberForecasts), since Yahoo drops a quarter's revenue forecast the
 * moment it reports. Exported for the tests.
 */
export function companyView(c, today, forecasts = {}) {
  const last = c.last;
  const age = last?.reported ? daysBetween(last.reported, today) : null;
  if (age != null && age >= 0 && age <= SHOWN_DAYS) {
    const kept = forecasts[`${c.symbol}|${last.periodEnd}`];
    return {
      reported: true,
      date: last.reported,
      quarter: last.quarter,
      revenue: { forecast: kept?.rev ?? null, actual: last.revenue },
      // Yahoo's own consensus at the report, which is what a beat is measured against.
      eps: { forecast: last.epsEst ?? kept?.eps ?? null, actual: last.eps },
    };
  }
  const n = c.next;
  return {
    reported: false,
    date: n?.date ?? null,
    session: n?.session ?? null,
    estimated: Boolean(n?.estimated),
    revenue: { forecast: n?.revenueEst ?? null, actual: null },
    eps: { forecast: n?.epsEst ?? null, actual: null },
  };
}

/**
 * The order the companies are listed in: a report from the last week first,
 * newest on top; then the ones reporting next, soonest first, and those with
 * no day yet last.
 */
export function orderCompanies(companies, today, forecasts = {}) {
  const key = (c) => {
    const v = companyView(c, today, forecasts);
    return v.reported ? `0${9999 - daysBetween('2000-01-01', v.date)}` : v.date ? `1${v.date}` : '2';
  };
  return [...companies].sort((a, b) => key(a).localeCompare(key(b)) || a.symbol.localeCompare(b.symbol));
}

/** One company: forecast, and the actual figures beside it once out. Exported for the tests. */
export function companyHtml(c, today, forecasts = {}) {
  const cur = c.currency ?? 'USD';
  const v = companyView(c, today, forecasts);
  const when = v.reported
    ? `<span class="earn-new">Released</span><span class="earn-when">${escapeHtml(dayLabel(v.date))} · ${escapeHtml(v.quarter ?? '')}</span>`
    : '';
  const head = `<div class="earn-head">
      <span class="earn-sym">${escapeHtml(c.symbol)}</span>
      <span class="earn-name">${escapeHtml(c.name ?? '')}</span>
      ${c.missing ? '' : when}
    </div>`;
  if (c.missing) return `<div class="earn-row">${head}<div class="earn-line earn-muted">No earnings found for this ticker.</div></div>`;

  const row = (label, { forecast, actual }, fmt) => {
    const beat = actual != null && forecast ? ((actual - forecast) / Math.abs(forecast)) * 100 : null;
    return `<span class="earn-k">${label}</span>
      <span class="earn-fc">${fmt(forecast, cur)}</span>
      <span class="earn-act">${actual == null
        // Released, and this figure not yet with Yahoo: SoFi's revenue came hours before its EPS.
        ? `<span class="earn-muted">${v.reported ? 'not out yet' : '—'}</span>`
        : `<b>${fmt(actual, cur)}</b>${beat != null ? ` <span class="${tone(beat)}">${pctText(beat)}</span>` : ''}`}</span>`;
  };
  return `<div class="earn-row${v.reported ? ' is-new' : ''}">${head}
    <div class="earn-grid">
      <span></span><span class="earn-col" title="The analysts' average (consensus), from Yahoo Finance. Other sites average other analysts, so their figure can differ a little.">Forecast</span><span class="earn-col">Actual</span>
      ${row('Revenue', v.revenue, money)}
      ${row('EPS', v.eps, perShare)}
    </div>${nextReportHtml(c.next)}</div>`;
}

/**
 * The day of the next report, under the figures, released or not (Romy,
 * October 2026). Marked as expected while the company has not confirmed it.
 */
function nextReportHtml(n) {
  const day = n?.date
    ? `<b>${escapeHtml(longDay(n.date))}</b>${n.session ? ` · ${escapeHtml(n.session)}` : ''}${n.estimated ? ' <span class="earn-muted">(expected, not confirmed)</span>' : ''}`
    : '<span class="earn-muted">not announced yet</span>';
  return `<div class="earn-date"><span class="earn-k">Next report</span> ${day}</div>`;
}

/** The companies a search finds, by ticker or name, in the list's alphabetical order. */
export function matching(list, query = '') {
  const q = query.trim().toLowerCase();
  return q ? list.filter((c) => c.s.toLowerCase().startsWith(q) || c.n.toLowerCase().includes(q)) : list;
}

/** Rows of the picker, for companies already filtered. Exported for the tests. */
export function optionRows(companies, chosen) {
  const picked = new Set(chosen);
  return companies.map((c) => `<label class="earn-opt${picked.has(c.s) ? ' is-picked' : ''}"><input type="checkbox" data-s="${escapeHtml(c.s)}"${picked.has(c.s) ? ' checked' : ''}>
      <span class="earn-opt-name">${escapeHtml(c.n)}${c.c ? ` <span class="earn-muted">· Class ${escapeHtml(c.c)}</span>` : ''}</span>
      <span class="earn-opt-sym">${escapeHtml(c.s)}${c.x ? ` <span class="earn-opt-x">${escapeHtml(c.x)}</span>` : ''}</span></label>`).join('');
}

/** The picker's list, alphabetical as the server sends it, filtered by a search. Exported for the tests. */
export function optionsHtml(list, chosen, query = '') {
  const shown = chosenFirst(matching(list, query), chosen);
  if (!shown.length) return '<div class="earn-muted earn-none">No company matches.</div>';
  const n = shown.filter((c) => chosen.includes(c.s)).length;
  return optionRows(shown.slice(0, n), chosen) + (n && n < shown.length ? DIVIDER : '') + optionRows(shown.slice(n), chosen);
}

/**
 * The companies ticked first, then the rest, each part alphabetical (Romy,
 * October 2026): a company ticked rises to the top, and unticked it goes back
 * to its place. Exported for the tests.
 */
export function chosenFirst(companies, chosen) {
  const picked = new Set(chosen);
  return [...companies.filter((c) => picked.has(c.s)), ...companies.filter((c) => !picked.has(c.s))];
}

const DIVIDER = '<div class="earn-sep">All companies</div>';

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
  if (!companies) { host.innerHTML = unavailable('Earnings are unavailable right now'); return; }
  // Only the companies still chosen: one could have been unticked while this loaded.
  const now = state.earningsWatch ?? [];
  const today = todayIso();
  const kept = state.earningsForecasts ?? {};
  host.innerHTML = orderCompanies(companies.filter((c) => now.includes(c.symbol)), today, kept)
    .map((c) => companyHtml(c, today, kept)).join('');
}

/** A failure, with the reason the server gave, so it can be acted on rather than guessed at. */
function unavailable(what) {
  const why = earningsProblem();
  return `<div class="earn-muted earn-none">${escapeHtml(what)}${why ? ` — ${escapeHtml(why)}` : ''}.</div>`;
}

/* ───────────────────────── the picker ───────────────────────── */

let list = null;

async function openPicker() {
  const picker = el('earnPicker');
  picker.hidden = false;
  el('earnPickBtn').setAttribute('aria-expanded', 'true');
  el('earnSearch').focus();
  if (!list) {
    el('earnOptions').innerHTML = '<div class="earn-muted earn-none">Loading the companies…</div>';
    list = await companyList();
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

/**
 * The picker draws a page of companies at a time and the next as it is
 * scrolled to. All 5,893 at once was some 30,000 elements, and with the
 * picker open the whole app slowed until the mouse lagged (October 2026).
 */
const PAGE = 150;
let found = [];
let drawn = 0;
/** How many of `found` are ticked, and so sit above the divider. */
let pickedCount = 0;

/**
 * Draw the list afresh. `keep` holds the scroll where it was and redraws as
 * far down as had been drawn, so ticking a company deep in the list moves it
 * to the top without throwing the list back to the start.
 */
function drawOptions(keep = false) {
  const chosen = state.earningsWatch ?? [];
  el('earnPickedNote').textContent = `${chosen.length} chosen${chosen.length >= EARNINGS_WATCH_MAX ? ` — ${EARNINGS_WATCH_MAX} at most` : ''}`;
  const host = el('earnOptions');
  if (!list) { host.innerHTML = unavailable('The list of companies is unavailable right now'); return; }
  const scroll = keep ? host.scrollTop : 0;
  const upTo = keep ? drawn : 0;
  found = chosenFirst(matching(list, el('earnSearch').value), chosen);
  pickedCount = found.filter((c) => chosen.includes(c.s)).length;
  drawn = 0;
  host.innerHTML = found.length ? '' : '<div class="earn-muted earn-none">No company matches.</div>';
  do drawMore(); while (drawn < upTo && drawn < found.length);
  host.scrollTop = scroll;
}

/** The next page, when the end of what is drawn comes into view. */
function drawMore() {
  if (drawn >= found.length) return;
  const host = el('earnOptions');
  host.querySelector('.earn-more')?.remove();
  const chosen = state.earningsWatch ?? [];
  const end = Math.min(drawn + PAGE, found.length);
  // The divider between the ticked companies and the rest, where this page crosses it.
  const split = pickedCount && pickedCount < found.length && drawn <= pickedCount && pickedCount < end ? pickedCount : null;
  host.insertAdjacentHTML('beforeend', split == null
    ? optionRows(found.slice(drawn, end), chosen)
    : optionRows(found.slice(drawn, split), chosen) + DIVIDER + optionRows(found.slice(split, end), chosen));
  drawn = end;
  if (drawn < found.length) {
    host.insertAdjacentHTML('beforeend', `<div class="earn-more earn-muted">${drawn.toLocaleString('en-US')} of ${found.length.toLocaleString('en-US')} — scroll for more, or search</div>`);
  }
}

let searchTimer = 0;

function bind() {
  const pane = el('earnPane');
  if (pane.dataset.bound === '1') return;
  pane.dataset.bound = '1';
  el('earnPickBtn').addEventListener('click', () => (el('earnPicker').hidden ? openPicker() : closePicker()));
  // Drawn once typing pauses, not on every key.
  el('earnSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => drawOptions(), 120); });
  el('earnOptions').addEventListener('scroll', (e) => {
    const box = e.currentTarget;
    if (box.scrollTop + box.clientHeight > box.scrollHeight - 400) drawMore();
  }, { passive: true });
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
    // Ticked to the top, unticked back to its place.
    drawOptions(true);
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
