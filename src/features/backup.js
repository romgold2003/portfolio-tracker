/**
 * Backup, restore and migration.
 *
 * `localStorage` is scoped per origin, so a journal written by the old
 * single-file version opened over `file://` is invisible to the app served over
 * `http://localhost`. It is not lost — it just lives in a different bucket.
 * This module is the bridge, and doubles as ordinary backup/restore.
 *
 * The Finnhub key is deliberately NOT included: a backup file is something
 * people email to themselves, and a secret should not ride along.
 */
import { STORAGE_KEYS } from '../config/constants.js';
import { sanitizePositions, loadState, flushNow, state } from '../core/store.js';

const BACKUP_FORMAT = 1;

/**
 * Snapshot of the journal as the app currently holds it.
 *
 * Taken from memory rather than from storage: when the journal is encrypted,
 * the plaintext keys this used to read are empty, and the export was a file
 * with nothing in it.
 */
export function buildBackup() {
  let priceLog = {};
  try {
    priceLog = JSON.parse(localStorage.getItem(STORAGE_KEYS.priceLog)) ?? {};
  } catch { /* no history yet */ }

  return {
    app: 'portfolio-tracker',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    data: {
      positions: state.positions,
      cash: state.cash,
      snapshots: state.snapshots,
      priceLog,
    },
  };
}

/** Download the current journal as a dated JSON file. */
export function exportBackup() {
  const backup = buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `portfolio-backup-${backup.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return backup;
}

/**
 * Accept both the current backup format and a bare array of positions, so a
 * journal recovered by hand from an old console still imports cleanly.
 */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON.');
  }

  const data = Array.isArray(parsed) ? { positions: parsed } : (parsed?.data ?? parsed);
  if (!data || !Array.isArray(data.positions)) {
    throw new Error('No positions found in that file.');
  }

  // A backup file is untrusted input: it may have been edited, corrupted, or
  // handed over by someone else. Sanitize here as well as on load, so the count
  // shown in the confirmation is the count that will actually be imported.
  const positions = sanitizePositions(data.positions);
  if (!positions.length) {
    throw new Error('That file has no usable positions in it.');
  }

  return {
    positions,
    dropped: data.positions.length - positions.length,
    cash: Number(data.cash) || 0,
    snapshots: Array.isArray(data.snapshots) ? data.snapshots : [],
    priceLog: data.priceLog && typeof data.priceLog === 'object' ? data.priceLog : {},
  };
}

/** A one-line description of what a parsed backup holds, for the confirm step. */
export function describeBackup(data) {
  const open = data.positions.filter((p) => p.status === 'Open').length;
  const closed = data.positions.filter((p) => p.status === 'Closed').length;
  const dropped = data.dropped
    ? ` · ${data.dropped} unreadable row${data.dropped === 1 ? '' : 's'} skipped`
    : '';
  return `${data.positions.length} position${data.positions.length === 1 ? '' : 's'} `
    + `(${open} open, ${closed} closed) · cash $${data.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `
    + `· ${data.snapshots.length} daily snapshot${data.snapshots.length === 1 ? '' : 's'}${dropped}`;
}

/**
 * Overwrite the journal. The caller confirms with the user first — this
 * replaces the book outright.
 */
export async function restoreBackup(data) {
  // The journal goes in through the same door as every other change, so it
  // lands wherever the app is currently keeping it. Writing the plaintext keys
  // directly, as this used to, put the import somewhere an encrypted session
  // never reads: the app asked for a password again and then showed an empty
  // book, with the imported data sitting unused beside the vault.
  loadState({
    positions: data.positions,
    cash: data.cash,
    snapshots: data.snapshots,
    // A backup carries no API key on purpose, so keep the one already in use.
    apiKey: state.apiKey,
  });
  await flushNow();

  // The price log is public market data and lives outside the journal.
  try {
    localStorage.setItem(STORAGE_KEYS.priceLog, JSON.stringify(data.priceLog ?? {}));
  } catch { /* history simply will not persist */ }
}
