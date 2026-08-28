/**
 * Application entry point.
 *
 * Boot order matters:
 *   1. theme, so the first paint is not a flash of the wrong palette
 *   2. stored data + migrations, so the first render sees the final shape
 *   3. wiring (global bridge, listeners, injected handlers)
 *   4. first render, then background refresh loops
 */
import { loadState } from './core/store.js';
import { runMigrations } from './core/migrations.js';
import { recordDailySnapshot } from './core/snapshots.js';
import { loadPriceLog } from './services/priceLog.js';
import { TIMERS } from './config/constants.js';
import { initTheme, setThemeChangeHandler } from './ui/theme.js';
import { setPageEnterHandler } from './ui/router.js';
import { renderAll, renderOnPageEnter, renderOnThemeChange } from './ui/render.js';
import { initFormDefaults } from './ui/views/addTrade.js';
import { initVoice } from './features/voice.js';
import { checkForRecoveredJournal } from './features/recoveryBanner.js';
import { installActions, voiceActions, refreshPrices, setTimeframe } from './app/actions.js';

function wireTimeframeButtons() {
  const row = document.getElementById('tfRow');
  if (!row) return;
  row.addEventListener('click', (e) => {
    const button = e.target.closest('.tf');
    if (button) setTimeframe(button.dataset.tf);
  });
}

function boot() {
  initTheme();

  loadState();
  loadPriceLog();
  runMigrations();

  installActions();
  initVoice(voiceActions);
  setPageEnterHandler(renderOnPageEnter);
  setThemeChangeHandler(renderOnThemeChange);
  initFormDefaults();
  wireTimeframeButtons();

  renderAll();
  recordDailySnapshot();

  // A journal handed over by tools/recover.html, if there is one.
  checkForRecoveredJournal();

  // Quotes are best-effort: the app is fully usable with stale prices.
  refreshPrices();
  setInterval(refreshPrices, TIMERS.priceRefreshMs);
  setInterval(recordDailySnapshot, TIMERS.snapshotMs);
}

boot();
