/**
 * Customize (November 2026): choose what Riskbook shows. A switch per page and
 * per panel, three ready-made layouts, and Reset. What is switched off is gone
 * completely — out of the menu, off the page, no grey space — until switched
 * back on. The list itself is core/layout.js; it is saved with the sign-in.
 *
 * applyLayout() puts the choice on screen and runs after every change and on
 * every redraw. Hiding is a class with !important, so no other code showing a
 * panel (a fetch that lands, a tab switch) can bring it back by accident.
 */
import { state, isShown, setLayoutHidden } from '../../core/store.js';
import { LAYOUT_GROUPS, PRESETS, presetOf } from '../../core/layout.js';
import { currentPage, show } from '../router.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);
const all = (sel) => [...document.querySelectorAll(sel)];
const navButton = (page) => qs(`.nl[onclick="show('${page}')"]`);

/** Which elements each switch removes. */
const TARGETS = {
  'page.monthly': () => [navButton('monthly')],
  'page.news': () => [navButton('news')],
  'page.crypto': () => [navButton('crypto')],
  'page.friends': () => [navButton('friends')],
  gauges: () => all('[data-gauges]'),
  'home.benchmark': () => [qs('#home .bench')],
  'home.today': () => [el('portfolioDailyPct')?.parentElement],
  'home.allocation': () => [el('allocCard')],
  'home.graph': () => [el('tfRow'), qs('#home .curve-wrap')],
  'home.daily': () => [el('dailyLogBtn')],
  'home.figures': () => [qs('#home .kpi-row')],
  'home.holdings': () => [el('homeHoldings')],
  'news.fed': () => [el('fedMain')],
  'news.earnings': () => [el('earnPane')],
  'news.econ': () => [el('econCard')],
  'news.options': () => [el('optionsCard')],
  'news.gamble': () => [qs('#newsTabs [data-tab="gamble"]'), el('newsGamble')],
  'crypto.whales': () => [qs('#cryptoTabs [data-ctab="whales"]'), el('cryptoWhales')],
  'crypto.etf': () => [qs('#cryptoTabs [data-ctab="etf"]'), el('cryptoEtf')],
  'crypto.journal': () => [qs('#cryptoTabs [data-ctab="journal"]'), el('cryptoJournal')],
  'crypto.stable': () => [el('stableDominance')],
};

/** The pages a switch can take away, and the page each id belongs to. */
const PAGE_OF = { 'page.monthly': 'monthly', 'page.news': 'news', 'page.crypto': 'crypto', 'page.friends': 'friends' };

/** Put the chosen layout on screen. Safe to call any time, as often as wanted. */
export function applyLayout() {
  if (typeof document === 'undefined') return;
  for (const [id, targets] of Object.entries(TARGETS)) {
    const off = !isShown(id);
    for (const node of targets()) node?.classList.toggle('lay-off', off);
  }

  // The Fed card holds two panels; with both off, the card goes too.
  el('fedCard')?.classList.toggle('lay-off', !isShown('news.fed') && !isShown('news.earnings'));
  // One tab left is no choice: the strip goes, and Markets is what shows.
  const gambleOff = !isShown('news.gamble');
  el('newsTabs')?.classList.toggle('lay-off', gambleOff);
  if (gambleOff && el('newsMarket')) el('newsMarket').hidden = false;
  // Crypto's tab strip only while there is more than one tab to choose.
  const cryptoTabs = ['crypto.whales', 'crypto.etf', 'crypto.journal'].filter(isShown);
  el('cryptoTabs')?.classList.toggle('lay-off', cryptoTabs.length < 2);
  if (cryptoTabs.length === 0) navButton('crypto')?.classList.add('lay-off');

  fitNav();

  // A page just switched off is not left on screen.
  const page = currentPage();
  const key = Object.keys(PAGE_OF).find((k) => PAGE_OF[k] === page);
  if (key && (!isShown(key) || (page === 'crypto' && !cryptoTabs.length))) show('home');
}

/**
 * The phone's bottom menu: as many columns as buttons actually showing —
 * fewer once pages are switched off, and Monthly is desktop-only there.
 */
