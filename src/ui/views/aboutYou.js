/**
 * "About you" (November 2026): nine quick questions — name, gender, age,
 * objectives, experience, approach, country, how they heard of Riskbook, and
 * employment — so Romy can see who uses it. Every account is asked once: a
 * new one right after signing up, one never asked at its next sign-in. One
 * that answered or skipped any earlier round is not asked again
 * (ABOUT_ASK_BELOW in config/aboutYou.js). The email and password are never asked
 * again.
 *
 * Laid out like a broker's own investor profile: a plain white form, a serif
 * heading, one question a step with a thin progress line, answers as rows
 * with a radio button or, where several apply, a checkbox. A single answer
 * moves straight on; several are confirmed with Continue. Swipe or the arrow
 * keys move between steps, and every question can be skipped.
 *
 * The answers go to the server on their own (api/_lib/about.js), never into
 * the encrypted journal, and never to anyone but Romy.
 */
import { state, setAboutDone, aboutDue, legalDue, onJournalLoaded } from '../../core/store.js';
import { isUnlocked, isGuest } from '../../core/profiles.js';
import { cloudEnabled } from '../../services/cloud.js';
import { social } from '../../services/social.js';
import {
  ABOUT_QUESTIONS, COUNTRY_CODES, COMMON_COUNTRIES, countryName, flagOf,
} from '../../config/aboutYou.js';
import { escapeHtml } from '../format.js';
import { openTour } from './tour.js';

const el = (id) => document.getElementById(id);
/** Steps: 0 the introduction, then one per question, then the confirmation. */
const LAST = ABOUT_QUESTIONS.length + 1;
let answers = {};
let at = 0;
let saving = false;

const picked = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
/** Whether a step has an answer: the name either part of it, the rest a choice. */
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

const brand = '<div class="about-brand"><span class="about-mark">RISKBOOK</span><span class="about-sec">Investor profile</span></div>';

function introHtml() {
  return `${brand}
    <h3 class="about-ask" id="aboutTitle">Complete your investor profile</h3>
    <p class="about-lead">A few short questions help us tailor Riskbook to you. It takes about a minute, and every question is optional.</p>
    <ul class="about-facts">
      <li><span class="about-fi" aria-hidden="true">✓</span><span><b>Confidential.</b> Your answers are never sold, shared or shown to anyone.</span></li>
      <li><span class="about-fi" aria-hidden="true">✓</span><span><b>Encrypted.</b> Your portfolio remains end-to-end encrypted. Only you can see it.</span></li>
      <li><span class="about-fi" aria-hidden="true">✓</span><span><b>Optional.</b> Skip any question, or all of them.</span></li>
    </ul>
    <div class="about-actions">
      <button type="button" class="about-primary" data-about-next>Begin</button>
      <button type="button" class="about-link" data-about-skipall>Not now</button>
    </div>`;
}

/** The name, typed: two boxes the browser can fill from the person's own details. */
function nameHtml(given) {
  const field = (id, label, auto, value) => `<label class="about-field"><span>${label}</span>
      <input type="text" id="${id}" class="about-input" autocomplete="${auto}" maxlength="50" spellcheck="false" value="${escapeHtml(value ?? '')}"></label>`;
  return `<div class="about-names">${field('aboutFirst', 'First name', 'given-name', given.firstName)}${field('aboutLast', 'Last name', 'family-name', given.lastName)}</div>`;
}

function questionHtml(q, given) {
  if (q.name) {
    return `<h3 class="about-ask" id="aboutTitle">${escapeHtml(q.ask)}</h3>
    <p class="about-lead">${escapeHtml(q.hint)}</p>
    ${nameHtml(given)}`;
  }
  const choice = given[q.id];
  const control = q.multi ? 'checkbox' : 'radio';
  const body = q.country
    ? `<div class="about-suggest" role="radiogroup" aria-label="Common countries">${COMMON_COUNTRIES.map((code) => `<button type="button" class="about-opt about-opt-c${choice === code ? ' on' : ''}" data-country="${code}" role="radio" aria-checked="${choice === code}"><span class="about-flag" aria-hidden="true">${flagOf(code)}</span><span>${escapeHtml(countryName(code))}</span></button>`).join('')}</div>
      <input type="text" class="about-search" id="aboutSearch" placeholder="Search all countries" autocomplete="off" spellcheck="false" aria-label="Search all countries">
      <div class="about-clist" id="aboutClist" role="listbox" aria-label="All countries">${countryListHtml('', choice)}</div>`
    : `<div class="about-opts" role="${q.multi ? 'group' : 'radiogroup'}" aria-labelledby="aboutTitle">${q.options.map(([id, label]) => `<button type="button" class="about-opt${isOn(q, given, id) ? ' on' : ''}" data-q="${q.id}" data-v="${escapeHtml(id)}" role="${control}" aria-checked="${isOn(q, given, id)}"><span class="about-ctl about-${control}" aria-hidden="true"></span><span>${escapeHtml(label)}</span></button>`).join('')}</div>`;
  return `<h3 class="about-ask" id="aboutTitle">${escapeHtml(q.ask)}</h3>
    <p class="about-lead">${escapeHtml(q.hint)}</p>
    ${body}`;
}

function doneHtml(given) {
  const n = countAnswered(given);
  return `${brand}
    <div class="about-check" aria-hidden="true"></div>
    <h3 class="about-ask" id="aboutTitle">${n ? 'Thank you. Your profile is complete.' : 'You can complete your profile later.'}</h3>
    <p class="about-lead">${n ? 'Your answers help us improve Riskbook for investors like you.' : 'Nothing was saved.'} Next, a short tour of the application.</p>
    <div class="about-err" id="aboutErr" role="alert"></div>
    <div class="about-actions"><button type="button" class="about-primary" data-about-finish>Continue to Riskbook</button></div>`;
}

