/** The live-price settings modal (Finnhub API key). */
import { state } from '../../core/store.js';
import { benchmarkKey } from '../../services/benchmark.js';
import { cloudMode } from '../../core/profiles.js';
import { chainReport } from '../../features/statementLibrary.js';

const modal = () => document.getElementById('settingsModal');

export function openSettings() {
  const input = document.getElementById('apiKeyInput');
  if (input) input.value = state.apiKey;
  const bench = document.getElementById('benchKeyInput');
  if (bench) bench.value = benchmarkKey();
  describeStorage();
  renderStatementYears();
  modal()?.classList.add('show');
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
  renderYearPicker();
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

    const remove = document.createElement('button');
    remove.className = 'btn';
    remove.style.cssText = 'font-size:11px;padding:3px 9px';
    remove.textContent = 'Remove';
    remove.setAttribute('onclick', `removeStatementYear(${record.year})`);

    row.append(label, remove);
    box.append(row);
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
  if (stat) stat.textContent = cloudMode() ? 'Synced · encrypted' : 'Local only · no cloud';
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
