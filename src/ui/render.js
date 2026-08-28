/**
 * The single entry point for redrawing the app.
 *
 * Views never call each other and never call the action layer, so this module
 * is the only place that knows the full set of things a state change can
 * affect. Actions mutate, then call renderAll().
 */
import { renderHome, updateLivePill } from './views/home.js';
import { renderPositions } from './views/positions.js';
import { renderMonthly, renderMonthDetail } from './views/monthly.js';

export { updateLivePill };

export function renderAll() {
  renderHome();
  renderPositions();
  renderMonthly();
}

/**
 * Charts size themselves against a visible container, so a page that was hidden
 * when it last rendered needs one redraw after it becomes active.
 */
export function renderOnPageEnter(page) {
  if (page === 'home') setTimeout(renderHome, 50);
  if (page === 'monthly') setTimeout(renderMonthly, 50);
}

/** After a theme change every chart must be rebuilt with the new palette. */
export function renderOnThemeChange() {
  renderHome();
  renderPositions();
  renderMonthly();
  renderMonthDetail();
}
