/**
 * The profile button (November 2026): bottom left of the menu, where the
 * account's name was. Pressing it opens one panel with everything about the
 * account itself: who is signed in and which sub-account is open, importing
 * files and the settings, what friends can see, changing the password, and
 * signing out.
 *
 * The pieces it shows already lived elsewhere: the sub-account switcher
 * (views/accounts.js) and the sign-out row are moved inside it in index.html;
 * what friends see is the same choice as on the Friends page; the password is
 * changed with core/profiles.js setPassword, which re-wraps the journal's key
 * without re-encrypting anything.
 */
import { currentProfile, setPassword, isGuest, cloudMode } from '../../core/profiles.js';
import { social, setShowing, knowShowing } from '../../services/social.js';
import { SHOW_CHOICES } from './friends.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);

let shareMode = null;

/** Friends need an account on the server: not a guest, not the local-only build. */
const online = () => cloudMode() && !isGuest();

function shareHtml() {
  if (!online()) {
    return `<p class="pf-note">${isGuest()
      ? 'Create a free account to add friends and choose what they see.'
      : 'Friends need a Clavis account in the cloud version.'}</p>`;
  }
  if (shareMode == null) return '<p class="pf-note">Loading…</p>';
  return SHOW_CHOICES.map((c) => `<label class="pf-choice${shareMode === c.mode ? ' on' : ''}">
      <input type="radio" name="pfShare" value="${c.mode}"${shareMode === c.mode ? ' checked' : ''}>
      <span><b>${escapeHtml(c.title)}</b><span>${escapeHtml(c.text)}</span></span>
    </label>`).join('');
}

function drawShare() {
  const host = el('profileShare');
  if (host) host.innerHTML = shareHtml();
}

/* ── Invite friends: the member's referral code, for life ── */

let referral = null;

const inviteLink = (code) => `${window.location.origin}/?ref=${encodeURIComponent(code)}`;

export function inviteHtml(r, guest = false) {
  if (guest) return '<p class="pf-note">Create a free account to get your own referral code.</p>';
  if (!r) return '<p class="pf-note">Loading…</p>';
  const months = r.rewardMonths ?? 2;
  return `<p class="pf-note">When a friend joins with your code and pays for their first month, you get <b>${months} months free</b>. Your code is yours for life.</p>
    <div class="pf-code"><span>Your code</span><b>${escapeHtml(r.code)}</b><button type="button" class="pf-mini" data-copy-code>Copy</button></div>
    <button type="button" class="pf-save pf-share" data-share-link>Share my invite link</button>
    <div class="pf-stats">
      <div><b>${r.joined}</b><span>joined</span></div>
      <div><b>${r.paid}</b><span>subscribed</span></div>
      <div><b>${r.freeMonths}</b><span>free month${r.freeMonths === 1 ? '' : 's'} earned</span></div>
    </div>
    ${r.canRedeem ? `<div class="pf-redeem"><input type="text" id="pfRedeem" maxlength="16" autocomplete="off" placeholder="Got a code from a friend?"><button type="button" class="pf-mini" data-redeem>Apply</button></div>`
    : r.referred ? '<p class="pf-note">A friend’s code is linked to your account.</p>' : ''}`;
}

function drawInvite() {
  const host = el('profileInvite');
  if (host) host.innerHTML = inviteHtml(referral, !online());
}

