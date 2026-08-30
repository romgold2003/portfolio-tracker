/**
 * The action layer: user intent -> core mutation -> re-render -> feedback.
 *
 * This is the only module that imports both `core` and `ui`, which is what
 * keeps the dependency graph acyclic:
 *
 *   config -> core -> services -> ui/views -> ui/render -> app/actions
 *
 * Every function exported here is published onto `window` by installActions(),
 * because the markup drives the app through inline `onclick` attributes. That
 * bridge is deliberate and lives in exactly one place, so the set of names the
 * HTML depends on is auditable at a glance.
 */
import { state, saveCash, saveApiKey as persistApiKey, findPosition, savePositions } from '../core/store.js';
import {
  addPosition, addClosedPosition, updatePosition, applyDca as applyDcaToPosition, previewDca,
  closePosition, reopenPosition, deletePosition, setCurrentPrice,
  normalizeTicker, exitProceedsOf,
} from '../core/positions.js';
import { baseQtyOf } from '../core/portfolio.js';
import { fetchPrice, refreshOpenPositions } from '../services/prices.js';
import { renderAll, updateLivePill } from '../ui/render.js';
import { renderHome, toggleAmounts } from '../ui/views/home.js';
import { renderPositions, refreshMeasuredBetas } from '../ui/views/positions.js';
import { renderClosePreview } from '../ui/views/closePreview.js';
import { renderMonthly, renderMonthDetail, populateMonthPicker, populateYearPicker, selectMonth } from '../ui/views/monthly.js';
import { openSettings, closeSettings, readApiKeyInput, readBenchKeyInput } from '../ui/views/settings.js';
import { deleteCurrentAccount } from '../core/profiles.js';
import { saveBenchmarkKey } from '../services/benchmark.js';
import {
  setDirection, readTradeForm, clearTradeForm, setTickerStatus, applyTickerLookup,
  toggleClosedTrade,
} from '../ui/views/addTrade.js';
import { renderCurve } from '../ui/charts.js';
import { show } from '../ui/router.js';
import { ui } from '../ui/uiState.js';
import { toggleTheme } from '../ui/theme.js';
import { money as $u, signedMoney as $s, pctText as fp, pnlColor, fmtPrice } from '../ui/format.js';
import { toggleVoice } from '../features/voice.js';
import { exportBackup, restoreBackup, describeBackup } from '../features/backup.js';
import {
  openImport, closeImport, previewImport, readImportFile, stagedBackup, copyLegacySnippet,
} from '../ui/views/backupModal.js';

const el = (id) => document.getElementById(id);
const numberIn = (id) => parseFloat(el(id)?.value);

// ─── Prices ──────────────────────────────────────────────────────

/**
 * Re-quote every open position.
 *
 * Quotes are fetched one at a time, so a book of fifteen positions against a
 * slow or rate-limited feed can take longer than the refresh interval. Without
 * this guard a second pass would start on top of the first, doubling the
 * request rate against an API that is already struggling — which makes the
 * rate limiting worse rather than better.
 */
let refreshInFlight = false;

export async function refreshPrices() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    await refreshOpenPositions();
    savePositions();
    renderAll();
    updateLivePill();
  } finally {
    refreshInFlight = false;
  }
}

/** Live lookup as the user types a ticker into the new-trade form. */
export async function checkTicker() {
  const ticker = normalizeTicker(el('f-ticker').value);
  if (!ticker) {
    setTickerStatus('', 'muted');
    return;
  }
  setTickerStatus('Checking…', 'muted');

  const cls = el('f-class').value;
  const price = await fetchPrice(ticker, cls);
  if (price) {
    applyTickerLookup(ticker, price);
  } else if (!state.apiKey && cls !== 'Crypto') {
    setTickerStatus('No API key — go to Live price settings in the sidebar', 'amber');
  } else {
    setTickerStatus('Ticker not found — enter price manually', 'amber');
  }
}

export function saveApiKey() {
  persistApiKey(readApiKeyInput());
  saveBenchmarkKey(readBenchKeyInput());
  closeSettings();
  refreshPrices();
  // A new market-data key can change both the benchmark line and beta.
  renderAll();
  refreshMeasuredBetas();
}

// ─── Creating and editing trades ─────────────────────────────────

