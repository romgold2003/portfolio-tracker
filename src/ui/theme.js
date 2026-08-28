/**
 * Light/dark theme. The stylesheets do all the work through `body.light`;
 * this module only flips the class, remembers the choice, and asks the charts
 * to redraw — Chart.js bakes colours in at construction time.
 */
import { STORAGE_KEYS } from '../config/constants.js';

/** Set by the render layer at boot to avoid a circular import. */
let onThemeChange = () => {};
export function setThemeChangeHandler(fn) { onThemeChange = fn; }

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('light', isLight);
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon) icon.textContent = isLight ? '☾' : '☀';
  if (label) label.textContent = isLight ? 'Dark mode' : 'Light mode';
  try { localStorage.setItem(STORAGE_KEYS.theme, theme); } catch { /* ignore */ }
  try { onThemeChange(); } catch { /* first paint may run before views exist */ }
}

export function toggleTheme() {
  applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
}

/** Stored preference wins; otherwise follow the operating system. */
export function initTheme() {
  let theme = null;
  try { theme = localStorage.getItem(STORAGE_KEYS.theme); } catch { /* ignore */ }
  if (!theme) theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(theme);
}
