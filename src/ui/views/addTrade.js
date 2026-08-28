/** The New-trade form: direction toggle, ticker lookup feedback, reading and resetting. */
import { ui } from '../uiState.js';
import { fmtPrice } from '../format.js';
import { todayStr } from '../../core/portfolio.js';

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
  return {
    ticker: field('f-ticker').value,
    cls: field('f-class').value,
    dir: ui.formDirection,
    open: field('f-date').value,
    entry: parseFloat(field('f-entry').value),
    amount: parseFloat(field('f-amount').value),
    reason: field('f-reason').value.trim(),
  };
}

export function clearTradeForm() {
  ['f-ticker', 'f-entry', 'f-amount', 'f-reason'].forEach((id) => {
    const el = field(id);
    if (el) el.value = '';
  });
  setTickerStatus('', 'muted');
  field('f-date').value = todayStr();
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

/** Set today's date and the greeting that depends on the time of day. */
export function initFormDefaults() {
  const date = field('f-date');
  if (date) date.value = todayStr();
  const hour = new Date().getHours();
  const greeting = field('greetTxt');
  if (greeting) {
    greeting.textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }
}
