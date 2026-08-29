/** The live-price settings modal (Finnhub API key). */
import { state } from '../../core/store.js';
import { benchmarkKey } from '../../services/benchmark.js';
import { cloudMode } from '../../core/profiles.js';

const modal = () => document.getElementById('settingsModal');

export function openSettings() {
  const input = document.getElementById('apiKeyInput');
  if (input) input.value = state.apiKey;
  const bench = document.getElementById('benchKeyInput');
  if (bench) bench.value = benchmarkKey();
  describeStorage();
  modal()?.classList.add('show');
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
