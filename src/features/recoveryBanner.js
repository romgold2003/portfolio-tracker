/**
 * Offers a journal that the recovery page handed to the dev server.
 *
 * `tools/recover.html` runs from `file://`, where the old single-file version's
 * data lives, and POSTs it to `/__recover`. This picks it up and offers a
 * one-click import, so nothing has to be downloaded and re-uploaded by hand.
 *
 * It only ever *offers* — the import itself still goes through the same confirm
 * step as a manual one, because it replaces the book outright.
 */
import { parseBackup, describeBackup, restoreBackup } from './backup.js';
import { state } from '../core/store.js';

const ENDPOINT = '/__recover';

/** Set at boot, so this module never has to import the render layer. */
let onImported = () => {};
export function setRecoveryImportHandler(fn) { onImported = fn; }
/** Remembers which recovered backup was already taken, so it is offered once. */
const SEEN_KEY = 'pt_recovered_seen';

/**
 * Identifies one recovered backup. The file stays on disk as a safety net, so
 * the banner needs its own record of what has already been imported rather than
 * relying on the file being deleted.
 */
function fingerprint(raw) {
  return `${raw?.exportedAt ?? ''}:${raw?.data?.positions?.length ?? 0}`;
}

function alreadyImported(id) {
  try { return localStorage.getItem(SEEN_KEY) === id; } catch { return false; }
}

function markImported(id) {
  try { localStorage.setItem(SEEN_KEY, id); } catch { /* storage unavailable */ }
}

/** True when the current book is still the untouched first-run demo. */
function looksLikeDemo() {
  const p = state.positions;
  if (p.length === 0) return true;
  if (p.length !== 4) return false;
  const demoTickers = ['BTC', 'IAU', 'MSFT', 'IBM'];
  return p.every((x) => demoTickers.includes(x.ticker) && x.id <= 4);
}

function dismiss() {
  document.getElementById('recoveryBanner')?.remove();
}

function render(data, id) {
  const existing = looksLikeDemo()
    ? ''
    : '<div class="recovery-warn">This will replace the journal currently loaded here.</div>';

  const banner = document.createElement('div');
  banner.id = 'recoveryBanner';
  banner.className = 'recovery-banner';
  banner.innerHTML = `
    <div class="recovery-main">
      <div class="recovery-title">Recovered journal available</div>
      <div class="recovery-sub">${describeBackup(data)}</div>
      ${existing}
    </div>
    <div class="recovery-actions">
      <button class="btn btn-blue" id="recoveryImport">Import</button>
      <button class="btn" id="recoveryDismiss">Not now</button>
    </div>`;

  document.body.prepend(banner);

  document.getElementById('recoveryImport').addEventListener('click', async () => {
    if (!confirm(`Import this journal?\n\n${describeBackup(data)}\n\nThis replaces what is loaded here now.`)) return;
    await restoreBackup(data);
    markImported(id);
    dismiss();
    // No reload: it would drop the key of an unlocked journal and land the user
    // back at the sign-in screen looking at an empty book.
    onImported();
  });
  document.getElementById('recoveryDismiss').addEventListener('click', dismiss);
}

/**
 * Best-effort: a 404 just means nothing has been recovered, which is the normal
 * case. Never let this break the app's boot.
 */
export async function checkForRecoveredJournal() {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    const id = fingerprint(JSON.parse(text));
    if (alreadyImported(id)) return;
    const data = parseBackup(text);
    if (!data.positions.length) return;
    render(data, id);
  } catch {
    /* server not running, endpoint absent, or nothing recovered — all fine */
  }
}
