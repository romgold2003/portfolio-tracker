/** The New-trade form: direction toggle, ticker lookup feedback, reading and resetting. */
import { ui } from '../uiState.js';
import { fmtPrice } from '../format.js';
import { todayStr } from '../../core/portfolio.js';
import { SECTOR_NAMES } from '../../config/sectors.js';

const field = (id) => document.getElementById(id);

export function setDirection(direction) {
  ui.formDirection = direction;
  const long = field('dirLong');
  const short = field('dirShort');
  if (long) long.className = 'dir-opt' + (direction === 'Long' ? ' long-on' : '');
  if (short) short.className = 'dir-opt' + (direction === 'Short' ? ' short-on' : '');
}

/** Everything the form currently holds, unvalidated. */
export function readTradeForm() {
  const alreadyClosed = !!field('f-closed')?.checked;
  return {
    ticker: field('f-ticker').value,
    cls: field('f-class').value,
    dir: ui.formDirection,
    open: field('f-date').value,
    entry: parseFloat(field('f-entry').value),
    amount: parseFloat(field('f-amount').value),
    reason: field('f-reason').value.trim(),
    // Empty means "work it out from the ticker".
    sector: field('f-sector')?.value || null,
    alreadyClosed,
    close: alreadyClosed ? field('f-close')?.value || '' : '',
    pnl: alreadyClosed ? parseFloat(field('f-pnl')?.value) : NaN,
    pct: alreadyClosed ? parseFloat(field('f-pct')?.value) : NaN,
  };
}

/**
 * Show or hide the two fields a finished trade needs.
 *
 * They stay out of the way until the box is ticked, because the overwhelming
 * majority of entries are trades being opened now, and a form that asks
 * everyone for an exit price is a worse form.
 */
export function toggleClosedTrade() {
  const on = !!field('f-closed')?.checked;

  // A finished trade is described by what it made, not by prices nobody
  // remembers — so the price fields are swapped out rather than added to.
  ['f-closedDateWrap', 'f-pnlWrap', 'f-pctWrap', 'f-closedNote'].forEach((id) => {
    const el = field(id);
    if (el) el.style.display = on ? 'flex' : 'none';
  });
  ['f-entryWrap', 'f-amountWrap'].forEach((id) => {
    const el = field(id);
    if (el) el.style.display = on ? 'none' : 'flex';
  });

  // A sensible default beats an empty date picker: most people entering a
  // finished trade are working through a list and will change it anyway.
  const closeDate = field('f-close');
  if (on && closeDate && !closeDate.value) closeDate.value = todayStr();
}

export function clearTradeForm() {
  ['f-ticker', 'f-entry', 'f-amount', 'f-reason', 'f-pnl', 'f-pct'].forEach((id) => {
    const el = field(id);
    if (el) el.value = '';
  });
  setTickerStatus('', 'muted');
  field('f-date').value = todayStr();
  if (field('f-sector')) field('f-sector').value = '';
  // Deliberately left ticked if it was: someone entering a backlog of finished
  // trades is entering several, and re-ticking it every time would be tedious.
  const closeDate = field('f-close');
  if (closeDate) closeDate.value = '';
  toggleClosedTrade();
  setDirection('Long');
}

export function setTickerStatus(message, tone = 'muted') {
  const el = field('tickerStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `ticker-status ${tone}`;
}

/** Reflect a successful lookup: normalise the symbol and pre-fill the entry price. */
export function applyTickerLookup(ticker, price) {
  setTickerStatus(`● Live price found: $${fmtPrice(price)} (${ticker})`, 'green');
  field('f-ticker').value = ticker;
  const entry = field('f-entry');
  if (entry) entry.value = entry.value || price;
}

/**
 * Fill the sector dropdown once.
 *
 * It defaults to Auto, which lets the ticker lookup decide — right for anything
 * well known. The list is there for symbols the lookup has never heard of, and
 * for disagreeing with it.
 */
function fillSectorOptions() {
  const select = field('f-sector');
  if (!select || select.options.length > 1) return;
  select.insertAdjacentHTML(
    'beforeend',
    SECTOR_NAMES.map((s) => `<option value="${s}">${s}</option>`).join(''),
  );
}

/** Set today's date and the greeting that depends on the time of day. */
export function initFormDefaults() {
  fillSectorOptions();
  const date = field('f-date');
  if (date) date.value = todayStr();
  const hour = new Date().getHours();
  const greeting = field('greetTxt');
  if (greeting) {
    greeting.textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }
}
