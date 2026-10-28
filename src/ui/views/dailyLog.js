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
import { amountsHidden, MASK, pricedThrough, breakDownDay } from './home.js';

let open = false;
let year = null;
/** The day taken apart, or null for the list of days. */
let detail = null;
/** Where the list of days was scrolled to, for coming back to it. */
let listScroll = 0;

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
  return `<div class="dl-day ${tone(d.pnl)}" data-day="${escapeHtml(d.date)}" role="button" tabindex="0"${flow}>
    <span class="dl-date">${escapeHtml(dayLabel(d.date))}${d.flow ? '<span class="dl-flow">⇅</span>' : ''}</span>
    <span class="dl-bar"><span style="width:${width}%"></span></span>
    <span class="dl-pct">${pct(d.pct)}</span>
    <span class="dl-usd">${escapeHtml(usd(d.pnl))}</span>
    <span class="dl-go" aria-hidden="true">›</span>
  </div>`;
}

/** "Wednesday 14 October 2026" */
function longDay(date) {
  // By hand: engines disagree on the comma after the weekday.
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${weekday} ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/**
 * One day, holding by holding, best first. `breakdown` is what
 * core/dayBreakdown.js returns, or null when there is no statement to walk.
 * Exported for the tests.
 */
/**
 * The percentage a holding shows: the stock's own move, close to close.
 *
 * Romy (October 2026): "if a stock goes up 4%, we both should see 4%". It
 * showed the position's return instead, which a trade that day, a short or
 * shares added make differ from one account to the next. The stock's move is
 * the same for everyone; the dollars beside it stay this account's. Without
 * a close for the day before (a listing that day), the position's return.
 */
const shownPct = (h) => h.move ?? h.pct;

/** The position's own return under the stock's move, when they differ, and why. */
function positionNote(h) {
  if (h.move == null || Math.abs(h.move - h.pct) < 0.05) return '';
  const why = h.traded ? 'you traded it that day' : h.short ? 'short: you gain when it falls' : 'shares moved in or out that day';
  return `<span class="dl-note">Your position ${pct(h.pct)} · ${escapeHtml(why)}</span>`;
}

export function dayDetailHtml(d, breakdown) {
  const head = `<div class="dl-head">
      <button class="dl-back" data-back aria-label="Back to every day">‹ All days</button>
      <button class="dl-close" data-close aria-label="Close">×</button>
    </div>
    <div class="dl-dhead">
      <div class="dl-ddate">${escapeHtml(longDay(d.date))}</div>
      <div class="dl-dtot ${tone(d.pnl)}"><b>${pct(d.pct)}</b><span>${escapeHtml(usd(d.pnl))}</span></div>
      <div class="dl-dsub">from the close of ${escapeHtml(dayLabel(d.prev ?? d.date))}${
  breakdown ? ` · ${breakdown.holdings.length} holding${breakdown.holdings.length === 1 ? '' : 's'}` : ''}</div>
    </div>`;
  if (!breakdown) {
    return `${head}<div class="dl-empty">Holding by holding needs an imported statement to walk from.</div>`;
  }
  // Best to worst by the stock's move, as the list reads.
  const ordered = [...breakdown.holdings].sort((a, b) => shownPct(b) - shownPct(a) || b.pnl - a.pnl);
  const scale = Math.max(...ordered.map((h) => Math.abs(shownPct(h))), 0.01);
  const rows = ordered.map((h, i) => {
    const width = Math.max(2, Math.round((Math.abs(shownPct(h)) / scale) * 100));
    // The row in the stock's colour; the dollars in their own, which a short turns over.
    return `<div class="dl-day dl-hold ${tone(shownPct(h))}" style="animation-delay:${Math.min(i, 20) * 18}ms">
      <span class="dl-tick">${escapeHtml(h.ticker)}</span>
      <span class="dl-bar"><span style="width:${width}%"></span></span>
      <span class="dl-pct">${pct(shownPct(h))}</span>
      <span class="dl-usd" style="color:var(--${h.pnl < 0 ? 'red' : h.pnl > 0 ? 'green' : 'text3'})">${escapeHtml(usd(h.pnl))}</span>${positionNote(h)}
    </div>`;
  }).join('');
  const rest = Number.isFinite(breakdown.rest) && Math.abs(breakdown.rest) >= 0.5
    ? `<div class="dl-rest"><span>Cash, interest, dividends and fees</span><span class="${tone(breakdown.rest)}">${escapeHtml(usd(breakdown.rest))}</span></div>`
    : '';
  return `${head}<div class="dl-list dl-detail">${rows || '<div class="dl-empty">Nothing was held that day.</div>'}</div>${rest}`;
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

/**
 * The days so far: every one whose session has closed and that every holding
 * has a close for. Yahoo fills a close in hours after the bell; a day shown
 * before then is priced at the day before for part of the book, and showed
 * 14 October's fall on the 15th.
 */
function closedDays() {
  const closed = lastClosedSession();
  const priced = pricedThrough();
  return dailyReturns(accountHistory(), { through: priced && priced < closed ? priced : closed });
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
  const day = detail && days.find((d) => d.date === detail);
  box.innerHTML = day
    ? dayDetailHtml(day, breakDownDay(day.prev, day.date, day.pnl))
    : dailyLogHtml(days, year);
  const fresh = box.querySelector('.dl-list');
  if (fresh) fresh.scrollTop = scrolled;
}

/** Into one day, or back out to the list where it was left. */
function showDay(date) {
  const box = el('dailyLog');
  if (date) listScroll = box?.querySelector('.dl-list')?.scrollTop ?? 0;
  detail = date;
  if (box) box.querySelector('.dl-list')?.scrollTo?.(0, 0);
  if (box) box.innerHTML = '';
  renderDailyLog();
  if (!date) {
    const list = el('dailyLog')?.querySelector('.dl-list');
    if (list) list.scrollTop = listScroll;
  }
}

function onClick(e) {
  const day = e.target.closest?.('[data-day]');
  if (day) { showDay(day.dataset.day); return; }
  if (e.target.closest?.('[data-back]')) { showDay(null); return; }
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
  if (!open) return;
  if (e.key === 'Escape') {
    // Out of a day first, then out of the window.
    if (detail) showDay(null); else toggleDailyLog(false);
    return;
  }
  const day = e.key === 'Enter' && e.target.closest?.('#dailyLog [data-day]');
  if (day) showDay(day.dataset.day);
}

let wired = false;
export function toggleDailyLog(force) {
  open = typeof force === 'boolean' ? force : !open;
  if (!open) detail = null;
  if (!wired) {
    wired = true;
    el('dailyLog')?.addEventListener('click', onClick);
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKey);
  }
  renderDailyLog();
}