export function addPos() {
  const form = readTradeForm();
  const ticker = normalizeTicker(form.ticker);
  if (!ticker) {
    alert('Enter a ticker.');
    return;
  }

  // A finished trade is described by its result, an open one by its prices, so
  // the two paths validate different things entirely.
  if (form.alreadyClosed) {
    if (!addClosedTrade(form, ticker)) return;
    renderAll();
    clearTradeForm();
    show('positions');
    return;
  }

  if (!form.entry || !form.amount) {
    alert('Entry price and amount invested are required.');
    return;
  }

  const position = addPosition({ ...form, ticker });
  // The quote lands after the first paint; re-render when it arrives.
  fetchPrice(ticker, position.cls, position).then((price) => {
    if (!price) return;
    position.cur = price;
    savePositions();
    renderAll();
  });

  renderAll();
  clearTradeForm();
  show('positions');
}

/**
 * Validate and record a trade that finished before the app saw it.
 *
 * Returns false when something was wrong, having already said so. The two
 * numbers asked for are the two a broker statement leads with, and between them
 * they fix everything else — a profit of 600 at 30% can only have come from
 * 2,000 staked.
 */
function addClosedTrade(form, ticker) {
  if (!form.close) {
    alert('Enter the date you closed the trade, so it lands in the right month.');
    return false;
  }
  if (form.open && form.close < form.open) {
    alert('The closing date is before the opening date.');
    return false;
  }
  if (!Number.isFinite(form.pnl) || form.pnl === 0) {
    alert('Enter what the trade made, as a positive or negative amount.');
    return false;
  }
  if (!Number.isFinite(form.pct) || form.pct === 0) {
    alert('Enter the return as a percentage — it is what fixes the size of the trade.');
    return false;
  }
  // A gain of +600 cannot have been a return of -12%. Catching the mismatch
  // beats storing a position whose maths quietly contradicts itself.
  if (Math.sign(form.pnl) !== Math.sign(form.pct)) {
    alert('The amount and the percentage disagree: one is a gain and the other a loss.');
    return false;
  }
  if (form.pct <= -100) {
    alert('A loss cannot be more than 100% of what you put in.');
    return false;
  }

  try {
    addClosedPosition({ ...form, ticker });
  } catch (err) {
    alert(err.message);
    return false;
  }
  return true;
}

/**
 * Open one month of closed trades, closing whichever was open.
 *
 * One at a time rather than many: the point of the grouping is that the page
 * stays short, and letting every month stay open would rebuild the long list
 * this replaced.
 */
export function toggleClosedMonth(key) {
  ui.openClosedMonth = ui.openClosedMonth === key ? null : key;
  renderPositions();
}

export function saveEdit(id) {
  const p = findPosition(id);
  if (!p) return;
  const value = (name) => el(`ed-${name}-${id}`)?.value;

  const fields = {
    ticker: normalizeTicker(value('ticker')),
    cls: value('class'),
    dir: value('dir'),
    open: value('date'),
    entry: parseFloat(value('entry')),
    amount: parseFloat(value('amount')),
    reason: value('reason')?.trim(),
    exit: value('exit') ? parseFloat(value('exit')) : null,
    close: value('close') || null,
  };
  if (!fields.ticker || !fields.entry || !fields.amount) {
    alert('Ticker, entry price and amount are required.');
    return;
  }

  const { cashDelta } = updatePosition(id, fields);

  // The ticker may have changed — re-quote it.
  fetchPrice(p.ticker, p.cls, p).then((price) => {
    if (!price || p.status !== 'Open') return;
    p.cur = price;
    savePositions();
    renderAll();
  });

  renderAll();
  if (cashDelta !== 0) {
    alert(`Position updated.\nInvested changed by ${$s(cashDelta)}\nCash is now ${$u(state.cash)}`);
  }
}

export function updatePrice(id) {
  const p = findPosition(id);
  if (!p) return;
  const input = prompt(`Current price for ${p.ticker} (now $${p.cur})`);
  if (input === null) return;
  const price = parseFloat(input);
  if (Number.isNaN(price) || price <= 0) {
    alert('Invalid');
    return;
  }
  setCurrentPrice(id, price);
  renderAll();
}

export function editCash() {
  const input = prompt(`Set your cash balance ($):\nCurrent: ${$u(state.cash)}\n\nThis is updated automatically when you close positions.`);
  if (input === null) return;
  const amount = parseFloat(input);
  if (Number.isNaN(amount)) {
    alert('Invalid amount');
    return;
  }
  state.cash = amount;
  saveCash();
  renderAll();
}

// ─── DCA ─────────────────────────────────────────────────────────

