/**
 * Referral, in a window of its own (November 2026).
 *
 * Opened from the profile and from Settings. One clear story: give a month,
 * get a month — a friend who joins with your code gets two free months
 * instead of one, and you get a free month when they pay their first month.
 * With the code, the invite link (and WhatsApp), what has been earned, and a
 * place to enter a friend's code.
 *
 * When a friend pays, the server keeps a congratulation (api/_lib/referrals.js)
 * and emails it; the app shows it once, here, the next time the member opens
 * Clavis, then marks it seen.
 */
import { social } from '../../services/social.js';
import { cloudMode, isGuest } from '../../core/profiles.js';
import { foxSvg } from '../art/fox.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);
const online = () => cloudMode() && !isGuest();

let referral = null;

const inviteLink = (code) => `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
const INVITE_TEXT = 'I track my investments with Clavis. Join with my link and get 2 months free instead of 1:';

/** Clavis, in white, handing a gift to a friend fox in orange. */
export function giftArt() {
  const sparkle = (x, y, r, c) => `<path d="M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z" fill="${c}"/>`;
  return `<svg class="ref-art" viewBox="0 0 360 170" aria-hidden="true">
    <defs><linearGradient id="refBox" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F59E0B"/><stop offset="1" stop-color="#F26A1E"/></linearGradient></defs>
    <g transform="translate(18 44)">${foxSvg(104, { line: '#F5F7FA' })}</g>
    <g transform="translate(238 52)">${foxSvg(96, { line: '#F59E0B' })}</g>
    <path d="M120 70 C 150 22 210 22 240 64" fill="none" stroke="#3A4456" stroke-width="2.5" stroke-dasharray="2 8" stroke-linecap="round"/>
    <g transform="translate(158 54) rotate(-8)">
      <rect x="0" y="16" width="44" height="34" rx="5" fill="url(#refBox)"/>
      <rect x="-3" y="8" width="50" height="12" rx="3" fill="#F7882A"/>
      <rect x="19" y="8" width="7" height="42" fill="#F5F7FA"/>
      <path d="M22 8 C 14 -4 2 0 8 7 Z M23 8 C 31 -4 43 0 37 7 Z" fill="#F5F7FA"/>
    </g>
    ${sparkle(150, 30, 7, '#F59E0B')}${sparkle(222, 24, 5, '#F5F7FA')}${sparkle(196, 128, 6, '#F59E0B')}
  </svg>`;
}

const STEPS = [
  ['Share your link or code', 'Send it to a friend: WhatsApp, a message, anything.'],
  ['Your friend gets 2 months free', 'Instead of the usual 1, as soon as they join with your code.'],
  ['You get a free month', 'When they pay for their first month. We tell you by email and in the app.'],
];

export function referralHtml(r) {
  if (!online()) {
    return `${giftArt()}<h2 class="ref-title">Give a month, get a month</h2>
      <p class="ref-lead">Referrals need a Clavis account. Create a free account to get your own code.</p>`;
  }
  if (!r) return `${giftArt()}<p class="ref-lead">Loading your code…</p>`;
  return `${giftArt()}
    <h2 class="ref-title">Give a month, get a month</h2>
    <ol class="ref-steps">${STEPS.map(([t, s], i) => `<li><span class="ref-n">${i + 1}</span><span><b>${t}</b><span>${s}</span></span></li>`).join('')}</ol>
    <div class="ref-code"><span>Your code</span><b>${escapeHtml(r.code)}</b><button type="button" class="pf-mini" data-ref-copy>Copy</button></div>
    <div class="ref-share">
      <button type="button" class="pf-save" data-ref-share>Share my invite link</button>
      <a class="ref-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${INVITE_TEXT} ${inviteLink(r.code)}`)}">WhatsApp</a>
    </div>
    <div class="pf-stats">
      <div><b>${r.joined}</b><span>friends joined</span></div>
      <div><b>${r.paid}</b><span>subscribed</span></div>
      <div><b>${r.freeMonths}</b><span>free month${r.freeMonths === 1 ? '' : 's'} earned</span></div>
      <div><b>${r.leftThisYear ?? '—'}</b><span>left this year</span></div>
    </div>
    ${r.canRedeem ? `<div class="ref-redeem-t">Got a code from a friend?</div><div class="pf-redeem"><input type="text" id="refRedeem" maxlength="16" autocomplete="off" placeholder="Their code"><button type="button" class="pf-mini" data-ref-redeem>Apply</button></div>`
    : r.referred ? '<p class="ref-small">A friend’s code is linked to your account.</p>' : ''}
    <p class="ref-small">One free month for each friend who subscribes, up to ${r.yearlyCap ?? 6} a year. Your own code, or a second account of yours, does not count. Free months apply once paid plans start.</p>`;
}

function note(text, bad = false) {
  const n = el('refNote');
  if (!n) return;
  n.textContent = text;
  n.classList.toggle('bad', bad);
}

function draw() {
  const body = el('refBody');
  if (body) body.innerHTML = referralHtml(referral);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  const modal = el('referralModal');
  modal.addEventListener('click', async (e) => {
    if (e.target === modal || e.target.closest('[data-ref-close]')) return closeReferral();
    if (!referral) return;
    if (e.target.closest('[data-ref-copy]')) note(await copy(referral.code) ? 'Code copied.' : referral.code);
    if (e.target.closest('[data-ref-share]')) {
      const url = inviteLink(referral.code);
      if (navigator.share) {
        try { await navigator.share({ title: 'Clavis', text: INVITE_TEXT, url }); return; } catch { /* closed: copy instead */ }
      }
      note(await copy(url) ? 'Invite link copied.' : url);
    }
    if (e.target.closest('[data-ref-redeem]')) {
      const code = el('refRedeem')?.value.trim();
      if (!code) return note('Type the code first.', true);
      try {
        await social.redeem(code);
        referral = await social.referral();
        draw();
        note('Code linked: you have a free month. Thank your friend!');
      } catch (err) {
        note(err.message || String(err), true);
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('referralModal').hidden) closeReferral();
  });
}

export async function openReferral() {
  const modal = el('referralModal');
  if (!modal) return;
  bind();
  note('');
  modal.hidden = false;
  draw();
  if (!online()) return;
  try {
    referral = await social.referral();
    draw();
  } catch (err) {
    note(err.message || 'Could not load your code just now.', true);
  }
}

export function closeReferral() {
  const modal = el('referralModal');
  if (modal) modal.hidden = true;
}

/* ── The congratulations, shown once when a friend has paid ── */

export function congratsHtml(notices) {
  const names = notices.map((n) => n.friend).filter(Boolean);
  const months = notices.reduce((sum, n) => sum + (n.months || 0), 0);
  const who = names.length === 0 ? 'A friend you invited'
    : names.length === 1 ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const verb = notices.length === 1 ? 'has just paid for their first month' : 'have just paid for their first month';
  return `${giftArt()}
    <h2 class="ref-title">Congratulations!</h2>
    <p class="ref-lead"><b>${escapeHtml(who)}</b> ${verb} with your code. You get <b>${months === 1 ? 'a free month' : `${months} free months`}</b> of Clavis.</p>
    <button type="button" class="pf-save" data-ref-thanks>Thank you!</button>`;
}

/** After signing in: any congratulations waiting are shown, then marked seen. */
export async function checkReferralNews() {
  if (!online()) return;
  try {
    const r = await social.referral();
    if (!r?.notices?.length) return;
    const modal = el('referralModal');
    const body = el('refBody');
    if (!modal || !body) return;
    bind();
    body.innerHTML = congratsHtml(r.notices);
    note('');
    modal.hidden = false;
    body.querySelector('[data-ref-thanks]')?.addEventListener('click', closeReferral, { once: true });
    await social.referralSeen();
  } catch { /* next time */ }
}
