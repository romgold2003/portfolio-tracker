/**
 * The daily log: a small window under the timeframe buttons listing every
 * trading day's return, by year, newest first.
 *
 * Asked for in October 2026 — "choose a year and just scroll through all the
 * days". It is redrawn with the home page, so when the session closes the day
 * appears in it without anything being done. Money follows the eye button:
 * hidden there, hidden here; the percentages stay, as they do everywhere.
 */
import { accountHistory } from '../../core/snapshots.js';
import { dailyReturns, yearsOf, yearView } from '../../core/dailyLog.js';
import { lastClosedSession } from '../../config/marketCalendar.js';
import { escapeHtml } from '../format.js';
import { amountsHidden, MASK } from './home.js';

let open = false;
let year = null;

const el = (id) => document.getElementById(id);

const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
const usd = (n) => (amountsHidden() ? MASK
  : `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const tone = (n) => (n > 0 ? 'is-up' : n < 0 ? 'is-down' : '');

/** "Thu 15 Oct" */
function dayLabel(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${month}`;
}

function dayRow(d, scale) {
  const width = Math.max(2, Math.round((Math.abs(d.pct) / scale) * 100));
  const flow = d.flow ? ` title="Money in or out that day: ${escapeHtml(usd(d.flow))}, not counted as return"` : '';
  return `<div class="dl-day ${tone(d.pnl)}"${flow}>
    <span class="dl-date">${escapeHtml(dayLabel(d.date))}${d.flow ? '<span class="dl-flow">⇅</span>' : ''}</span>
    <span class="dl-bar"><span style="width:${width}%"></span></span>
    <span class="dl-pct">${pct(d.pct)}</span>
    <span class="dl-usd">${escapeHtml(usd(d.pnl))}</span>
  </div>`;
}

/** The window's contents for the year on show. Exported for the tests. */
export function dailyLogHtml(days, chosen) {
  const years = yearsOf(days);
  if (!years.length) {
    return '<div class="dl-empty">No closed trading days yet. Each one appears here when the market closes.</div>';
  }
  const y = years.includes(chosen) ? chosen : years[0];
  const v = yearView(days, y);
  const picker = years.map((n) => `<button class="dl-year${n === y ? ' active' : ''}" data-year="${n}">${n}</button>`).join('');
  const best = v.best ? `${escapeHtml(dayLabel(v.best.date))} <b class="is-up">${pct(v.best.pct)}</b>` : '—';
  const worst = v.worst ? `${escapeHtml(dayLabel(v.worst.date))} <b class="is-down">${pct(v.worst.pct)}</b>` : '—';
  return `<div class="dl-head">
      <div class="dl-title">Daily returns</div>
      <button class="dl-close" data-close aria-label="Close">×</button>
    </div>
    <div class="dl-years">${picker}</div>
    <div class="dl-sum">
      <div><span class="dl-k">${y}</span><b class="${tone(v.pnl)}">${pct(v.pct)}</b><span class="dl-sub ${tone(v.pnl)}">${escapeHtml(usd(v.pnl))}</span></div>
      <div><span class="dl-k">Days</span><b><span class="is-up">${v.up}▲</span> <span class="is-down">${v.down}▼</span></b></div>
      <div><span class="dl-k">Best</span><span class="dl-sub">${best}</span></div>
      <div><span class="dl-k">Worst</span><span class="dl-sub">${worst}</span></div>
    </div>
    <div class="dl-list">${v.months.map((m) => `<div class="dl-month">
        <div class="dl-mhead"><span>${escapeHtml(m.label)}</span>
          <span class="${tone(m.pnl)}">${pct(m.pct)} · ${escapeHtml(usd(m.pnl))}</span></div>
        ${m.days.map((d) => dayRow(d, v.scale)).join('')}
      </div>`).join('')}</div>`;
}

/** The days so far, every one whose session has closed. */
function closedDays() {
  return dailyReturns(accountHistory(), { through: lastClosedSession() });
}

export function renderDailyLog() {
  const box = el('dailyLog');
  const button = el('dailyLogBtn');
  if (button) button.setAttribute('aria-expanded', String(open));
  if (!box) return;
  box.hidden = !open;
  if (!open) return;
  // Keep the reader's place when a refresh redraws it.
  const list = box.querySelector('.dl-list');
  const scrolled = list?.scrollTop ?? 0;
  const days = closedDays();
  if (year == null) year = yearsOf(days)[0] ?? null;
  box.innerHTML = dailyLogHtml(days, year);
  const fresh = box.querySelector('.dl-list');
  if (fresh) fresh.scrollTop = scrolled;
}

function onClick(e) {
  const pick = e.target.closest?.('[data-year]');
  if (pick) {
    year = Number(pick.dataset.year);
    const list = el('dailyLog')?.querySelector('.dl-list');
    if (list) list.scrollTop = 0;
    open = true;
    el('dailyLog').innerHTML = dailyLogHtml(closedDays(), year);
    return;
  }
  if (e.target.closest?.('[data-close]')) toggleDailyLog(false);
}

function onOutside(e) {
  if (!open) return;
  if (e.target.closest?.('#dailyLog, #dailyLogBtn')) return;
  toggleDailyLog(false);
}

function onKey(e) {
  if (open && e.key === 'Escape') toggleDailyLog(false);
}

let wired = false;
export function toggleDailyLog(force) {
  open = typeof force === 'boolean' ? force : !open;
  if (!wired) {
    wired = true;
    el('dailyLog')?.addEventListener('click', onClick);
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKey);
  }
  renderDailyLog();
}
