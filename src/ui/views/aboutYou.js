/**
 * "About you" (November 2026): eight quick questions every account is asked
 * once — sex, age, goal, experience, style, country, how they heard of
 * Riskbook, and what they do — so Romy can see who uses it. A new account is
 * asked right after signing up; one made before the questions existed, the
 * next time it opens the app. The email and password are never asked again.
 *
 * Built to feel like a friendly hello rather than a form: a bright card, one
 * big question a slide, each answer a large tap with its own emoji that moves
 * straight on to the next, swipeable, with a welcome that says plainly what
 * happens to the answers and a thank-you at the end. Every question can be
 * skipped, and so can all of them.
 *
 * The answers go to the server on their own (api/_lib/about.js), never into
 * the encrypted journal, and never to anyone but Romy.
 */
import { state, setAboutDone, onJournalLoaded } from '../../core/store.js';
import { isUnlocked } from '../../core/profiles.js';
import { cloudEnabled } from '../../services/cloud.js';
import { social } from '../../services/social.js';
import {
  ABOUT_QUESTIONS, COUNTRY_CODES, COMMON_COUNTRIES, countryName, flagOf,
} from '../../config/aboutYou.js';
import { escapeHtml } from '../format.js';
import { openTour } from './tour.js';

const el = (id) => document.getElementById(id);
/** Slides: 0 the welcome, 1…8 the questions, 9 the thank-you. */
const LAST = ABOUT_QUESTIONS.length + 1;
let answers = {};
let at = 0;
let saving = false;

const countAnswered = (given) => ABOUT_QUESTIONS.filter((q) => given[q.id]).length;

/** The country list: every country A to Z, narrowed by the search. Exported for the tests. */
export function countryListHtml(query = '', chosen = null) {
  const q = query.trim().toLowerCase();
  const all = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const found = all.filter(({ code, name }) => !q || name.toLowerCase().includes(q) || code.toLowerCase() === q);
  if (!found.length) return `<p class="about-none">No country called “${escapeHtml(query.trim())}”.</p>`;
  return found.map(({ code, name }) => `<button type="button" class="about-crow${code === chosen ? ' on' : ''}" data-country="${code}" role="option" aria-selected="${code === chosen}"><span class="about-flag" aria-hidden="true">${flagOf(code)}</span>${escapeHtml(name)}</button>`).join('');
}

function welcomeHtml() {
  return `<div class="about-hero" aria-hidden="true">👋</div>
    <h3 class="about-ask" id="aboutTitle">Hi! Let’s get to know you</h3>
    <p class="about-hint">${ABOUT_QUESTIONS.length} quick taps, about 30 seconds. It helps us build Riskbook around people like you.</p>
    <ul class="about-trust">
      <li><span aria-hidden="true">🔒</span><span><b>Your portfolio stays encrypted.</b> Only you can ever see it — not even us.</span></li>
      <li><span aria-hidden="true">🤝</span><span><b>Your answers stay private.</b> Never sold, never shown to anyone.</span></li>
      <li><span aria-hidden="true">⏭️</span><span><b>Skip anything.</b> Every question is optional.</span></li>
    </ul>
    <button type="button" class="about-cta" data-about-next>Let’s go <span aria-hidden="true">→</span></button>
    <button type="button" class="about-later" data-about-skipall>Maybe later</button>`;
}

function questionHtml(q, given) {
  const choice = given[q.id];
  const body = q.country
    ? `<div class="about-suggest">${COMMON_COUNTRIES.map((code) => `<button type="button" class="about-opt about-opt-sm${choice === code ? ' on' : ''}" data-country="${code}" aria-pressed="${choice === code}"><span class="about-emoji" aria-hidden="true">${flagOf(code)}</span><span>${escapeHtml(countryName(code))}</span></button>`).join('')}</div>
      <input type="text" class="about-search" id="aboutSearch" placeholder="🔍  Search all countries" autocomplete="off" spellcheck="false" aria-label="Search all countries">
      <div class="about-clist" id="aboutClist" role="listbox" aria-label="All countries">${countryListHtml('', choice)}</div>`
    : `<div class="about-opts${q.options.length > 5 ? ' many' : ''}">${q.options.map(([id, label, emoji]) => `<button type="button" class="about-opt${choice === id ? ' on' : ''}" data-q="${q.id}" data-v="${escapeHtml(id)}" aria-pressed="${choice === id}"><span class="about-emoji" aria-hidden="true">${emoji}</span><span>${escapeHtml(label)}</span></button>`).join('')}</div>`;
  return `<div class="about-qemoji" aria-hidden="true">${q.emoji}</div>
    <h3 class="about-ask" id="aboutTitle">${escapeHtml(q.ask)}</h3>
    <p class="about-hint">${escapeHtml(q.hint)}</p>
    ${body}`;
}