function fitNav() {
  const nav = qs('.nav-links');
  if (!nav) return;
  const showing = all('.nav-links .nl').filter((b) => getComputedStyle(b).display !== 'none').length;
  nav.style.setProperty('--nav-n', String(Math.max(1, showing)));
}
if (typeof window !== 'undefined') window.addEventListener('resize', fitNav);

/* ───────────────────────── the window ───────────────────────── */

const isOpen = () => el('customizeModal')?.classList.contains('show');

/** The window's contents. Exported for the tests. */
export function customizeHtml(hidden = state.layoutHidden) {
  const off = new Set(hidden);
  const active = presetOf(hidden);
  const presets = PRESETS.map((p) => `<button class="cz-preset${active === p.key ? ' on' : ''}" data-preset="${p.key}" aria-pressed="${active === p.key}">
      <b>${escapeHtml(p.title)}</b><span>${escapeHtml(p.text)}</span>
    </button>`).join('');
  const groups = LAYOUT_GROUPS.map((g) => {
    const pageOff = g.page && off.has(g.page);
    const pageLabel = g.page ? LAYOUT_GROUPS[0].items.find((i) => i.id === g.page)?.label : '';
    return `<section class="cz-group${pageOff ? ' muted' : ''}">
      <div class="cz-gtitle">${escapeHtml(g.title)}</div>
      ${g.note ? `<div class="cz-gnote">${escapeHtml(g.note)}</div>` : ''}
      ${pageOff ? `<div class="cz-gnote">Switch on ${escapeHtml(pageLabel)} in Pages to choose what it shows.</div>` : g.items.map((i) => `<label class="cz-item">
        <span class="cz-text"><b>${escapeHtml(i.label)}</b><span>${escapeHtml(i.hint)}</span></span>
        <span class="cz-switch"><input type="checkbox" data-item="${i.id}"${off.has(i.id) ? '' : ' checked'} aria-label="Show ${escapeHtml(i.label)}"><span></span></span>
      </label>`).join('')}
    </section>`;
  }).join('');
  return `<div class="years-head"><h3>Customize Riskbook</h3>
      <button class="btn years-close" data-cz-close aria-label="Close">×</button></div>
    <p>Choose what you see. Anything switched off disappears completely — switch it back on whenever you like. Saved with your account, on every device.</p>
    <div class="cz-label">Start from</div>
    <div class="cz-presets">${presets}</div>
    ${groups}
    <div class="cz-foot">
      <button class="sort-btn" data-preset="trader">Reset to everything</button>
      <button class="btn cz-done" data-cz-close>Done</button>
    </div>`;
}

function draw() {
  const box = qs('#customizeModal .cz-modal');
  if (!box) return;
  const scroll = box.scrollTop;
  box.innerHTML = customizeHtml();
  box.scrollTop = scroll;
}

export function openCustomize() {
  const modal = el('customizeModal');
  if (!modal) return;
  bind();
  draw();
  modal.classList.add('show');
  qs('#customizeModal [data-cz-close]')?.focus();
}

export function closeCustomize() {
  el('customizeModal')?.classList.remove('show');
}

function bind() {
  const modal = el('customizeModal');
  if (modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-cz-close]')) return closeCustomize();
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      setLayoutHidden(PRESETS.find((p) => p.key === preset.dataset.preset)?.hidden ?? []);
      draw();
    }
    return undefined;
  });
  modal.addEventListener('change', (e) => {
    const box = e.target.closest('[data-item]');
    if (!box) return;
    const off = new Set(state.layoutHidden);
    if (box.checked) off.delete(box.dataset.item); else off.add(box.dataset.item);
    setLayoutHidden([...off]);
    // Redrawn so a page switched off folds its own panels away, and back;
    // otherwise only the ready-made layout that now matches is marked.
    if (box.dataset.item.startsWith('page.')) draw();
    else markPreset();
  });
}

function markPreset() {
  const active = presetOf(state.layoutHidden);
  for (const b of document.querySelectorAll('#customizeModal .cz-presets [data-preset]')) {
    b.classList.toggle('on', b.dataset.preset === active);
    b.setAttribute('aria-pressed', String(b.dataset.preset === active));
  }
}

export { isOpen as isCustomizeOpen };
