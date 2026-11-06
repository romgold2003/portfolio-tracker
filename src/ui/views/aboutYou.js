/**
 * "About you" (November 2026): nine quick questions — name, gender, age,
 * objectives, experience, approach, country, how they heard of Riskbook, and
 * employment — so Romy can see who uses it. Every account is asked once: a
 * new one right after signing up, one never asked at its next sign-in. One
 * that answered or skipped any earlier round is not asked again
 * (ABOUT_ASK_BELOW in config/aboutYou.js). The email and password are never asked
 * again.
 *
 * Laid out like a broker's own investor profile, on three pages
 * (ABOUT_PAGES): About you (name, gender, age, country), Your investing
 * (experience, approach, objectives, employment) and how they heard of
 * Riskbook. Answers are compact chips, a radio where one applies and a
 * checkbox where several do; the country opens a searchable list in place.
 * Every question is optional, and "Not now" leaves without answering.
 *
 * The answers go to the server on their own (api/_lib/about.js), never into
 * the encrypted journal, and never to anyone but Romy.
 */
import { state, setAboutDone, aboutDue, legalDue, onJournalLoaded } from '../../core/store.js';
import { isUnlocked, isGuest } from '../../core/profiles.js';
import { cloudEnabled } from '../../services/cloud.js';
import { social } from '../../services/social.js';
import {
  ABOUT_QUESTIONS, ABOUT_PAGES, COUNTRY_CODES, COMMON_COUNTRIES, countryName, flagOf,
} from '../../config/aboutYou.js';
import { escapeHtml } from '../format.js';
import { openTour } from './tour.js';

const el = (id) => document.getElementById(id);
const LAST = ABOUT_PAGES.length - 1;
const byId = Object.fromEntries(ABOUT_QUESTIONS.map((q) => [q.id, q]));
let answers = {};
let at = 0;
let saving = false;

const picked = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
/** Whether a question has an answer: the name either part of it, the rest a choice. */
const answeredQ = (q, given) => (q.name ? Boolean(given.firstName?.trim() || given.lastName?.trim()) : picked(given[q.id]));
const countAnswered = (given) => ABOUT_QUESTIONS.filter((q) => answeredQ(q, given)).length;
const isOn = (q, given, id) => (q.multi ? (given[q.id] ?? []).includes(id) : given[q.id] === id);

/** The country list: every country A to Z, narrowed by the search. Exported for the tests. */
export function countryListHtml(query = '', chosen = null) {
  const q = query.trim().toLowerCase();
  const all = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const found = all.filter(({ code, name }) => !q || name.toLowerCase().includes(q) || code.toLowerCase() === q);
  if (!found.length) return `<p class="about-none">No country matches “${escapeHtml(query.trim())}”.</p>`;
  return found.map(({ code, name }) => `<button type="button" class="about-crow${code === chosen ? ' on' : ''}" data-country="${code}" role="option" aria-selected="${code === chosen}"><span class="about-flag" aria-hidden="true">${flagOf(code)}</span><span>${escapeHtml(name)}</span><span class="about-tick" aria-hidden="true"></span></button>`).join('');
}

/** The name, typed: two boxes side by side the browser can fill from the person's own details. */
function nameHtml(given) {
  const field = (id, label, auto, value) => `<label class="about-field"><span class="about-sub">${label}</span>
      <input type="text" id="${id}" class="about-input" autocomplete="${auto}" maxlength="50" spellcheck="false" value="${escapeHtml(value ?? '')}"></label>`;
  return `<div class="about-names">${field('aboutFirst', 'First name', 'given-name', given.firstName)}${field('aboutLast', 'Last name', 'family-name', given.lastName)}</div>`;
}