export function calcDca(id) {
  const p = findPosition(id);
  if (!p) return;
  const amount = numberIn(`dcaAmt-${id}`);
  const price = numberIn(`dcaPrice-${id}`);
  if (!amount || !price) return;

  const next = previewDca(p, amount, price);
  el(`dcaRes-${id}`)?.classList.add('show');
  el(`dcaAvg-${id}`).textContent = '$' + fmtPrice(next.avgEntry);
  el(`dcaQty-${id}`).textContent = next.qty.toFixed(next.qty < 1 ? 4 : 2);
  el(`dcaCost-${id}`).textContent = $u(next.cost);
}

export function applyDca(id) {
  const amount = numberIn(`dcaAmt-${id}`);
  const price = numberIn(`dcaPrice-${id}`);
  if (!amount || !price) {
    alert('Enter DCA amount and price');
    return;
  }
  const result = applyDcaToPosition(id, amount, price);
  if (!result) return;
  renderAll();
  alert(`DCA applied. New avg: $${result.position.entry.toFixed(2)} · Cash updated to: ${$u(state.cash)}`);
}

// ─── Closing ─────────────────────────────────────────────────────

export function setClosePct(id, value) {
  const input = el(`cl-pct-${id}`);
  if (!input) return;
  input.value = value;
  syncClose(id, 'pct');
}

/**
 * Keep the "% of original" and "shares" inputs mirrored, capped at what is
 * still open, and redraw the preview. `source` says which field the user
 * touched so the other one is the one that gets rewritten.
 */
export function syncClose(id, source) {
  const p = findPosition(id);
  if (!p) return;
  const priceEl = el(`cl-price-${id}`);
  const pctEl = el(`cl-pct-${id}`);
  const qtyEl = el(`cl-amt-${id}`);
  const preview = el(`cl-preview-${id}`);
  if (!priceEl || !pctEl || !qtyEl || !preview) return;

  const price = parseFloat(priceEl.value);
  if (!price || price <= 0) {
    preview.innerHTML = '<span style="color:var(--text3);font-size:12px">Enter a valid exit price</span>';
    return;
  }

  const base = baseQtyOf(p);
  const maxPct = base > 0 ? (p.qty / base) * 100 : 0;
  const decimals = base < 1 ? 6 : 4;
  let qty;

  if (source === 'amt') {
    qty = parseFloat(qtyEl.value);
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    if (qty > p.qty) {
      qty = p.qty;
      qtyEl.value = +qty.toFixed(decimals);
    }
    pctEl.value = +(base > 0 ? (qty / base) * 100 : 0).toFixed(4);
  } else {
    let pct = parseFloat(pctEl.value);
    if (!Number.isFinite(pct) || pct < 0) pct = 0;
    if (pct > maxPct) {
      pct = +maxPct.toFixed(4);
      pctEl.value = pct;
    } else if (source === 'pct') {
      pctEl.value = pct;
    }
    qty = Math.min((base * pct) / 100, p.qty);
    qtyEl.value = +qty.toFixed(decimals);
  }

  renderClosePreview(p, price, qty);
}

export function confirmClose(id) {
  const p = findPosition(id);
  if (!p) return;
  const price = numberIn(`cl-price-${id}`);
  const qty = numberIn(`cl-amt-${id}`);
  if (!price || price <= 0) {
    alert('Enter a valid exit price.');
    return;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    alert('Enter an amount above 0.');
    return;
  }

  const result = closePosition(id, price, qty);
  ui.expandedId = null;
  renderAll();

  const plural = result.exitCount > 1 ? 's' : '';
  if (result.isFinal) {
    alert(`${p.ticker} fully closed — ${result.exitCount} exit${plural}`
      + `\nAvg exit $${result.avgExit.toFixed(4)}`
      + `\nOverall ${result.totalPnl >= 0 ? 'profit' : 'loss'}: ${$s(+result.totalPnl.toFixed(2))} (${fp(result.totalRetPct)})`
      + `\nNow in your Monthly report.\nCash: ${$u(result.cash)}`);
  } else {
    alert(`Closed ${result.slicePct.toFixed(1)}% of ${p.ticker}`
      + `\nThis exit: ${$s(+result.exitPnl.toFixed(2))} (${fp(result.retPct)})`
      + `\nBanked so far: ${$s(+result.banked.toFixed(2))} over ${result.exitCount} exit${plural}`
      + `\n${result.closedPct.toFixed(1)}% closed · ${(100 - result.closedPct).toFixed(1)}% still open`
      + `\nNot in Monthly until the position is fully closed.\nCash: ${$u(result.cash)}`);
  }
}

