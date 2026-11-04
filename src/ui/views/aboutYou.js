/**
 * "About you" (November 2026): eight quick questions a new account is asked
 * once, right after signing up — sex, age, goal, experience, style, country,
 * how they heard of Riskbook, and what they do — so Romy can see who uses it.
 *
 * Every question is optional and one tap each; the country opens a small
 * window of every country, searchable. Skip asks nothing. Either way the
 * window does not come back, and the tutorial follows it.
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
let answers = {};

const countryLabel = (code) => (code ? `${flagOf(code)} ${escapeHtml(countryName(code))}` : 'Choose your country');

/** The whole window. Exported for the tests. */
export function aboutHtml(given = answers) {
  const questions = ABOUT_QUESTIONS.map((q) => {
    const body = q.country
      ? `<button type="button" class="about-country${given.country ? ' on' : ''}" data-country-open aria-haspopup="dialog">${countryLabel(given.country)}<span aria-hidden="true">▾</span></button>`
      : `<div class="about-chips">${q.options.map(([id, label]) => `<button type="button" class="about-chip${given[q.id] === id ? ' on' : ''}" data-q="${q.id}" data-v="${escapeHtml(id)}" aria-pressed="${given[q.id] === id}">${escapeHtml(label)}</button>`).join('')}</div>`;
    return `<fieldset class="about-q"><legend>${escapeHtml(q.title)}</legend>${body}</fieldset>`;
  }).join('');
  return `<div class="about-head">
      <h3 id="aboutTitle">Welcome to Riskbook! A little about you</h3>
      <p>${ABOUT_QUESTIONS.length} quick questions, all optional. They help us build Riskbook for people like you. Nobody else sees your answers, and your portfolio stays encrypted.</p>
    </div>
    <div class="about-body">${questions}</div>
    <div class="about-err" id="aboutErr" role="alert"></div>
    <div class="about-foot">
      <span class="about-count" id="aboutCount">${countAnswered(given)} of ${ABOUT_QUESTIONS.length} answered</span>
      <button type="button" class="about-skip" data-about-skip>Skip</button>
      <button type="button" class="about-done" data-about-save>Continue</button>
    </div>
    <div class="about-pick" id="aboutPick" hidden></div>`;
}

const countAnswered = (given) => ABOUT_QUESTIONS.filter((q) => given[q.id]).length;

/** The country window's list: suggested first, then every country A to Z, narrowed by the search. Exported for the tests. */
export function countryListHtml(query = '', chosen = null) {
  const q = query.trim().toLowerCase();
  const all = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const match = ({ code, name }) => !q || name.toLowerCase().includes(q) || code.toLowerCase() === q;
  const row = ({ code, name }) => `<button type="button" class="about-crow${code === chosen ? ' on' : ''}" data-country="${code}" role="option" aria-selected="${code === chosen}"><span class="about-flag" aria-hidden="true">${flagOf(code)}</span>${escapeHtml(name)}</button>`;
  const found = all.filter(match);
  const common = q ? [] : COMMON_COUNTRIES.map((code) => all.find((c) => c.code === code)).filter(Boolean);
  if (!found.length) return `<p class="about-none">No country called “${escapeHtml(query.trim())}”.</p>`;
  return `${common.length ? `<div class="about-ctitle">Suggested</div>${common.map(row).join('')}<div class="about-ctitle">All countries</div>` : ''}${found.map(row).join('')}`;
}

function openCountries() {
  const pick = el('aboutPick');
  pick.innerHTML = `<div class="about-pcard" role="dialog" aria-label="Choose your country">
      <div class="about-phead"><b>Where do you live?</b><button type="button" class="about-pclose" data-country-close aria-label="Close">×</button></div>
      <input type="text" class="about-search" id="aboutSearch" placeholder="Search a country" autocomplete="off" spellcheck="false" aria-label="Search a country">
      <div class="about-clist" id="aboutClist" role="listbox">${countryListHtml('', answers.country)}</div>
    </div>`;
  pick.hidden = false;
  if (window.matchMedia?.('(pointer:fine)').matches) el('aboutSearch').focus();
}

function closeCountries() {
  const pick = el('aboutPick');
  if (pick) pick.hidden = true;
}

function redrawCount() {
  el('aboutCount').textContent = `${countAnswered(answers)} of ${ABOUT_QUESTIONS.length} answered`;
}

function finish() {
  setAboutDone();
  const box = el('aboutYou');
  box.hidden = true;
  document.body.classList.remove('tour-open');
  // The tutorial comes next for a new account.
  if (!state.tourSeen) setTimeout(openTour, 250);
}

async function save() {
  const button = el('aboutYou').querySelector('[data-about-save]');
  if (!countAnswered(answers)) return finish();
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await social.about(answers);
    finish();
  } catch (err) {
    el('aboutErr').textContent = `${err.message} You can try again, or skip.`;
    button.disabled = false;
    button.textContent = 'Continue';
  }
}

function bind(box) {
  if (box.dataset.bound === '1') return;
  box.dataset.bound = '1';
  box.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t('[data-q]')) {
      const b = t('[data-q]');
      const { q, v } = b.dataset;
      answers[q] = answers[q] === v ? undefined : v;
      for (const chip of box.querySelectorAll(`[data-q="${q}"]`)) {
        const on = answers[q] === chip.dataset.v;
        chip.classList.toggle('on', on);
        chip.setAttribute('aria-pressed', String(on));
      }
      return redrawCount();
    }
    if (t('[data-country-open]')) return openCountries();
    if (t('[data-country-close]') || e.target.id === 'aboutPick') return closeCountries();
    if (t('[data-country]')) {
      answers.country = t('[data-country]').dataset.country;
      const button = box.querySelector('[data-country-open]');
      button.innerHTML = `${countryLabel(answers.country)}<span aria-hidden="true">▾</span>`;
      button.classList.add('on');
      closeCountries();
      return redrawCount();
    }
    if (t('[data-about-skip]')) return finish();
    if (t('[data-about-save]')) return save();
    return undefined;
  });
  box.addEventListener('input', (e) => {
    if (e.target.id === 'aboutSearch') el('aboutClist').innerHTML = countryListHtml(e.target.value, answers.country);
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('aboutPick').hidden) { e.preventDefault(); e.stopPropagation(); closeCountries(); }
  });
}

export function openAboutYou() {
  const box = el('aboutYou');
  if (!box) return;
  answers = {};
  el('aboutCard').innerHTML = aboutHtml(answers);
  bind(box);
  box.hidden = false;
  document.body.classList.add('tour-open');
}

/** A new account is asked once, after its journal loads; with no server there is nowhere to keep the answers. */
onJournalLoaded(() => {
  if (!state.aboutPending || !isUnlocked()) return;
  if (!cloudEnabled()) { setAboutDone(); return; }
  setTimeout(() => {
    if (state.aboutPending && isUnlocked() && el('aboutYou')?.hidden) openAboutYou();
  }, 600);
});