function thanksHtml(given) {
  const n = countAnswered(given);
  return `<div class="about-hero about-party" aria-hidden="true">🎉</div>
    <h3 class="about-ask" id="aboutTitle">${n ? 'Thank you — you’re all set!' : 'No problem — you’re all set!'}</h3>
    <p class="about-hint">${n ? 'That really helps us make Riskbook better for you.' : 'You can start right away.'} Next, a one-minute tour of the app.</p>
    <div class="about-err" id="aboutErr" role="alert"></div>
    <button type="button" class="about-cta" data-about-finish>Show me around <span aria-hidden="true">→</span></button>`;
}

/** One slide, its progress and its buttons. Exported for the tests. */
export function slideHtml(i, given = answers) {
  const q = ABOUT_QUESTIONS[i - 1];
  const inQuestions = i >= 1 && i <= ABOUT_QUESTIONS.length;
  const progress = inQuestions
    ? `<div class="about-top">
        <span class="about-step">Question ${i} of ${ABOUT_QUESTIONS.length}</span>
        <button type="button" class="about-x" data-about-skipall aria-label="Skip all the questions">Skip all</button>
      </div>
      <div class="about-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${ABOUT_QUESTIONS.length}" aria-valuenow="${i - 1}"><span style="width:${((i - 1) / ABOUT_QUESTIONS.length) * 100}%"></span></div>`
    : '';
  const foot = inQuestions
    ? `<div class="about-foot">
        <button type="button" class="about-back" data-about-back>‹ Back</button>
        <button type="button" class="about-skip" data-about-next>${given[q.id] ? 'Next ›' : 'Skip ›'}</button>
      </div>`
    : '';
  const body = i === 0 ? welcomeHtml() : i === LAST ? thanksHtml(given) : questionHtml(q, given);
  return `${progress}<div class="about-stage" data-about-stage>${body}</div>${foot}`;
}

function draw(direction = 0) {
  const card = el('aboutCard');
  card.innerHTML = slideHtml(at);
  card.dataset.slide = at === 0 ? 'welcome' : at === LAST ? 'thanks' : 'question';
  const stage = card.querySelector('.about-stage');
  if (direction) stage.classList.add(direction > 0 ? 'from-right' : 'from-left');
  // Keyboard users land on the first answer; on a phone the keyboard would cover the slide.
  if (window.matchMedia?.('(pointer:fine)').matches) card.querySelector('.about-opt.on, .about-opt, .about-cta')?.focus({ preventScroll: true });
}

function go(to) {
  const next = Math.max(0, Math.min(LAST, to));
  if (next === at) return;
  const direction = next > at ? 1 : -1;
  at = next;
  draw(direction);
}

/** A tapped answer shows as chosen for a moment, then the next question comes. */
function choose(id, value) {
  answers[id] = answers[id] === value ? undefined : value;
  const card = el('aboutCard');
  for (const b of card.querySelectorAll('[data-q], [data-country]')) {
    const on = (b.dataset.q ?? 'country') === id && (b.dataset.v ?? b.dataset.country) === answers[id];
    b.classList.toggle('on', on);
    b.setAttribute(b.getAttribute('role') === 'option' ? 'aria-selected' : 'aria-pressed', String(on));
  }
  if (!answers[id]) return;
  const here = at;
  setTimeout(() => { if (at === here) go(at + 1); }, 360);
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
    el('aboutErr').textContent = `${err.message} Try again in a moment.`;
    if (button) { button.disabled = false; button.innerHTML = 'Try again <span aria-hidden="true">→</span>'; }
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
    if (t('[data-about-skipall]')) { answers = at === 0 ? {} : answers; return go(LAST); }
    if (t('[data-about-finish]')) return finish();
    return undefined;
  });
  box.addEventListener('input', (e) => {
    if (e.target.id === 'aboutSearch') el('aboutClist').innerHTML = countryListHtml(e.target.value, answers.country);
  });
  box.addEventListener('keydown', (e) => {
    if (e.target.id === 'aboutSearch') return;
    if (e.key === 'ArrowRight' && at < LAST) go(at + 1);
    else if (e.key === 'ArrowLeft' && at > 0 && at < LAST) go(at - 1);
  });
  // Swiped, on a phone or with a mouse dragged across the card: left for the next, right for back.
  let startX = null;
  let startY = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.about-clist, .about-search')) return;
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

/** Every account is asked once, after its journal loads; with no server there is nowhere to keep the answers. */
onJournalLoaded(() => {
  if (state.aboutDone || !isUnlocked()) return;
  if (!cloudEnabled()) { setAboutDone(); return; }
  setTimeout(() => {
    if (!state.aboutDone && isUnlocked() && el('aboutYou')?.hidden) openAboutYou();
  }, 600);
});
