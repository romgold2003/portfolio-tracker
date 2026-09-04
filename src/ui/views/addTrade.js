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

/* ── sizing the position ───────────────────────────────────────────────── */

/**
 * A position can be described either way round.
 *
 * "I put $1,000 in" and "I bought 3 shares" are the same trade said from
 * different ends, and which one someone remembers depends on how they bought
 * it — a fractional crypto buy is an amount, a stock order is usually a share
 * count. Only one is asked for; the other is arithmetic, and is shown under the
 * field so it can be checked before saving.
 */
const SIZE_MODES = {
  amount: { label: 'Amount invested ($)', placeholder: '1000' },
  qty: { label: 'Shares / units', placeholder: '10' },
};

export function setSizeMode(mode) {
  ui.formSizeMode = SIZE_MODES[mode] ? mode : 'amount';
  const def = SIZE_MODES[ui.formSizeMode];

  const label = field('f-sizeLabel');
  if (label) label.textContent = def.label;
  const input = field('f-amount');
  if (input) input.placeholder = def.placeholder;

  for (const button of field('f-sizeToggle')?.querySelectorAll('[data-size]') ?? []) {
    button.classList.toggle('active', button.dataset.size === ui.formSizeMode);
  }
  updateSizeHint();
}

/** The two numbers the form implies, whichever of them was typed. */
export function sizeFrom(entry, typed, mode = ui.formSizeMode) {
  if (!(entry > 0) || !(typed > 0)) return { amount: NaN, qty: NaN };
  return mode === 'qty'
    ? { qty: typed, amount: typed * entry }
    : { amount: typed, qty: typed / entry };
}

/**
 * Say what the other number works out to, live.
 *
 * Sizing by shares is where a slip is expensive and invisible — ten shares of
 * something at $600 is $6,000, and nothing else on the form would have said so
 * before it was saved and the cash was spent.
 */
export function updateSizeHint() {
  const hint = field('f-sizeHint');
  if (!hint) return;

  const entry = parseFloat(field('f-entry')?.value);
  const typed = parseFloat(field('f-amount')?.value);
  const { amount, qty } = sizeFrom(entry, typed);

  if (!Number.isFinite(amount)) { hint.textContent = ''; return; }
  hint.textContent = ui.formSizeMode === 'qty'
    ? `= $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} invested`
    : `= ${Number(qty.toFixed(8))} ${qty === 1 ? 'share' : 'shares'} at $${fmtPrice(entry)}`;
}

/** Everything the form currently holds, unvalidated. */
export function readTradeForm() {
  const alreadyClosed = !!field('f-closed')?.checked;
  const entry = parseFloat(field('f-entry').value);
  const { amount, qty } = sizeFrom(entry, parseFloat(field('f-amount').value));

  return {
    ticker: field('f-ticker').value,
    cls: field('f-class').value,
    dir: ui.formDirection,
    // A finished trade is filed by when it closed. Asking when it opened adds
    // a field to get wrong for no gain: nothing downstream reads it, and the
    // month it belongs to comes from the closing date.
    open: alreadyClosed ? null : field('f-date').value,
    entry,
    amount,
    qty,
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
  ['f-entryWrap', 'f-amountWrap', 'f-openDateWrap'].forEach((id) => {
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
  if (field('f-date')) field('f-date').value = todayStr();
  if (field('f-sector')) field('f-sector').value = '';
  // The mode is deliberately kept: someone entering several trades is buying
  // them the same way, and resetting it every time would be tedious.
  setSizeMode(ui.formSizeMode);
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