export function reopen(id) {
  const p = findPosition(id);
  if (!p) return;
  if (p.exits?.length) {
    const proceeds = exitProceedsOf(p);
    const plural = p.exits.length > 1 ? 's' : '';
    if (!confirm(`Reopen ${p.ticker}? This undoes ${p.exits.length} exit${plural} and removes ${$u(proceeds)} from cash.`)) return;
  }
  reopenPosition(id);
  renderAll();
}

export function del(id) {
  const p = findPosition(id);
  if (!p) return;
  if (!confirm(`Delete ${p.ticker} completely? This removes it from all history and monthly reports. Cannot be undone.`)) return;
  deletePosition(id);
  ui.expandedId = null;
  renderAll();
}

// ─── Backup and restore ──────────────────────────────────────────

/**
 * Replace the journal with an imported backup.
 *
 * The page is reloaded rather than re-rendered so the import goes through the
 * normal boot path — migrations included — instead of leaving the in-memory
 * state and storage briefly disagreeing.
 */
export async function confirmImport() {
  const data = stagedBackup();
  if (!data) return;
  if (!confirm(`Replace the journal in this browser with:\n\n${describeBackup(data)}\n\nThis cannot be undone.`)) return;

  await restoreBackup(data);
  closeImport();
  // Deliberately no reload. Reloading drops the key of an unlocked journal, so
  // the import used to end at the sign-in screen and then an empty book.
  renderAll();
  updateLivePill();
  alert(`Imported ${describeBackup(data)}`);
}

// ─── View state ──────────────────────────────────────────────────

export function toggleExpand(id) {
  ui.expandedId = ui.expandedId === id ? null : id;
  renderPositions();
}

/** Only one of the three inline panels (close / edit / DCA) is open at a time. */
function togglePanel(id, name, siblings) {
  const panel = el(`${name}-${id}`);
  if (!panel) return false;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (opening) siblings.forEach((other) => {
    const sibling = el(`${other}-${id}`);
    if (sibling) sibling.style.display = 'none';
  });
  return opening;
}

export function toggleEdit(id) { togglePanel(id, 'edit', ['dca', 'close']); }
export function toggleDca(id) { togglePanel(id, 'dca', ['edit', 'close']); }
export function toggleClose(id) {
  if (togglePanel(id, 'close', ['dca', 'edit'])) syncClose(id, 'pct');
}

export function toggleMonthTrade(id) {
  ui.expandedMonthTradeId = ui.expandedMonthTradeId === id ? null : id;
  renderMonthDetail();
}

export function setSort(key) {
  ui.homeSort = key;
  document.querySelectorAll('[id^="sort-"]').forEach((b) => b.classList.remove('active'));
  el(`sort-${key}`)?.classList.add('active');
  renderHome();
}

export function setPosSort(key) {
  ui.posSort = key;
  document.querySelectorAll('[id^="psort-"]').forEach((b) => b.classList.remove('active'));
  el(`psort-${key}`)?.classList.add('active');
  renderPositions();
}

export function setTimeframe(tf) {
  ui.timeframe = tf;
  show('home');
  document.querySelectorAll('.tf').forEach((x) => x.classList.toggle('active', x.dataset.tf === tf));
  const label = el('kRetLbl');
  if (label) label.textContent = tf;

  const periodReturn = renderCurve(tf);
  const value = el('kReturn');
  if (value) {
    value.textContent = fp(periodReturn);
    value.style.color = pnlColor(periodReturn);
  }
}

export function setDir(direction) { setDirection(direction); }
export function clearForm() { clearTradeForm(); }

// ─── Voice helpers ───────────────────────────────────────────────
// Small wrappers so the voice grammar can talk in intents rather than DOM ids.

/** Expand a ticker's card, optionally opening its close panel. False if unknown. */
function focusTicker(ticker, openClosePanel) {
  const p = state.positions.find((x) => x.ticker === ticker);
  if (!p) return false;
  show('positions');
  if (openClosePanel && p.status === 'Open') {
    ui.expandedId = p.id;
    renderPositions();
    setTimeout(() => toggleClose(p.id), 50);
  } else {
    ui.expandedId = ui.expandedId === p.id ? null : p.id;
    renderPositions();
  }
  return true;
}

function collapseAll() {
  ui.expandedId = null;
  renderPositions();
}

function setFormTicker(ticker) {
  el('f-ticker').value = ticker;
  checkTicker();
}

