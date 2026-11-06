/**
 * Accepting the Terms of Service and Privacy Policy (November 2026).
 *
 * A new account agrees at sign-up (lockScreen.js). An account made before the
 * documents existed — or behind a newer version (config/legal.js) — is shown
 * this screen at its next sign-in and cannot use the app until it accepts or
 * signs out. The agreement box is required and never pre-ticked; news emails
 * are a separate, optional box. Acceptance is recorded on the server with its
 * version and time (api/_lib/consent.js) and kept in the journal, so the
 * account is not asked again. The investor-profile questions and the tutorial
 * wait for it.
 */
import {
  state, onJournalLoaded, legalDue, setLegalAccepted, aboutDue,
} from '../../core/store.js';
import { isUnlocked, isGuest } from '../../core/profiles.js';
import { cloudEnabled } from '../../services/cloud.js';
import { social } from '../../services/social.js';
import { LEGAL_VERSION, TERMS_URL, PRIVACY_URL } from '../../config/legal.js';
import { openAboutYou } from './aboutYou.js';
import { openTour } from './tour.js';

const el = (id) => document.getElementById(id);

/** The screen. Exported for the tests. */
export function legalGateHtml() {
  return `<div class="guest-head"><span class="about-mark">RISKBOOK</span><span class="about-sec">Terms and privacy</span></div>
    <h3 class="guest-title" id="legalTitle">Our Terms of Service and Privacy Policy</h3>
    <p class="guest-text">To keep using Riskbook, please read and accept our <a href="${TERMS_URL}" target="_blank" rel="noopener">Terms of Service</a> and <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy Policy</a>. In short:</p>
    <ul class="legal-points">
      <li>Riskbook is a <b>tracking and journal tool</b>. It is not a broker or adviser, and nothing in it is investment advice.</li>
      <li>Your journal stays <b>encrypted</b>: we cannot read it. We never sell your information.</li>
      <li>Riskbook is for people <b>18 and over</b>.</li>
    </ul>
    <label class="legal-check"><input type="checkbox" id="legalAgree"><span>I am 18 or older and I agree to the <a href="${TERMS_URL}" target="_blank" rel="noopener">Terms of Service</a> and the <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>
    <label class="legal-check legal-opt"><input type="checkbox" id="legalMarketing"><span>Email me news and tips about Riskbook (optional — unsubscribe any time).</span></label>
    <div class="about-err" id="legalErr" role="alert"></div>
    <div class="guest-actions">
      <button type="button" class="about-primary" data-legal-accept disabled>Accept and continue</button>
      <button type="button" class="about-secondary" data-legal-signout>Sign out</button>
    </div>`;
}

function close() {
  const gate = el('legalGate');
  if (!gate || gate.hidden) return;
  gate.hidden = true;
  document.body.classList.remove('tour-open');
}

/** After accepting: the investor profile if it is due, else the tutorial if unseen. */
function carryOn() {
  if (cloudEnabled() && aboutDue()) setTimeout(openAboutYou, 250);
  else if (!state.tourSeen) setTimeout(openTour, 250);
}

async function accept() {
  const button = el('legalGate').querySelector('[data-legal-accept]');
  if (!el('legalAgree')?.checked) return;
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    // The proof lives on the server; without one (a local journal) the journal's record is all there is.
    if (cloudEnabled()) await social.accept(LEGAL_VERSION, Boolean(el('legalMarketing')?.checked));
    setLegalAccepted();
    close();
    carryOn();
  } catch (err) {
    el('legalErr').textContent = `${err.message} Please try again.`;
    button.disabled = false;
    button.textContent = 'Accept and continue';
  }
}

function ensureGate() {
  if (el('legalGate')) return el('legalGate');
  const gate = document.createElement('div');
  gate.id = 'legalGate';
  gate.className = 'tour about legal-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'legalTitle');
  gate.hidden = true;
  gate.innerHTML = `<div class="tour-card about-card guest-card">${legalGateHtml()}</div>`;
  gate.addEventListener('change', (e) => {
    if (e.target.id === 'legalAgree') gate.querySelector('[data-legal-accept]').disabled = !e.target.checked;
  });
  gate.addEventListener('click', (e) => {
    if (e.target.closest('[data-legal-accept]')) accept();
    if (e.target.closest('[data-legal-signout]')) { close(); window.signOut?.(); }
  });
  document.body.append(gate);
  return gate;
}

/** Asked at sign-in when the account has not accepted the current version; guests agree by entering. */
onJournalLoaded(() => {
  if (!isUnlocked() || isGuest() || !legalDue()) { close(); return; }
  const gate = ensureGate();
  gate.hidden = false;
  document.body.classList.add('tour-open');
});
