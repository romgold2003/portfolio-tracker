/**
 * Guest visits (November 2026): what a guest is told, and keeps seeing.
 *
 * Entering as a guest opens a sample portfolio (core/profiles.js, startGuest)
 * that is never saved. Saying so once is not enough for something this easy to
 * forget, so a notice says it plainly on the way in, and a slim bar stays at
 * the top for the whole visit with a way to create a real account. The
 * tutorial follows the notice.
 */
import { state, onJournalLoaded } from '../../core/store.js';
import { isGuest } from '../../core/profiles.js';
import { openTour } from './tour.js';
import { openCreateAccount } from './lockScreen.js';

const el = (id) => document.getElementById(id);

/** The notice on the way in. Exported for the tests. */
export function guestNoticeHtml() {
  return `<div class="guest-head"><span class="about-mark">RISKBOOK</span><span class="about-sec">Guest visit</span></div>
    <h3 class="guest-title" id="guestTitle">You are exploring as a guest</h3>
    <p class="guest-text">This is a sample portfolio, so you can see how Riskbook works. Try anything: add a trade, import a file, change the settings.</p>
    <div class="guest-warn" role="note"><b>Nothing is saved.</b> When you leave or reload the page, everything you did here is gone.</div>
    <p class="guest-text">To keep your own journal, create a free account — it takes a minute.</p>
    <div class="guest-actions">
      <button type="button" class="about-primary" data-guest-explore>Start exploring</button>
      <button type="button" class="about-secondary" data-guest-create>Create a free account</button>
    </div>`;
}

const barHtml = () => `<span><b>Guest mode</b> — nothing you do is saved.</span>
  <button type="button" class="guest-bar-btn" data-guest-create>Create a free account</button>`;

/** Leave the guest visit and open "Create an account". */
async function createAccount() {
  closeNotice();
  await window.signOut?.();
  openCreateAccount();
}

function closeNotice() {
  const notice = el('guestNotice');
  if (!notice || notice.hidden) return;
  notice.hidden = true;
  document.body.classList.remove('tour-open');
}

function ensureParts() {
  if (!el('guestBar')) {
    const bar = document.createElement('div');
    bar.id = 'guestBar';
    bar.className = 'guest-bar';
    bar.setAttribute('role', 'status');
    bar.hidden = true;
    bar.innerHTML = barHtml();
    bar.addEventListener('click', (e) => { if (e.target.closest('[data-guest-create]')) createAccount(); });
    document.body.prepend(bar);
  }
  if (!el('guestNotice')) {
    const notice = document.createElement('div');
    notice.id = 'guestNotice';
    notice.className = 'tour about guest-notice';
    notice.setAttribute('role', 'dialog');
    notice.setAttribute('aria-modal', 'true');
    notice.setAttribute('aria-labelledby', 'guestTitle');
    notice.hidden = true;
    notice.innerHTML = `<div class="tour-card about-card guest-card">${guestNoticeHtml()}</div>`;
    notice.addEventListener('click', (e) => {
      if (e.target.closest('[data-guest-create]')) { createAccount(); return; }
      if (e.target.closest('[data-guest-explore]')) {
        closeNotice();
        if (!state.tourSeen) setTimeout(openTour, 250);
      }
    });
    document.body.append(notice);
  }
}

/** Shown on the way in, and the bar for as long as the visit lasts. */
onJournalLoaded(() => {
  ensureParts();
  const guest = isGuest();
  el('guestBar').hidden = !guest;
  document.body.classList.toggle('is-guest', guest);
  if (!guest) { closeNotice(); return; }
  setTimeout(() => {
    if (!isGuest()) return;
    el('guestNotice').hidden = false;
    document.body.classList.add('tour-open');
    el('guestNotice').querySelector('[data-guest-explore]')?.focus();
  }, 400);
});