function setAssetClass(cls) {
  el('f-class').value = cls;
}

function setChartYear(year) {
  const select = el('chartYear');
  if (!select) return;
  select.value = year;
  renderMonthly();
}

function showMonth(key) {
  const yearPicker = el('pickYear');
  if (yearPicker) yearPicker.value = key.slice(0, 4);
  populateMonthPicker();
  const monthPicker = el('pickMonth');
  if (monthPicker) monthPicker.value = key;
  renderMonthDetail();
  el('monthDetail')?.scrollIntoView({ behavior: 'smooth' });
}

/** The intent surface handed to the voice module. */
export const voiceActions = {
  show,
  setTimeframe,
  editCash,
  refreshPrices,
  focusTicker,
  collapseAll,
  openSettings,
  setFormTicker,
  setDirection,
  setAssetClass,
  clearForm,
  addTrade: addPos,
  setChartYear,
  showMonth,
};

/**
 * Publish the names the inline `onclick` attributes in index.html reference.
 * If you add an inline handler to the markup, add it here too.
 *
 * `extra` exists for handlers that belong to the boot layer rather than here —
 * sign out has to stop the background timers, which only main.js knows about.
 * Passing them in keeps this the single place that writes to `window`.
 */
export function installActions(extra = {}) {
  if (extra.signOut) signOutAfterDelete = extra.signOut;
  Object.assign(window, {
    // navigation & chrome
    show, toggleTheme, toggleVoice, toggleAmounts,
    openSettings, closeSettings, saveApiKey,
    // trades
    addPos, clearForm, setDir, checkTicker, toggleClosedTrade, saveEdit, updatePrice, editCash, del, reopen,
    // panels
    toggleExpand, toggleEdit, toggleDca, toggleClose,
    // dca & close
    calcDca, applyDca, setClosePct, syncClose, confirmClose,
    // lists & sorting
    setSort, setPosSort, refreshPrices, toggleClosedMonth,
    // monthly
    renderMonthly, renderMonthDetail, populateMonthPicker, populateYearPicker,
    selectMonth, toggleMonthTrade,
    // backup & restore
    exportBackup, openImport, closeImport, previewImport, readImportFile, confirmImport,
    copyLegacySnippet,
    // account deletion
    beginDeleteAccount, cancelDeleteAccount, confirmDeleteAccount,
    ...extra,
  });
}

/**
 * Deleting the account. Two steps on purpose.
 *
 * The button only reveals the confirmation; the destructive call needs the
 * password typed in afterwards. Nothing here is recoverable, so a mis-click
 * must not be enough on its own.
 */
export function beginDeleteAccount() {
  const panel = document.getElementById('deleteConfirm');
  const button = document.getElementById('deleteAccountBtn');
  if (!panel || !button) return;
  panel.style.display = 'block';
  button.style.display = 'none';
  const box = document.getElementById('deleteError');
  if (box) { box.textContent = ''; box.style.display = 'none'; }
  document.getElementById('deletePassword')?.focus();
}

export function cancelDeleteAccount() {
  const panel = document.getElementById('deleteConfirm');
  const button = document.getElementById('deleteAccountBtn');
  if (panel) panel.style.display = 'none';
  if (button) button.style.display = '';
  const field = document.getElementById('deletePassword');
  if (field) field.value = '';
}

export async function confirmDeleteAccount() {
  const field = document.getElementById('deletePassword');
  const box = document.getElementById('deleteError');
  const button = document.getElementById('deleteConfirmBtn');
  const showError = (message) => {
    if (!box) return;
    box.textContent = message;
    box.style.display = message ? 'block' : 'none';
  };

  showError('');
  if (!field?.value) { showError('Enter your password to confirm.'); return; }

  if (button) { button.disabled = true; button.textContent = 'Deleting…'; }
  try {
    await deleteCurrentAccount(field.value);
  } catch (err) {
    showError(err.message || 'Could not delete the account.');
    if (button) { button.disabled = false; button.textContent = 'Delete it permanently'; }
    return;
  }

  // The account is gone. Everything still on screen belongs to it, so the app
  // is torn down rather than left showing a journal that no longer exists.
  field.value = '';
  closeSettings();
  cancelDeleteAccount();
  if (button) { button.disabled = false; button.textContent = 'Delete it permanently'; }
  await signOutAfterDelete();
}

/** Filled in by installActions(), because only main.js can stop the timers. */
let signOutAfterDelete = async () => window.location.reload();
