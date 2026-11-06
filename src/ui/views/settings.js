/** The Settings window: importing from the broker, live prices, the journal and the account. */
import { state, returnMethod, setReturnMethod } from '../../core/store.js';
import { isGuest } from '../../core/profiles.js';
import { social } from '../../services/social.js';
import { cloudEnabled } from '../../services/cloud.js';
import { TERMS_URL, PRIVACY_URL } from '../../config/legal.js';
import { benchmarkKey } from '../../services/benchmark.js';
import { cloudMode } from '../../core/profiles.js';
import { chainReport, historyGaps } from '../../features/statementLibrary.js';
import { activeAccountName } from './accounts.js';
import { brokerById, RETURN_METHODS } from '../../config/brokers.js';

const modal = () => document.getElementById('settingsModal');

export function openSettings() {
  const input = document.getElementById('apiKeyInput');
  if (input) input.value = state.apiKey;
  const bench = document.getElementById('benchKeyInput');
  if (bench) bench.value = benchmarkKey();
  describeStorage();
  describeImport();
  describeReturns();
  describeLegal();
  renderStatementYears();
  modal()?.classList.add('show');
}

/**
 * Which way returns are measured, and why: by default the broker's own way, so
 * Riskbook's % moves with the broker's app; either can be chosen by hand.
 */
export function describeReturns() {
  const method = returnMethod();
  const chosen = state.returnMethod ?? '';
  for (const button of document.querySelectorAll('.set-seg [data-method]')) {
    const on = button.dataset.method === chosen;
    button.classList.toggle('on', on);
    button.setAttribute('aria-checked', String(on));
  }
  const hint = document.getElementById('returnHint');
  if (!hint) return;
  const broker = brokerById(state.broker);
  const why = method === 'mwr'
    ? 'when you added money counts (Fidelity, Vanguard, Trading 212).'
    : method === 'md'
      ? 'profit over the average money in the account, as the Robinhood chart shows it.'
      : 'deposits and withdrawals change nothing (Interactive Brokers, and the S&P 500 comparison).';
  const lead = chosen ? `${RETURN_METHODS[method].label}, your choice —`
    : broker && broker.id !== 'other' ? `${RETURN_METHODS[method].label}, as ${broker.name} measures it —`
      : `${RETURN_METHODS[method].label} —`;
  hint.textContent = `${lead} ${why} When no money moved, both give the same number.`;
}

/**
 * The Terms and Privacy card: links to both, which version was accepted and
 * when, and the news-email choice, read from the server's record.
 */
async function describeLegal() {
  const status = document.getElementById('legalStatus');
  const row = document.getElementById('marketingRow');
  const box = document.getElementById('marketingBox');
  const links = `<a href="${TERMS_URL}" target="_blank" rel="noopener">Terms of Service</a> and <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy Policy</a>`;
  if (status) status.innerHTML = `Riskbook's ${links}.`;
  if (row) row.hidden = true;
  if (!cloudEnabled() || isGuest()) return;
  try {
    const c = await social.consent();
    if (status && c.version) {
      const on = new Date(c.acceptedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      status.innerHTML = `You accepted the ${links} (version ${c.version}) on ${on}.`;
    }
    if (box) box.checked = Boolean(c.marketing);
    if (row) row.hidden = false;
  } catch { /* the links are still there */ }
}

/** The import card says where things stand: which broker, which years are in. */
function describeImport() {
  const years = (state.statements ?? []).map((r) => r.year).sort((a, b) => a - b);
  const broker = brokerById(state.broker);
  const status = document.getElementById('importStatus');
  if (status) {
    const span = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : String(years[0] ?? '');
    status.textContent = years.length
      ? `${broker ? `${broker.name} · ` : ''}${span} imported. Add a newer file to bring it up to date.`
      : 'Your trades, positions and cash, from the file your broker gives you. About two minutes.';
  }
  const button = document.getElementById('importBrokerBtn');
  if (button) button.textContent = years.length ? 'Add a file' : 'Import my broker file';
}

/** The earliest year the picker offers. */
const FIRST_STATEMENT_YEAR = 1980;

/**
 * The year picker: All years, or one year from now back to 1980.
 *
 * Rebuilt every time settings open, so it reaches the new year on its own when
 * the calendar turns, and so it can mark which years are already imported.
 */
function renderYearPicker() {
  const select = document.getElementById('ibkrYear');
  if (!select) return;
  const imported = new Set((state.statements ?? []).map((r) => r.year));
  const chosen = select.value;
  select.replaceChildren(new Option('All years — whole history in one file', ''));
  for (let year = new Date().getFullYear(); year >= FIRST_STATEMENT_YEAR; year--) {
    select.add(new Option(imported.has(year) ? `${year} · imported` : String(year), String(year)));
  }
  select.value = [...select.options].some((o) => o.value === chosen) ? chosen : '';
}

/** The year whose square was pressed, 'all' for a whole history, or null. */
let chosenYear = null;

export function setChosenYear(year) { chosenYear = year; }

/** The years with a file picked and waiting for Add to journal. */
let pendingYears = new Set();

export function setPendingYears(years) { pendingYears = new Set(years ?? []); }

/** How many recent years show before "Earlier years" opens the rest. */
const RECENT_YEARS = 6;

/** Whether the years before the recent ones are open. */
let showAllYears = false;

export function toggleEarlierYears() {
  showAllYears = !showAllYears;
  renderYearGrid();
}

/**
 * One square per year, this year first. The last six show, with any year
 * already imported or waiting; "Earlier years" opens the rest, back to 1980.
 *
 * An imported year is marked, this year is outlined because its file is the one
 * that sets today's book, and the square just pressed stays highlighted while
 * its file is read.
 */
function renderYearGrid() {
  const grid = document.getElementById('yearsGrid');
  if (!grid) return;
  const imported = new Set((state.statements ?? []).map((r) => r.year));
  const thisYear = new Date().getFullYear();
  const recent = (year) => year > thisYear - RECENT_YEARS;
  grid.replaceChildren();
  for (let year = thisYear; year >= FIRST_STATEMENT_YEAR; year--) {
    if (!showAllYears && !recent(year) && !imported.has(year) && !pendingYears.has(year) && chosenYear !== year) continue;
    const tile = document.createElement('div');
    tile.className = 'year-tile'
      + (imported.has(year) ? ' is-imported' : '')
      + (year === thisYear ? ' is-current' : '')
      + (chosenYear === year ? ' is-chosen' : '')
      + (pendingYears.has(year) ? ' is-pending' : '');

    // The square itself adds a file to its year.
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'year-pick';
    pick.setAttribute('onclick', `chooseYearFile(${year})`);
    const label = document.createElement('span');
    label.textContent = String(year);
    const tag = document.createElement('span');
    tag.className = 'year-tag';
    tag.textContent = pendingYears.has(year) ? '● ready to add'
      : imported.has(year) ? '✓ imported'
        : year === thisYear ? 'this year' : '';
    pick.append(label, tag);
    tile.append(pick);

    /**
     * The × in the corner removes that year, and is the only way to. A sibling
     * of the square rather than inside it, so pressing it never also opens the
     * file picker.
     */
    if (imported.has(year)) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'year-remove';
      remove.textContent = '×';
      remove.title = `Remove ${year}`;
      remove.setAttribute('aria-label', `Remove ${year}`);
      remove.setAttribute('onclick', `removeStatementYear(${year})`);
      tile.append(remove);
    }
    grid.append(tile);
  }
  const more = document.getElementById('yearsMore');
  if (more) more.textContent = showAllYears ? 'Fewer years ▴' : 'Earlier years ▾';

  const chosen = document.getElementById('yearsChosen');
  if (chosen) {
    const waiting = [...pendingYears].sort((a, b) => a - b);
    chosen.textContent = waiting.length
      ? `Ready to add: ${waiting.join(', ')} — pick another year, or press Add to journal to add ${waiting.length > 1 ? 'them all' : 'it'}.`
      : chosenYear === 'all'
        ? 'Whole history: each row goes to the year of its date.'
        : chosenYear ? `Adding a file to ${chosenYear}.` : '';
  }
}

