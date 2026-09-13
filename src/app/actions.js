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
import {
  state, saveCash, saveApiKey as persistApiKey, findPosition, savePositions,
  loadState, flushNow,
} from '../core/store.js';
import {
  parseIbkrStatement, describeStatement,
} from '../features/ibkr.js';
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
import {
  openSettings, closeSettings, readApiKeyInput, readBenchKeyInput, renderStatementYears,
} from '../ui/views/settings.js';
import {
  statementRecord, withStatements, withoutStatement, chainReport, journalFromStatements, newestYearIn,
} from '../features/statementLibrary.js';
import { deleteCurrentAccount } from '../core/profiles.js';
import { saveBenchmarkKey } from '../services/benchmark.js';
import {
  setDirection, readTradeForm, clearTradeForm, setTickerStatus, applyTickerLookup,
  setSizeMode as applySizeMode, updateSizeHint as refreshSizeHint,
  toggleClosedTrade,
} from '../ui/views/addTrade.js';
import { show } from '../ui/router.js';
import { ui } from '../ui/uiState.js';
import { toggleTheme } from '../ui/theme.js';
import { money as $u, signedMoney as $s, pctText as fp, fmtPrice } from '../ui/format.js';
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
    /**
     * Quoting is allowed to fail; the three lines after it are not allowed to
     * be skipped because it did. A single unhandled throw in here once stopped
     * the app re-rendering after every refresh, and because the prices on
     * screen were merely stale rather than absent, nothing looked broken.
     */
    try {
      await refreshOpenPositions();
    } catch (err) {
      console.error('Price refresh failed; showing the last known prices.', err);
    }
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

  // Both are derived from whichever was typed, so either being absent means the
  // same thing — but the message has to name the field actually on screen.
  if (!form.entry || !form.amount) {
    alert(ui.formSizeMode === 'qty'
      ? 'Entry price and number of shares are required.'
      : 'Entry price and amount invested are required.');
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

/**
 * Change the window the curve and the period KPI cover.
 *
 * The timeframe is set before the page is drawn, because renderHome reads it —
 * and renderHome is what draws the curve and fills the return KPI. This used to
 * draw the curve a second time afterwards and set the KPI from what it returned,
 * which was wrong twice over: renderCurve returns the whole series rather than a
 * number, so formatting it as a percentage threw a TypeError on every click, and
 * the curve is the one thing on this page that must never feed that figure. It
 * measures the change in what the account holds, which counts money paid in as
 * though it had been earned.
 */
export function setTimeframe(tf) {
  ui.timeframe = tf;
  document.querySelectorAll('.tf').forEach((x) => x.classList.toggle('active', x.dataset.tf === tf));
  const label = el('kRetLbl');
  if (label) label.textContent = tf;
  show('home');
}

export function setDir(direction) { setDirection(direction); }
export function clearForm() { clearTradeForm(); }
export function setSizeMode(mode) { applySizeMode(mode); }
export function updateSizeHint() { refreshSizeHint(); }

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
    addPos, clearForm, setDir, setSizeMode, updateSizeHint,
    checkTicker, toggleClosedTrade, saveEdit, updatePrice, editCash, del, reopen,
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
    // Interactive Brokers import
    readIbkrFile, cancelIbkrImport, confirmIbkrImport, removeStatementYear,
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

/**
 * Importing Interactive Brokers statements, one calendar year per file.
 *
 * Read, checked against the years already imported, put on screen, and only
 * then applied. The book is rebuilt from every year together, so the result —
 * which years it will cover, and whether they join up — is shown before
 * anything is touched.
 */
let stagedStatements = [];

const moneyText = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Why an import must not go ahead, or '' when it can.
 *
 * The newest statement decides today's positions and cash, so importing only
 * older years into a journal that already holds a newer one would put the
 * account back to the end of the older year.
 */
function importBlockedBy(records) {
  const newest = records[records.length - 1]?.year;
  const known = newestYearIn(state);
  if (!newest || !known || newest >= known || !state.positions.length) return '';
  return `Your journal already holds ${known}. The newest statement decides today's positions and cash, `
    + `so add your ${known} statement in the same import — otherwise the book would go back to the end of ${newest}.`;
}

function renderIbkrPreview() {
  const records = withStatements(state.statements, stagedStatements.map((s) => s.record));
  const imported = new Set((state.statements ?? []).map((r) => r.year));
  const summary = el('ibkrSummary');
  const warning = el('ibkrWarning');
  if (!summary || !warning) return;

  summary.replaceChildren();
  const line = (text, colour) => {
    const div = document.createElement('div');
    div.style.marginBottom = '6px';
    if (colour) div.style.color = colour;
    div.textContent = text;
    summary.append(div);
  };

  for (const { record, parsed } of [...stagedStatements].sort((a, b) => a.record.year - b.record.year)) {
    const replaces = imported.has(record.year) ? ' (replaces the one imported before)' : '';
    line(`${record.year}${replaces} — ${describeStatement(parsed)}`);
  }

  const years = records.map((r) => r.year);
  line(`After this your journal covers ${years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0]}.`);
  for (const link of chainReport(records)) {
    if (link.ok) {
      line(`${link.from} → ${link.to}: joins up exactly${Number.isFinite(link.value) ? ` at ${moneyText(link.value)}` : ''}.`, 'var(--green)');
    } else {
      line(`${link.from} → ${link.to}: ${link.reason}`, 'var(--amber)');
    }
  }

  const blocked = importBlockedBy(records);
  warning.textContent = blocked
    || 'Positions and closed trades are rebuilt from these statements, so anything entered by hand is replaced. Export a backup first if you want to keep it.';
  const confirmButton = el('ibkrConfirm');
  if (confirmButton) confirmButton.disabled = Boolean(blocked);
  el('ibkrPreview').style.display = 'block';
}

function ibkrError(message) {
  const box = el('ibkrError');
  if (!box) return;
  box.textContent = message || '';
  box.style.display = message ? 'block' : 'none';
}

export async function readIbkrFile() {
  const input = el('ibkrFile');
  const files = [...(input?.files ?? [])];
  ibkrError('');
  stagedStatements = [];
  el('ibkrPreview').style.display = 'none';
  if (!files.length) return;

  /**
   * The year picked, checked against the year the file says it covers.
   *
   * The file is the authority — a statement's period is printed in it — so the
   * picker cannot relabel one. What it catches is the wrong file chosen for the
   * slot, which is exactly the mistake worth stopping before it is merged.
   * With several files at once each goes to its own year.
   */
  const chosen = Number(el('ibkrYear')?.value) || null;
  const problems = [];
  for (const file of files) {
    try {
      const parsed = parseIbkrStatement(await file.text());
      const record = statementRecord(parsed);
      if (chosen && files.length === 1 && record.year !== chosen) {
        problems.push(`${file.name} covers ${record.year}, not ${chosen}. Pick ${record.year}, or "Detect year from file".`);
        continue;
      }
      stagedStatements.push({ name: file.name, parsed, record });
    } catch (err) {
      problems.push(`${file.name}: ${err.message}`);
    }
  }

  if (problems.length) ibkrError(problems.join(' '));
  if (stagedStatements.length) renderIbkrPreview();
}

export function cancelIbkrImport() {
  stagedStatements = [];
  const input = el('ibkrFile');
  if (input) input.value = '';
  el('ibkrPreview').style.display = 'none';
  ibkrError('');
}

/**
 * Take one year back out of the history.
 *
 * What that does depends on which year, so the confirmation says which of the
 * three it is: the only saved statement leaves the book as it is, the newest
 * one hands today's positions to the year before it, and any other takes its
 * trades and deposits with it.
 */
export async function removeStatementYear(year) {
  const records = withoutStatement(state.statements, year);
  const newest = state.statements[state.statements.length - 1]?.year;
  const message = !records.length
    ? `Remove ${year}? Your positions stay exactly as they are — only the saved statement goes, so later imports will not include it.`
    : year === newest
      ? `Remove ${year}? Your book is rebuilt from ${records[records.length - 1].year}, the newest year left: its closing positions and cash, not today's.`
      : `Remove ${year}? Its closed trades and deposits leave your journal.`;
  if (!confirm(message)) return;

  if (records.length) {
    loadState(journalFromStatements(records, { snapshots: state.snapshots, apiKey: state.apiKey }));
  } else {
    loadState({ ...state, statements: [] });
  }
  await flushNow();
  renderAll();
  renderStatementYears();
}

export async function confirmIbkrImport() {
  if (!stagedStatements.length) return;
  const records = withStatements(state.statements, stagedStatements.map((s) => s.record));
  if (importBlockedBy(records)) return;
  const journal = journalFromStatements(records, {
    snapshots: state.snapshots,
    apiKey: state.apiKey,
  });

  loadState(journal);
  await flushNow();

  const count = journal.positions.filter((p) => p.status === 'Open').length;
  const closedCount = journal.positions.length - count;
  const years = records.map((r) => r.year);
  const broken = chainReport(records).filter((link) => !link.ok);
  const nav = journal.openingNav;
  cancelIbkrImport();
  closeSettings();
  renderAll();
  refreshPrices();
  refreshMeasuredBetas();
  show('positions');

  /**
   * Whether the broker's own return came through is worth saying plainly. It
   * decides how the year is measured, the two methods differ by several points
   * on an account that has been paid into, and there is otherwise no sign of
   * which one is in play.
   */
  const measure = nav?.twr != null
    ? `Your year is measured the way your broker measures it: their own ${
      nav.twr.toFixed(2)}% through ${nav.through}, plus everything since.`
    : 'This statement carried no time-weighted return, so the year is measured '
      + 'here instead and may read a little above or below your broker.';

  const span = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : `${years[0]}`;
  const gaps = broken.length ? `\n\nNot joined up: ${broken.map((link) => link.reason).join(' ')}` : '';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  alert(`Your journal now covers ${span}: ${plural(count, 'open position')} and ${plural(closedCount, 'closed trade')} `
    + `from ${plural(years.length, 'statement')}.${gaps}\n\n`
    + `Prices are refreshing now.\n\n${measure}`);
}
