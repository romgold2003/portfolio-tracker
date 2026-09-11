/**
 * Application entry point.
 *
 * Nothing renders until a profile is unlocked. The lock screen owns the first
 * paint; the app boots only once a data key exists, because until then there is
 * no journal to draw.
 *
 * Boot order matters:
 *   1. theme, so the first paint is not a flash of the wrong palette
 *   2. lock screen, which either signs in or adopts a pre-accounts journal
 *   3. decrypted data + migrations, so the first render sees the final shape
 *   4. wiring (global bridge, listeners, injected handlers)
 *   5. first render, then background refresh loops
 */
import {
  loadState, clearState, setPersistHandler, flushNow,
  readLegacyJournal, clearLegacyJournal,
} from './core/store.js';
import {
  readVault, saveVault, lock, currentProfile, isUnlocked, resumeCloudSession,
} from './core/profiles.js';
import { detectCloud } from './services/cloud.js';
import { runMigrations } from './core/migrations.js';
import { recordDailySnapshot } from './core/snapshots.js';
import { loadPriceLog } from './services/priceLog.js';
import { TIMERS } from './config/constants.js';
import { initTheme, setThemeChangeHandler } from './ui/theme.js';
import { setPageEnterHandler, show } from './ui/router.js';
import { renderAll, renderOnPageEnter, renderOnThemeChange } from './ui/render.js';
import { refreshMeasuredBetas } from './ui/views/positions.js';
import { initFormDefaults } from './ui/views/addTrade.js';
import { showLockScreen } from './ui/views/lockScreen.js';
import { initAllocationOverlay } from './ui/views/allocationOverlay.js';
import { initParticleWave } from './features/particleWave.js';
import { describeStorageMode } from './ui/views/settings.js';
import { initVoice } from './features/voice.js';
import { checkForRecoveredJournal, setRecoveryImportHandler } from './features/recoveryBanner.js';
import { installActions, voiceActions, refreshPrices, setTimeframe } from './app/actions.js';

/** Background loops, so they can be stopped on sign out. */
let timers = [];

function wireTimeframeButtons() {
  const row = document.getElementById('tfRow');
  if (!row) return;
  row.addEventListener('click', (e) => {
    const button = e.target.closest('.tf');
    if (button) setTimeframe(button.dataset.tf);
  });
}

function showAccount() {
  const profile = currentProfile();
  const row = document.getElementById('accountRow');
  const label = document.getElementById('accountEmail');
  if (!row || !label || !profile) return;
  label.textContent = profile.email;
  label.title = profile.email;
  row.style.display = 'flex';
}

/**
 * Sign out: drop the key, wipe what is in memory, stop the loops, and put the
 * lock screen back. Everything on disk stays encrypted.
 */
export async function signOut() {
  await flushNow();
  timers.forEach(clearInterval);
  timers = [];
  lock();
  clearState();
  setPersistHandler(null);
  document.getElementById('accountRow')?.style.setProperty('display', 'none');
  show('home');
  showLockScreen({ onUnlock: startSession });
}

/**
 * Runs once a profile is unlocked and its data key is in memory.
 * Returns false when the vault could not be read, so the caller knows not to
 * treat the account as usable.
 */
async function startSession() {
  const journal = await readVault();
  if (journal === null) {
    alert('That account\'s journal could not be decrypted. It may be corrupt.\n\n'
      + 'Sign in again, or restore from a backup file.');
    lock();
    showLockScreen({ onUnlock: startSession });
    return false;
  }

  loadState(journal);
  loadPriceLog();
  runMigrations();
  setPersistHandler(saveVault);

  showAccount();
  describeStorageMode();
  renderAll();
  recordDailySnapshot();
  checkForRecoveredJournal();
  // Needs the network, so it lands after the first paint and re-renders.
  refreshMeasuredBetas();

  refreshPrices();
  timers = [
    setInterval(refreshPrices, TIMERS.priceRefreshMs),
    setInterval(recordDailySnapshot, TIMERS.snapshotMs),
  ];
  return true;
}

async function boot() {
  initTheme();

  installActions({ signOut });
  initVoice(voiceActions);
  setPageEnterHandler(renderOnPageEnter);
  setThemeChangeHandler(renderOnThemeChange);
  setRecoveryImportHandler(renderAll);
  initFormDefaults();
  wireTimeframeButtons();
  initAllocationOverlay();
  initParticleWave();

  // Encryption is asynchronous, so a pending save has to be forced out before
  // the tab goes away. `pagehide` fires in cases `beforeunload` misses.
  window.addEventListener('pagehide', () => { if (isUnlocked()) flushNow(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isUnlocked()) flushNow();
  });

  // Is there a server behind this copy of the app? Asked once, before anything
  // is drawn, because it decides whether accounts live on this machine or in
  // the cloud — and the sign-in screen has to say which.
  await detectCloud();

  // A cookie from last time means the account is known; the data key is only
  // still around if this is the same tab. When it is, skip the sign-in screen.
  if (await resumeCloudSession()) {
    if (await startSession()) return;
  }

  // A journal written before accounts existed is offered to the first account
  // created. The plaintext copy is only removed once the encrypted vault has
  // been read back successfully — deleting it any earlier means a failure
  // anywhere in between destroys the only copy.
  const legacy = readLegacyJournal();
  showLockScreen({
    legacy,
    onUnlock: async () => {
      const ok = await startSession();
      if (ok && legacy) clearLegacyJournal();
    },
  });
}

boot();