const shortDay = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric',
});

/**
 * Every imported year, newest first, and whether each joins the next.
 *
 * The broker's own return sits beside each year: it is the one figure per year
 * this app cannot recompute, and the quickest way to see a year is the right
 * file.
 */
export function renderStatementYears() {
  const target = document.getElementById('yearsAccount');
  if (target) target.textContent = `Files go to: ${activeAccountName()}`;
  renderYearPicker();
  renderYearGrid();
  const box = document.getElementById('ibkrYears');
  if (!box) return;
  box.replaceChildren();
  const records = state.statements ?? [];
  if (!records.length) return;

  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px';
  heading.textContent = 'Imported years';
  box.append(heading);

  for (const record of [...records].reverse()) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-top:0.5px solid var(--border2);font-size:12px';

    const parts = [String(record.year), `${shortDay(record.from)} – ${shortDay(record.to)}`];
    if (Number.isFinite(record.twr)) parts.push(`IBKR return ${record.twr >= 0 ? '+' : ''}${record.twr.toFixed(2)}%`);
    if ((record.accounts ?? []).length > 1) parts.push(`${record.accounts.length} accounts combined`);
    if (record.kind === 'transactions') {
      const n = record.transactions?.length ?? 0;
      parts.push(`${n} transaction${n === 1 ? '' : 's'}${record.source ? ` from ${record.source}` : ''}`);
    }
    const label = document.createElement('span');
    label.textContent = parts.join(' · ');

    // Removing a year is the × on its square above.
    row.append(label);
    box.append(row);
  }

  for (const gap of historyGaps(records)) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--amber);margin-top:6px';
    note.textContent = `${gap.year}: the file covers only ${gap.from} to ${gap.to}. Add the statement for the whole period, `
      + 'or the chart and returns stay incomplete.';
    box.append(note);
  }
  for (const link of chainReport(records).filter((l) => !l.ok)) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--amber);margin-top:6px';
    note.textContent = `${link.from} → ${link.to}: ${link.reason}`;
    box.append(note);
  }
}

/**
 * Where the journal actually lives depends on the deployment, and the settings
 * modal is where someone goes to find out. Saying "this browser only" on a
 * cloud deployment would be a plain untruth about their data.
 */
function describeStorage() {
  const journal = document.getElementById('journalBlurb');
  if (journal) {
    journal.textContent = cloudMode()
      ? 'Encrypted on this device, then stored in your account so it opens on any device. Export a backup to keep a copy of your own.'
      : 'Everything is stored in this browser only. Export a backup before clearing browser data, or to move the journal to another machine.';
  }
  const blurb = document.getElementById('deleteBlurb');
  if (blurb) {
    blurb.textContent = cloudMode()
      ? 'Erases your account and journal from the server. This cannot be undone.'
      : 'Removes this account and its journal from this browser. This cannot be undone.';
  }
}

/** The sidebar line under the account. */
export function describeStorageMode() {
  const stat = document.getElementById('sideStat');
  if (stat) stat.textContent = cloudMode() ? '✓ Synced · encrypted' : '✓ Encrypted';
}

export function closeSettings() {
  modal()?.classList.remove('show');
}

export function readBenchKeyInput() {
  return document.getElementById('benchKeyInput')?.value.trim() ?? '';
}

export function readApiKeyInput() {
  return document.getElementById('apiKeyInput')?.value.trim() ?? '';
}