async function loadInvite() {
  drawInvite();
  if (!online()) return;
  try {
    referral = await social.referral();
  } catch (err) {
    const host = el('profileInvite');
    if (host) host.innerHTML = '';
    note('pfInviteNote', err.message || 'Could not load your code just now.', true);
    return;
  }
  drawInvite();
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

async function inviteClick(e) {
  if (!referral) return;
  if (e.target.closest('[data-copy-code]')) {
    note('pfInviteNote', await copy(referral.code) ? 'Code copied.' : referral.code);
  }
  if (e.target.closest('[data-share-link]')) {
    const url = inviteLink(referral.code);
    const text = 'I track my investments with Clavis. Join with my code and get your first month free.';
    if (navigator.share) {
      try { await navigator.share({ title: 'Clavis', text, url }); return; } catch { /* closed: fall back to copying */ }
    }
    note('pfInviteNote', await copy(url) ? 'Invite link copied.' : url);
  }
  if (e.target.closest('[data-redeem]')) {
    const code = el('pfRedeem')?.value.trim();
    if (!code) return note('pfInviteNote', 'Type the code first.', true);
    try {
      await social.redeem(code);
      note('pfInviteNote', 'Code linked. Thank your friend!');
      referral = await social.referral();
      drawInvite();
    } catch (err) {
      note('pfInviteNote', err.message || String(err), true);
    }
  }
}

async function loadShare() {
  if (!online()) return drawShare();
  drawShare();
  try {
    const data = await social.friends();
    shareMode = data.share?.mode ?? 'none';
    knowShowing(shareMode);
  } catch {
    shareMode = shareMode ?? 'none';
  }
  drawShare();
}

function note(id, text, bad = false) {
  const n = el(id);
  if (!n) return;
  n.textContent = text;
  n.classList.toggle('bad', bad);
}

async function savePassword() {
  const a = el('pfPass')?.value ?? '';
  const b = el('pfPass2')?.value ?? '';
  if (a.length < 8) return note('pfPassNote', 'At least 8 characters.', true);
  if (a !== b) return note('pfPassNote', 'The two passwords are not the same.', true);
  const button = el('pfPassSave');
  if (button) button.disabled = true;
  try {
    await setPassword(a);
    el('pfPass').value = '';
    el('pfPass2').value = '';
    note('pfPassNote', 'Password changed. Use it next time you sign in.');
  } catch (err) {
    note('pfPassNote', err.message || String(err), true);
  } finally {
    if (button) button.disabled = false;
  }
}

let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  const pop = el('profilePop');
  pop.addEventListener('click', (e) => {
    if (e.target === pop) closeProfile();
    if (e.target.closest('#profileInvite')) inviteClick(e);
  });
  pop.addEventListener('change', async (e) => {
    if (e.target.name !== 'pfShare') return;
    const mode = e.target.value;
    const before = shareMode;
    shareMode = mode;
    drawShare();
    note('pfShareNote', 'Saving…');
    try {
      await setShowing(mode);
      note('pfShareNote', 'Saved.');
    } catch (err) {
      shareMode = before;
      drawShare();
      note('pfShareNote', err.message || String(err), true);
    }
  });
  el('pfPassToggle')?.addEventListener('click', () => {
    const form = el('pfPassForm');
    form.hidden = !form.hidden;
    if (!form.hidden) el('pfPass')?.focus();
  });
  el('pfPassSave')?.addEventListener('click', savePassword);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('profilePop').hidden) closeProfile();
  });
}

export function openProfile() {
  const pop = el('profilePop');
  if (!pop) return;
  bind();
  // On a phone the button lives in the More sheet: that closes first.
  window.toggleTools?.(false);
  const email = currentProfile()?.email ?? '';
  el('pfEmail').textContent = isGuest() ? 'Guest visit' : email;
  el('pfAvatar').textContent = el('acctAvatar')?.textContent ?? '·';
  // A guest has no password to change.
  el('pfSecurity').hidden = isGuest();
  el('pfPassForm').hidden = true;
  note('pfPassNote', '');
  note('pfShareNote', '');
  note('pfInviteNote', '');
  pop.hidden = false;
  document.body.classList.add('profile-open');
  el('profileBtn')?.setAttribute('aria-expanded', 'true');
  loadShare();
  loadInvite();
}

export function closeProfile() {
  const pop = el('profilePop');
  if (!pop) return;
  pop.hidden = true;
  document.body.classList.remove('profile-open');
  el('profileBtn')?.setAttribute('aria-expanded', 'false');
}

/** From the panel to one of the app's own windows: the panel steps aside first. */
export function profileGo(where) {
  closeProfile();
  window.toggleTools?.(false);
  if (where === 'import') { window.openSettings?.(); window.openYearsPanel?.(); }
  if (where === 'settings') window.openSettings?.();
}
