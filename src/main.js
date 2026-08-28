/**
 * Application entry point.
 *
 * The journal may or may not be password-protected — both are first-class. If a
 * password has been set in this browser, nothing renders until it is entered.
 * If not, the app opens straight to the journal and offers a password once,
 * which can be declined.
 *
 * Boot order matters:
 *   1. theme, so the first paint is not a flash of the wrong palette
 *   2. wiring (global bridge, listeners, injected handlers)
 *   3. unlock, or read the readable journal
 *   4. migrations, so the first render sees the final shape
 *   5. first render, then background refresh loops
 */
import {
  loadState, setPersistHandler, flushNow, journalSnapshot,
  readPlaintextJournal, savePlaintextJournal, clearPlaintextJournal, firstRunJournal,
} from './core/store.js';
import {
  isLocked, isUnlocked, readVault, saveVault, lock, removeLock,
} from './core/vault.js';
import { runMigrations } from './core/migrations.js';
import { recordDailySnapshot } from './core/snapshots.js';
import { loadPriceLog } from './services/priceLog.js';
import { TIMERS } from './config/constants.js';
import { initTheme, setThemeChangeHandler } from './ui/theme.js';
import { setPageEnterHandler, show } from './ui/router.js';
import { renderAll, renderOnPageEnter, renderOnThemeChange } from './ui/render.js';
import { initFormDefaults } from './ui/views/addTrade.js';
import { showLockScreen } from './ui/views/lockScreen.js';
import { initVoice } from './features/voice.js';
import { checkForRecoveredJournal } from './features/recoveryBanner.js';
import { installActions, voiceActions, refreshPrices, setTimeframe } from './app/actions.js';

/** Remembers that the password offer was declined, so it is made only once. */
const SKIP_KEY = 'pt_lock_declined';

/** Background loops, so they can be stopped when the journal is locked again. */
let timers = [];

function wireTimeframeButtons() {
  const row = document.getElementById('tfRow');
  if (!row) return;
  row.addEventListener('click', (e) => {
    const button = e.target.closest('.tf');
    if (button) setTimeframe(button.dataset.tf);
  });
}

function showLockControls() {
  const row = document.getElementById('lockRow');
  const button = document.getElementById('lockToggleBtn');
  const remove = document.getElementById('lockRemoveBtn');
  if (!row || !button) return;
  row.style.display = 'block';
  button.textContent = isLocked() ? '🔒 Lock now' : '🔓 Set a password';
  if (remove) remove.style.display = isLocked() ? '' : 'none';
}

/** Start the app with a journal in hand, however it was obtained. */
function startApp(journal, persist) {
  loadState(journal);
  loadPriceLog();
  runMigrations();
  setPersistHandler(persist);

  showLockControls();
  renderAll();
  recordDailySnapshot();
  checkForRecoveredJournal();

  refreshPrices();
  timers.forEach(clearInterval);
  timers = [
    setInterval(refreshPrices, TIMERS.priceRefreshMs),
    setInterval(recordDailySnapshot, TIMERS.snapshotMs),
  ];
}

/** Runs after the password screen hands control back. */
async function afterUnlock() {
  if (isUnlocked()) {
    const journal = await readVault();
    if (journal === null) {
      alert('This journal could not be decrypted. It may be damaged.\n\n'
        + 'Try again, or restore from a backup file.');
      lock();
      showLockScreen({ onUnlock: afterUnlock });
      return;
    }
    // The password is set, so the readable copy must not linger beside the
    // vault — it would defeat the whole point.
    clearPlaintextJournal();
    startApp(journal, saveVault);
    return;
  }

  // No password: either declined just now, or never offered.
  try { localStorage.setItem(SKIP_KEY, '1'); } catch { /* ignore */ }
  startApp(readPlaintextJournal() ?? firstRunJournal(), savePlaintextJournal);
}

/** Sidebar button: set a password, or lock a journal that already has one. */
export async function toggleLock() {
  await flushNow();
  if (isLocked()) {
    timers.forEach(clearInterval);
    timers = [];
    lock();
    show('home');
    showLockScreen({ onUnlock: afterUnlock });
    return;
  }
  // Hand over the journal in memory, so that is what gets encrypted.
  showLockScreen({ forceSetup: true, journal: journalSnapshot(), onUnlock: afterUnlock });
}

/** Sidebar button: give up the password and go back to a readable journal. */
export async function unsetPassword() {
  if (!isLocked() || !isUnlocked()) return;
  if (!confirm('Remove the password?\n\nYour journal stays on this device but will no longer be encrypted, and anyone using this browser can read it.')) return;
  const journal = await removeLock();
  savePlaintextJournal(journal ?? journalSnapshot());
  setPersistHandler(savePlaintextJournal);
  showLockControls();
  alert('Password removed. The journal is readable again on this device.');
}

function boot() {
  initTheme();

  installActions({ toggleLock, unsetPassword });
  initVoice(voiceActions);
  setPageEnterHandler(renderOnPageEnter);
  setThemeChangeHandler(renderOnThemeChange);
  initFormDefaults();
  wireTimeframeButtons();

  // Encrypting is asynchronous, so a pending save has to be forced out before
  // the tab goes away. `pagehide` fires in cases `beforeunload` misses.
  window.addEventListener('pagehide', () => flushNow());
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });

  if (isLocked()) {
    showLockScreen({ onUnlock: afterUnlock });
    return;
  }

  const existing = readPlaintextJournal();
  let declined = false;
  try { declined = localStorage.getItem(SKIP_KEY) === '1'; } catch { /* ignore */ }

  // Offer a password once, on a first visit, before any trades exist. After
  // that the sidebar button is the way in — nobody wants to be asked daily.
  if (!declined && existing === null) {
    showLockScreen({ journal: firstRunJournal(), onUnlock: afterUnlock });
    return;
  }

  startApp(existing ?? firstRunJournal(), savePlaintextJournal);
}

boot();
