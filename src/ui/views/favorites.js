/**
 * Favourite designs: five places for design codes, kept with the account.
 *
 * Saved in the encrypted journal rather than this browser, so they follow the
 * person to any device they sign in on, and each account has its own five.
 * Opened from the ★ beside Share code in Designer mode.
 */
import { state, setFavoriteDesigns, FAVORITE_SLOTS } from '../../core/store.js';
import { applyCode, currentDesignCode, decodeDesign } from '../theme.js';

const el = (id) => document.getElementById(id);

/** The five slots, empty ones as null. */
function slots() {
  const list = state.favoriteDesigns ?? [];
  return Array.from({ length: FAVORITE_SLOTS }, (_, i) => list[i] ?? null);
}

function save(index, slot) {
  const next = slots();
  next[index] = slot;
  setFavoriteDesigns(next);
}

function note(index, text, bad = false) {
  const box = el(`favNote-${index}`);
  if (!box) return;
  box.textContent = text;
  box.classList.toggle('is-bad', bad);
}

export function renderFavorites() {
  const host = el('favsList');
  if (!host) return;
  host.replaceChildren(...slots().map((slot, index) => {
    const row = document.createElement('div');
    row.className = 'fav-slot';

    const num = document.createElement('div');
    num.className = 'fav-num';
    num.textContent = String(index + 1);

    const fields = document.createElement('div');
    fields.className = 'fav-fields';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'fav-name';
    name.placeholder = `Design ${index + 1}`;
    name.maxLength = 30;
    name.value = slot?.name ?? '';
    name.setAttribute('aria-label', `Name of favourite ${index + 1}`);
    name.addEventListener('change', () => {
      const current = slots()[index];
      if (current) save(index, { ...current, name: name.value.trim() });
    });
    const code = document.createElement('input');
    code.type = 'text';
    code.className = 'fav-code';
    code.placeholder = 'Paste a code (RB-…) or save the current design';
    code.spellcheck = false;
    code.value = slot?.code ?? '';
    code.setAttribute('aria-label', `Code of favourite ${index + 1}`);
    code.addEventListener('change', () => {
      const value = code.value.trim();
      if (!value) { save(index, null); note(index, ''); renderFavorites(); return; }
      if (!decodeDesign(value)) { note(index, 'Not a design code — it starts with RB-', true); return; }
      save(index, { name: name.value.trim(), code: value });
      renderFavorites();
      note(index, 'Saved ✓');
    });
    const status = document.createElement('div');
    status.className = 'fav-note';
    status.id = `favNote-${index}`;
    fields.append(name, code, status);

    const buttons = document.createElement('div');
    buttons.className = 'fav-buttons';
    const use = button('Use', `Apply favourite ${index + 1}`, () => {
      const value = code.value.trim();
      if (!value) { note(index, 'Nothing saved here yet', true); return; }
      if (applyCode(value)) note(index, 'Applied ✓');
      else note(index, 'Not a design code — it starts with RB-', true);
    }, 'btn-blue');
    use.disabled = !slot;
    const keep = button('★ Save current', `Save the design on screen in place ${index + 1}`, () => {
      save(index, { name: name.value.trim() || `Design ${index + 1}`, code: currentDesignCode() });
      renderFavorites();
      note(index, 'Current design saved ✓');
    });
    const clear = button('×', `Empty place ${index + 1}`, () => {
      save(index, null);
      renderFavorites();
    }, 'fav-clear');
    clear.disabled = !slot;
    buttons.append(use, keep, clear);

    row.append(num, fields, buttons);
    return row;
  }));
}

function button(text, title, onClick, extra = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${extra}`.trim();
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

export function openFavorites() {
  renderFavorites();
  el('favsModal')?.classList.add('show');
}

export function closeFavorites() {
  el('favsModal')?.classList.remove('show');
}