/** One step, its progress and its buttons. Exported for the tests. */
export function slideHtml(i, given = answers) {
  const q = ABOUT_QUESTIONS[i - 1];
  const inQuestions = i >= 1 && i <= ABOUT_QUESTIONS.length;
  const head = inQuestions
    ? `<div class="about-top">
        <span class="about-step">Step ${i} of ${ABOUT_QUESTIONS.length}</span>
        <button type="button" class="about-link" data-about-skipall>Skip all</button>
      </div>
      <div class="about-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${ABOUT_QUESTIONS.length}" aria-valuenow="${i - 1}"><span style="width:${((i - 1) / ABOUT_QUESTIONS.length) * 100}%"></span></div>`
    : '';
  const answered = inQuestions && answeredQ(q, given);
  const foot = inQuestions
    ? `<div class="about-foot">
        <button type="button" class="about-secondary" data-about-back>Back</button>
        <button type="button" class="${answered ? 'about-primary' : 'about-secondary'}" data-about-next>${answered ? 'Continue' : 'Skip'}</button>
      </div>`
    : '';
  const body = i === 0 ? introHtml() : i === LAST ? doneHtml(given) : questionHtml(q, given);
  return `${head}<div class="about-stage" data-about-stage>${body}</div>${foot}`;
}

function draw(direction = 0) {
  const card = el('aboutCard');
  card.innerHTML = slideHtml(at);
  card.dataset.slide = at === 0 ? 'intro' : at === LAST ? 'done' : 'question';
  const stage = card.querySelector('.about-stage');
  if (direction) stage.classList.add(direction > 0 ? 'from-right' : 'from-left');
  // Keyboard users land on the first answer; on a phone the keyboard would cover the step.
  if (window.matchMedia?.('(pointer:fine)').matches) card.querySelector('#aboutFirst, .about-opt.on, .about-opt, .about-primary')?.focus({ preventScroll: true });
}

function go(to) {
  const next = Math.max(0, Math.min(LAST, to));
  if (next === at) return;
  const direction = next > at ? 1 : -1;
  at = next;
  draw(direction);
}

/** The step's buttons follow the answers: Continue once something is chosen, Skip until then. */
function refreshFoot() {
  const q = ABOUT_QUESTIONS[at - 1];
  const next = el('aboutCard').querySelector('.about-foot [data-about-next]');
  if (!q || !next) return;
  const answered = answeredQ(q, answers);
  next.textContent = answered ? 'Continue' : 'Skip';
  next.className = answered ? 'about-primary' : 'about-secondary';
}

/**
 * One answer chosen: shown as chosen for a moment, then the next question.
 * Several: ticked and unticked in place, and Continue moves on.
 */
function choose(id, value) {
  const q = ABOUT_QUESTIONS.find((x) => x.id === id);
  if (q?.multi) {
    const list = new Set(answers[id] ?? []);
    if (list.has(value)) list.delete(value); else list.add(value);
    answers[id] = q.options.map(([o]) => o).filter((o) => list.has(o));
  } else {
    answers[id] = answers[id] === value ? undefined : value;
  }
  const card = el('aboutCard');
  for (const b of card.querySelectorAll('[data-q], [data-country]')) {
    const field = b.dataset.q ?? 'country';
    if (field !== id) continue;
    const v = b.dataset.v ?? b.dataset.country;
    const on = q?.multi ? answers[id].includes(v) : answers[id] === v;
    b.classList.toggle('on', on);
    b.setAttribute(b.getAttribute('role') === 'option' ? 'aria-selected' : 'aria-checked', String(on));
  }
  refreshFoot();
  if (q?.multi || !answers[id]) return;
  const here = at;
  setTimeout(() => { if (at === here) go(at + 1); }, 320);
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
    if (t('[data-country]')) return choose('country', t('[data-country]').dataset.country);
    if (t('[data-about-next]')) return go(at + 1);
    if (t('[data-about-back]')) return go(at - 1);
    if (t('[data-about-skipall]')) { if (at === 0) answers = {}; return go(LAST); }
    if (t('[data-about-finish]')) return finish();
    return undefined;
  });
  box.addEventListener('input', (e) => {
    if (e.target.id === 'aboutSearch') el('aboutClist').innerHTML = countryListHtml(e.target.value, answers.country);
    if (e.target.id === 'aboutFirst') { answers.firstName = e.target.value; refreshFoot(); }
    if (e.target.id === 'aboutLast') { answers.lastName = e.target.value; refreshFoot(); }
  });
  box.addEventListener('keydown', (e) => {
    // Enter in a name box moves on: to the last name, then to the next step.
    if (e.key === 'Enter' && e.target.id === 'aboutFirst') { e.preventDefault(); el('aboutLast')?.focus(); return; }
    if (e.key === 'Enter' && e.target.id === 'aboutLast') { e.preventDefault(); go(at + 1); return; }
    // Arrow keys move the cursor in a text box, not the step.
    if (e.target.matches?.('input')) return;
    if (e.key === 'ArrowRight' && at < LAST) go(at + 1);
    else if (e.key === 'ArrowLeft' && at > 0 && at < LAST) go(at - 1);
  });
  // Swiped, on a phone or with a mouse dragged across the form: left for the next step, right for back.
  let startX = null;
  let startY = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.about-clist, .about-search, .about-names')) return;
    startX = e.clientX;
    startY = e.clientY;
  });
  box.addEventListener('pointerup', (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    startX = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && at < LAST) go(at + 1);
    else if (dx > 0 && at > 0 && at < LAST) go(at - 1);
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
