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
      // Added after the first twenty, so codes made before them still read.
      ['--blue-bg', 'Button fill'],
      ['--border-blue', 'Button outline'],
      ['--green-bg', 'Gain highlight'],
      ['--red-bg', 'Loss highlight'],
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

/**
 * Switch to Dark or Light. Pressing the one already in use again takes that
 * base back to its original colours.
 */
export function setThemeBase(theme) {
  if (theme !== baseOf()) applyTheme(theme);
  else if (Object.keys(design[theme] ?? {}).length) resetDesign();
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
    const current = button.dataset.designBase === base;
    button.classList.toggle('active', current);
    const name = button.dataset.designBase === 'light' ? 'Light' : 'Dark';
    button.title = current ? `Press again for the original ${name} colours` : `Switch to ${name}`;
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
      // Brings back this one colour; only live once it has been changed.
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'design-reset';
      reset.textContent = '↺';
      reset.title = `Original ${label.toLowerCase()} colour`;
      reset.setAttribute('aria-label', reset.title);
      reset.disabled = !design[base][token];
      reset.addEventListener('click', (e) => { e.preventDefault(); resetDesignColour(token); });
      row.append(name, picker, reset);
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
  const reset = document.querySelector(`input[data-token="${token}"]`)?.parentElement?.querySelector('.design-reset');
  if (reset) reset.disabled = false;
  if (redrawCharts) redraw();
}

/** One colour back to the base's own. */
export function resetDesignColour(token) {
  delete design[baseOf()][token];
  saveDesign();
  document.body.style.removeProperty(token);
  const picker = document.querySelector(`input[data-token="${token}"]`);
  if (picker) {
    picker.value = hexOf(token);
    const reset = picker.parentElement?.querySelector('.design-reset');
    if (reset) reset.disabled = true;
  }
  redraw();
}

/** Back to the base's own colours. */
export function resetDesign() {
  design[baseOf()] = {};
  saveDesign();
  applyDesign();
  renderDesigner();
  redraw();
}

/* ── share codes ───────────────────────────────────────────────────────── */

/**
 * A design as a short code anyone can paste: the base and the colours that
 * differ from it, and nothing else.
 *
 * The code carries the design itself rather than pointing at a copy kept on a
 * server, so it works for anyone, offline, for ever, and costs nothing to keep.
 * Bytes: a version, the base, a 24-bit mask of which colours are set (in the
 * order of DESIGN_GROUPS), then three bytes per set colour — in base64url, so
 * only letters, digits, - and _. A design with five colours changed is 29
 * characters.
 */
const CODE_PREFIX = 'RB-';
const CODE_VERSION = 1;

export function encodeDesign(base, colours) {
  const bytes = [CODE_VERSION, base === 'light' ? 1 : 0, 0, 0, 0];
  ALL_TOKENS.forEach((token, i) => {
    const value = colours?.[token];
    if (!/^#[0-9a-f]{6}$/i.test(value ?? '')) return;
    bytes[2 + (i >> 3)] |= 1 << (i & 7);
    for (let k = 1; k < 7; k += 2) bytes.push(parseInt(value.slice(k, k + 2), 16));
  });
  const text = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return CODE_PREFIX + text;
}

/** The design in a code, or null when it is not one. */
export function decodeDesign(code) {
  const clean = String(code ?? '').trim().replace(/^RB-/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_-]{7,}$/.test(clean)) return null;
  let bytes;
  try {
    const b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
    bytes = [...atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))].map((c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes[0] !== CODE_VERSION || bytes[1] > 1 || bytes.length < 5) return null;
  const colours = {};
  let at = 5;
  for (let i = 0; i < ALL_TOKENS.length; i++) {
    if (!(bytes[2 + (i >> 3)] & (1 << (i & 7)))) continue;
    if (at + 3 > bytes.length) return null;
    colours[ALL_TOKENS[i]] = '#' + bytes.slice(at, at + 3).map((b) => b.toString(16).padStart(2, '0')).join('');
    at += 3;
  }
  if (at !== bytes.length) return null;
  return { base: bytes[1] ? 'light' : 'dark', colours };
}

/** Show this design's code, ready to copy. */
export function shareDesign() {
  const box = document.getElementById('designShare');
  const field = document.getElementById('designShareCode');
  if (!box || !field) return;
  field.value = encodeDesign(baseOf(), design[baseOf()]);
  box.hidden = false;
  field.select();
}

export async function copyDesignCode() {
  const field = document.getElementById('designShareCode');
  const button = document.getElementById('designCopyBtn');
  if (!field) return;
  try {
    await navigator.clipboard.writeText(field.value);
  } catch {
    field.select();
    document.execCommand?.('copy');
  }
  if (button) {
    button.textContent = 'Copied ✓';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  }
}

export function toggleDesignPaste() {
  const box = document.getElementById('designPaste');
  if (!box) return;
  box.hidden = !box.hidden;
  const note = document.getElementById('designPasteNote');
  if (note) note.textContent = '';
  if (!box.hidden) document.getElementById('designPasteCode')?.focus();
}

/** Put a pasted code's design in place of that base's own. */
/** Put a code's design on screen. False when it is not a design code. */
export function applyCode(code) {
  const decoded = decodeDesign(code);
  if (!decoded) return false;
  design[decoded.base] = decoded.colours;
  saveDesign();
  if (decoded.base !== baseOf()) {
    applyTheme(decoded.base);
  } else {
    applyDesign();
    renderDesigner();
    redraw();
  }
  return true;
}

/** The code of the design on screen. */
export function currentDesignCode() {
  return encodeDesign(baseOf(), design[baseOf()]);
}

export function applyDesignCode() {
  const field = document.getElementById('designPasteCode');
  const note = document.getElementById('designPasteNote');
  if (!applyCode(field?.value)) {
    if (note) note.textContent = 'That is not a design code. It starts with RB- — check it was copied whole.';
    return;
  }
  if (field) field.value = '';
  const box = document.getElementById('designPaste');
  if (box) box.hidden = true;
}

export function openDesigner() {
  renderDesigner();
  for (const id of ['designShare', 'designPaste']) {
    const box = document.getElementById(id);
    if (box) box.hidden = true;
  }
  document.getElementById('designerModal')?.classList.add('show');
}

export function closeDesigner() {
  document.getElementById('designerModal')?.classList.remove('show');
}