/** The country: one field showing the choice, opening a searchable list below it. */
function countryHtml(given) {
  const c = given.country;
  return `<button type="button" class="about-select" data-country-toggle aria-expanded="false" aria-controls="aboutCpanel">
      ${c ? `<span class="about-flag" aria-hidden="true">${flagOf(c)}</span><span>${escapeHtml(countryName(c))}</span>` : '<span class="about-ph">Select your country</span>'}
    </button>
    <div class="about-cpanel" id="aboutCpanel" hidden>
      <div class="about-suggest" role="radiogroup" aria-label="Common countries">${COMMON_COUNTRIES.map((code) => `<button type="button" class="about-chip${c === code ? ' on' : ''}" data-country="${code}" role="radio" aria-checked="${c === code}"><span class="about-flag" aria-hidden="true">${flagOf(code)}</span>${escapeHtml(countryName(code))}</button>`).join('')}</div>
      <input type="text" class="about-search" id="aboutSearch" placeholder="Search all countries" autocomplete="off" spellcheck="false" aria-label="Search all countries">
      <div class="about-clist" id="aboutClist" role="listbox" aria-label="All countries">${countryListHtml('', c)}</div>
    </div>`;
}

function questionHtml(q, given) {
  const label = `<div class="about-q-head"><span class="about-q" id="aboutQ-${q.id}">${escapeHtml(q.ask)}</span>${q.multi ? '<span class="about-hint">Select all that apply</span>' : ''}</div>`;
  if (q.name) return `<div class="about-qblock">${nameHtml(given)}</div>`;
  if (q.country) return `<div class="about-qblock">${label}${countryHtml(given)}</div>`;
  const role = q.multi ? 'checkbox' : 'radio';
  return `<div class="about-qblock">${label}
    <div class="about-chips" role="${q.multi ? 'group' : 'radiogroup'}" aria-labelledby="aboutQ-${q.id}">${q.options.map(([id, text]) => `<button type="button" class="about-chip${isOn(q, given, id) ? ' on' : ''}" data-q="${q.id}" data-v="${escapeHtml(id)}" role="${role}" aria-checked="${isOn(q, given, id)}">${escapeHtml(text)}</button>`).join('')}</div>
  </div>`;
}

/** One page, its progress and its buttons. Exported for the tests. */
export function slideHtml(i, given = answers) {
  const page = ABOUT_PAGES[i];
  const n = ABOUT_PAGES.length;
  return `<div class="about-top">
      <span class="about-mark">RISKBOOK</span>
      <span class="about-step">Step ${i + 1} of ${n}</span>
      <button type="button" class="about-link" data-about-skipall>Not now</button>
    </div>
    <div class="about-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${i + 1}"><span style="width:${((i + 1) / n) * 100}%"></span></div>
    <div class="about-stage" data-about-stage>
      <h3 class="about-ask" id="aboutTitle">${escapeHtml(page.title)}</h3>
      <p class="about-lead">${escapeHtml(page.lead)}</p>
      ${page.ids.map((id) => questionHtml(byId[id], given)).join('')}
    </div>
    <div class="about-err" id="aboutErr" role="alert"></div>
    <div class="about-foot">
      <button type="button" class="about-secondary" data-about-back${i === 0 ? ' hidden' : ''}>Back</button>
      ${i === LAST
    ? '<button type="button" class="about-primary" data-about-finish>Finish</button>'
    : '<button type="button" class="about-primary" data-about-next>Continue</button>'}
    </div>`;
}

function draw(direction = 0) {
  const card = el('aboutCard');
  card.innerHTML = slideHtml(at);
  card.dataset.slide = `page${at + 1}`;
  const stage = card.querySelector('.about-stage');
  if (direction) stage.classList.add(direction > 0 ? 'from-right' : 'from-left');
  // Keyboard users land on the first field; on a phone the keyboard would cover the page.
  if (window.matchMedia?.('(pointer:fine)').matches) card.querySelector('#aboutFirst, .about-chip')?.focus({ preventScroll: true });
}

function go(to) {
  const next = Math.max(0, Math.min(LAST, to));
  if (next === at) return;
  const direction = next > at ? 1 : -1;
  at = next;
  draw(direction);
}

function toggleCountries(open) {
  const panel = el('aboutCpanel');
  const button = el('aboutCard').querySelector('[data-country-toggle]');
  if (!panel || !button) return;
  const show = open ?? panel.hidden;
  panel.hidden = !show;
  button.setAttribute('aria-expanded', String(show));
  if (show && window.matchMedia?.('(pointer:fine)').matches) el('aboutSearch')?.focus();
}

