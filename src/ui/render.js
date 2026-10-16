/**
 * The single entry point for redrawing the app.
 *
 * Views never call each other and never call the action layer, so this module
 * is the only place that knows the full set of things a state change can
 * affect. Actions mutate, then call renderAll().
 */
import { renderHome, updateLivePill } from './views/home.js';
import { setOrbitBackdrop } from '../features/orbitBackdrop.js';
import { renderPositions } from './views/positions.js';
import { renderMonthly, renderMonthDetail } from './views/monthly.js';
import { renderNews } from './views/news.js';
import { renderCrypto } from './views/crypto.js';
import { pauseHyperliquid } from './views/cryptoWhales.js';
import { showGauges } from './views/sentimentGauges.js';
import { renderAccountSwitcher } from './views/accounts.js';
import { currentPage } from './router.js';

export { updateLivePill };

/**
 * Redraw the page on screen. The others are drawn when they are opened.
 *
 * This runs after every price refresh, every thirty seconds, and it used to
 * redraw all of them — News included, which asks the server again for the Fed
 * odds, the releases, the sentiment and the options profile and redraws their
 * charts, and re-reads Polymarket for the Gamble tab: seven or more requests
 * and two thousand bets sorted, twice a minute, behind the Home page nobody
 * had left. That was most of why the app grew slow and froze (October 2026).
 */
export function renderAll() {
  renderAccountSwitcher();
  const page = currentPage();
  if (page === 'home') renderHome();
  else if (page === 'positions') renderPositions();
  else if (page === 'monthly') renderMonthly();
  // Fetches over the network and resolves on its own; nothing here waits on it.
  else if (page === 'news') renderNews();
}

/**
 * Charts size themselves against a visible container, so a page that was hidden
 * when it last rendered needs one redraw after it becomes active.
 */
export function renderOnPageEnter(page) {
  // The orbit scene belongs to New trade and runs only while it is on screen.
  setOrbitBackdrop(page === 'add');
  if (page === 'home') setTimeout(renderHome, 50);
  if (page === 'positions') renderPositions();
  if (page === 'monthly') setTimeout(renderMonthly, 50);
  if (page === 'news') renderNews();
  if (page === 'crypto') renderCrypto();
  // The live whale feed is only worth its cost while it is on screen.
  else pauseHyperliquid();
  // Fear and greed on every page but New trade; see sentimentGauges.js.
  if (page !== 'add') showGauges();
}

/** After a theme change every chart must be rebuilt with the new palette. */
export function renderOnThemeChange() {
  renderHome();
  renderPositions();
  renderMonthly();
  renderMonthDetail();
}
