/**
 * Light/dark theme, and Designer mode: any colour of the app, chosen by hand.
 *
 * The stylesheets do the work through their tokens — `body.light` redefines
 * them for the light base, and a colour chosen in Designer mode is set on the
 * body itself, which wins over both. Chart.js bakes colours in when a chart is
 * built, so every change asks the charts to redraw.
 *
 * Chosen colours are kept per base, so a light design and a dark one can both
 * exist and switching between them keeps each. Stored on this device only.
 */
import { STORAGE_KEYS } from '../config/constants.js';

/** Set by the render layer at boot to avoid a circular import. */
let onThemeChange = () => {};
export function setThemeChangeHandler(fn) { onThemeChange = fn; }

const DESIGN_KEY = 'pt_design';

/** Every colour Designer mode offers, grouped the way the window shows them. */
export const DESIGN_GROUPS = [
  {
    title: 'Backgrounds',
    tokens: [
      ['--bg', 'Page background'],
      ['--panel', 'Cards and sidebar'],
      ['--panel2', 'Inner panels'],
      ['--input', 'Fields and buttons'],
      ['--hover', 'Hover'],
      ['--border', 'Borders'],
      ['--border2', 'Outlines'],
    ],
  },
  {
    title: 'Text',
    tokens: [
      ['--text', 'Main text'],
      ['--text2', 'Secondary text'],
      ['--text3', 'Labels'],
      ['--text4', 'Faint text'],
    ],
  },
  {
    title: 'Graph',
    tokens: [
      ['--curve', 'Account line'],
      ['--grid', 'Grid lines'],
      ['--star', 'All-time-high star'],
      ['--marker', 'Deposit markers'],
      ['--chartbox', 'Chart panels'],
    ],
  },
  {
    title: 'Gains, losses and accents',
    tokens: [
      ['--green', 'Gains'],
      ['--red', 'Losses'],
      ['--blue', 'Buttons and links'],
      ['--amber', 'Warnings'],
    ],
  },
];

const ALL_TOKENS = DESIGN_GROUPS.flatMap((g) => g.tokens.map(([token]) => token));

function readDesign() {
  try {
    const saved = JSON.parse(localStorage.getItem(DESIGN_KEY) ?? 'null');
    return { dark: { ...(saved?.dark ?? {}) }, light: { ...(saved?.light ?? {}) } };
  } catch {
    return { dark: {}, light: {} };
  }
}

let design = readDesign();

function saveDesign() {
  try { localStorage.setItem(DESIGN_KEY, JSON.stringify(design)); } catch { /* ignore */ }
}

const baseOf = () => (document.body.classList.contains('light') ? 'light' : 'dark');

/** Put this base's chosen colours on the body, and take the other base's off. */
function applyDesign() {
  const chosen = design[baseOf()];
  for (const token of ALL_TOKENS) {
    const value = chosen[token];
    if (/^#[0-9a-f]{6}$/i.test(value ?? '')) document.body.style.setProperty(token, value);
    else document.body.style.removeProperty(token);
  }
}

function redraw() {
  try { onThemeChange(); } catch { /* first paint may run before views exist */ }
}

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  try { localStorage.setItem(STORAGE_KEYS.theme, theme); } catch { /* ignore */ }
  applyDesign();
  renderDesigner();
  redraw();
}

export function toggleTheme() {
  applyTheme(baseOf() === 'light' ? 'dark' : 'light');
}

export function setThemeBase(theme) {
  if (theme !== baseOf()) applyTheme(theme);
}

/** Stored preference wins; otherwise follow the operating system. */
export function initTheme() {
  let theme = null;
  try { theme = localStorage.getItem(STORAGE_KEYS.theme); } catch { /* ignore */ }
  if (!theme) theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(theme);
}

/** A token's colour as `#rrggbb`, which is all a colour picker accepts. */
function hexOf(token) {
  const raw = getComputedStyle(document.body).getPropertyValue(token).trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(raw);
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return '#000000';
}

/** Draw the Designer window's contents for the base now in use. */
export function renderDesigner() {
  const host = document.getElementById('designerGroups');
  if (!host) return;
  const base = baseOf();
  for (const button of document.querySelectorAll('[data-design-base]')) {
    button.classList.toggle('active', button.dataset.designBase === base);
  }
  host.replaceChildren(...DESIGN_GROUPS.map((group) => {
    const section = document.createElement('div');
    section.className = 'design-group';
    const title = document.createElement('div');
    title.className = 'design-title';
    title.textContent = group.title;
    section.append(title);
    for (const [token, label] of group.tokens) {
      const row = document.createElement('label');
      row.className = 'design-row';
      const name = document.createElement('span');
      name.textContent = label;
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = hexOf(token);
      picker.dataset.token = token;
      picker.setAttribute('aria-label', label);
      // Live while dragging through the palette; the charts redraw once it is let go.
      picker.addEventListener('input', () => setDesignColour(token, picker.value, false));
      picker.addEventListener('change', () => setDesignColour(token, picker.value, true));
      const changed = document.createElement('span');
      changed.className = 'design-dot';
      changed.title = 'Changed from the default';
      changed.hidden = !design[base][token];
      row.append(name, changed, picker);
      section.append(row);
    }
    return section;
  }));
}

export function setDesignColour(token, value, redrawCharts = true) {
  if (!ALL_TOKENS.includes(token) || !/^#[0-9a-f]{6}$/i.test(value)) return;
  design[baseOf()][token] = value;
  saveDesign();
  document.body.style.setProperty(token, value);
  const dot = document.querySelector(`input[data-token="${token}"]`)?.parentElement?.querySelector('.design-dot');
  if (dot) dot.hidden = false;
  if (redrawCharts) redraw();
}

/** Back to the base's own colours. */
export function resetDesign() {
  design[baseOf()] = {};
  saveDesign();
  applyDesign();
  renderDesigner();
  redraw();
}

export function openDesigner() {
  renderDesigner();
  document.getElementById('designerModal')?.classList.add('show');
}

export function closeDesigner() {
  document.getElementById('designerModal')?.classList.remove('show');
}