/** An answer chosen or unchosen in place: one where one applies, several where several do. */
function choose(id, value) {
  const q = byId[id];
  if (q?.multi) {
    const list = new Set(answers[id] ?? []);
    if (list.has(value)) list.delete(value); else list.add(value);
    answers[id] = q.options.map(([o]) => o).filter((o) => list.has(o));
  } else {
    answers[id] = answers[id] === value ? undefined : value;
  }
  const card = el('aboutCard');
  if (id === 'country') {
    // The field shows the choice, and the list folds away.
    const field = card.querySelector('[data-country-toggle]');
    const c = answers.country;
    field.innerHTML = c ? `<span class="about-flag" aria-hidden="true">${flagOf(c)}</span><span>${escapeHtml(countryName(c))}</span>` : '<span class="about-ph">Select your country</span>';
    if (c) toggleCountries(false);
  }
  for (const b of card.querySelectorAll('[data-q], [data-country]')) {
    const field = b.dataset.q ?? 'country';
    if (field !== id) continue;
    const v = b.dataset.v ?? b.dataset.country;
    const on = q?.multi ? answers[id].includes(v) : answers[id] === v;
    b.classList.toggle('on', on);
    b.setAttribute(b.getAttribute('role') === 'option' ? 'aria-selected' : 'aria-checked', String(on));
  }
}

function close() {
  setAboutDone();
  el('aboutYou').hidden = true;
  document.body.classList.remove('tour-open');
  // The tutorial comes next if it has not been seen.
  if (!state.tourSeen) setTimeout(openTour, 250);
}

async function finish() {
  if (saving) return;
  if (!countAnswered(answers)) { close(); return; }
  const button = el('aboutCard').querySelector('[data-about-finish]');
  saving = true;
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  try {
    await social.about(answers);
    close();
  } catch (err) {
    el('aboutErr').textContent = `${err.message} Please try again in a moment.`;
    if (button) { button.disabled = false; button.textContent = 'Try again'; }
  } finally {
    saving = false;
  }
}

function bind(box) {
  if (box.dataset.bound === '1') return;
  box.dataset.bound = '1';
  box.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t('[data-q]')) return choose(t('[data-q]').dataset.q, t('[data-q]').dataset.v);
    if (t('[data-country-toggle]')) return toggleCountries();
    if (t('[data-country]')) return choose('country', t('[data-country]').dataset.country);
    if (t('[data-about-next]')) return go(at + 1);
    if (t('[data-about-back]')) return go(at - 1);
    // Leaving early keeps what was given so far, if anything.
    if (t('[data-about-skipall]')) return finish();
    if (t('[data-about-finish]')) return finish();
    return undefined;
  });
  box.addEventListener('input', (e) => {
    if (e.target.id === 'aboutSearch') el('aboutClist').innerHTML = countryListHtml(e.target.value, answers.country);
    if (e.target.id === 'aboutFirst') answers.firstName = e.target.value;
    if (e.target.id === 'aboutLast') answers.lastName = e.target.value;
  });
  box.addEventListener('keydown', (e) => {
    // Enter in a name box moves on to the last name.
    if (e.key === 'Enter' && e.target.id === 'aboutFirst') { e.preventDefault(); el('aboutLast')?.focus(); return; }
    if (e.key === 'Enter' && e.target.id === 'aboutLast') { e.preventDefault(); e.target.blur(); }
  });
  // Swiped on a phone: left for the next page, right for back.
  let startX = null;
  let startY = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('.about-cpanel, .about-names')) return;
    startX = e.clientX;
    startY = e.clientY;
  });
  box.addEventListener('pointerup', (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    startX = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? at + 1 : at - 1);
  });
}

export function openAboutYou() {
  const box = el('aboutYou');
  if (!box) return;
  answers = {};
  at = 0;
  bind(box);
  draw();
  box.hidden = false;
  document.body.classList.add('tour-open');
}

/**
 * An account never asked (aboutDue, ABOUT_ASK_BELOW) is asked at its next
 * sign-in, after its journal loads; with no server there is nowhere to keep
 * the answers.
 */
onJournalLoaded(() => {
  // A guest has no account to keep answers with.
  // The Terms come first (ui/views/legal.js), which opens this once they are accepted.
  if (!aboutDue() || !isUnlocked() || isGuest() || legalDue()) return;
  if (!cloudEnabled()) { setAboutDone(); return; }
  setTimeout(() => {
    if (aboutDue() && isUnlocked() && el('aboutYou')?.hidden) openAboutYou();
  }, 600);
});
