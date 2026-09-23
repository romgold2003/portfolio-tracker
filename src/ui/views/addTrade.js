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
 * A position is sized by what was bought, not by what was spent.
 *
 * Both were offered once, with a toggle between them and the amount as the
 * default. It is the wrong end to hold a position by. The share count is what
 * the broker actually filled and what every later figure is computed from, so
 * deriving it by dividing an amount by the entry price put a rounding error
 * into the book at the moment the trade was created, and everything downstream
 * inherited it.
 *
 * Fractions are allowed throughout: a fractional-share order and any crypto buy
 * are both ordinary, and refusing them would be refusing the common case.
 */

/** The two numbers the form implies, from the share count that was typed. */
export function sizeFrom(entry, qty) {
  if (!(entry > 0) || !(qty > 0)) return { amount: NaN, qty: NaN };
  return { qty, amount: qty * entry };
}

/**
 * Say what the shares cost, live.
 *
 * This is where a slip is expensive and invisible — ten shares of something at
 * $600 is $6,000, and nothing else on the form would say so before it is saved
 * and the cash is spent.
 */
export function updateSizeHint() {
  const hint = field('f-sizeHint');
  if (!hint) return;

  const entry = parseFloat(field('f-entry')?.value);
  const { amount } = sizeFrom(entry, parseFloat(field('f-qty')?.value));

  hint.textContent = Number.isFinite(amount)
    ? `= $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} invested at $${fmtPrice(entry)}`
    : '';
}

/** Everything the form currently holds, unvalidated. */
export function readTradeForm() {
  const alreadyClosed = !!field('f-closed')?.checked;
  const entry = parseFloat(field('f-entry').value);
  const { amount, qty } = sizeFrom(entry, parseFloat(field('f-qty').value));

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
  ['f-ticker', 'f-entry', 'f-qty', 'f-reason', 'f-pnl', 'f-pct'].forEach((id) => {
    const el = field(id);
    if (el) el.value = '';
  });
  setTickerStatus('', 'muted');
  if (field('f-date')) field('f-date').value = todayStr();
  if (field('f-sector')) field('f-sector').value = '';
  updateSizeHint();
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
