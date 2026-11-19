/**
 * Clavis Free and Clavis Pro in the app (November 2026).
 *
 * The plan comes from the server (api/_lib/billing.js). On Free, body gets
 * `plan-free`: the Pro pages show a lock screen in place of their content,
 * the menu marks them PRO, and fear & greed, daily returns and extra
 * sub-accounts are hidden. Guests (the demo) and the offline file see
 * everything.
 *
 * The plan window is the subscription screen: your plan, the Free/Pro table,
 * monthly or yearly, Upgrade, and for a paid plan its renewal date with
 * Cancel (Pro stays to the end of the period) or Resume. Money is never next
 * to the fox, by the brand brief: the window carries the logo.
 */
import { social } from '../../services/social.js';
import { cloudMode, isGuest } from '../../core/profiles.js';
import { FEATURES, PRO_PAGES, PRICES, money } from '../../config/plans.js';
import { logoSvg } from '../art/logo.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);

let plan = null;
let cadence = 'yearly';
let confirming = false;

const signedIn = () => cloudMode() && !isGuest();
export const isPro = () => !plan || plan.plan === 'pro';

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** One line on what plan this is and until when. */
export function planLine(p) {
  if (!p) return '';
  if (p.reason === 'subscription') {
    return p.subscription?.cancelAtPeriodEnd
      ? `Pro until ${day(p.subscription.periodEnd)}, then Free`
      : `Pro · renews ${day(p.subscription?.periodEnd)}`;
  }
  if (p.reason === 'trial') return `Pro free trial · until ${day(p.trialEndsAt)}`;
  if (p.reason === 'early-access') return 'Pro · free for early members';
  if (p.reason === 'admin') return 'Pro · admin';
  return 'Free plan';
}

/* ── Where the plan shows: the button under the profile, and the body class ── */

function apply() {
  const free = signedIn() && plan?.plan === 'free';
  document.body.classList.toggle('plan-free', free);
  const btn = el('planBtn');
  if (btn) {
    btn.hidden = !signedIn() || !plan;
    const paying = plan?.reason === 'subscription';
    btn.querySelector('.plan-txt > b').textContent = plan?.plan === 'free' ? 'Upgrade to Pro' : 'Clavis Pro';
    btn.querySelector('.plan-txt > span').textContent = plan?.plan === 'free' ? `From ${money(PRICES.monthly)} a month` : planLine(plan);
    btn.classList.toggle('is-free', plan?.plan === 'free');
  }
  const line = el('pfPlanLine');
  if (line) line.textContent = planLine(plan);
}

/** After signing in (and on sign-out, with nothing): ask the server which plan this is. */
export async function loadPlan() {
  plan = null;
  if (!signedIn()) { apply(); return; }
  try { plan = await social.plan(); } catch { plan = null; }
  apply();
}

/* ── The locked pages ── */

export function paywallHtml(page) {
  const [title, what] = PRO_PAGES[page];
  return `<div class="paywall-card">
      <span class="paywall-badge">${logoSvg(18)} PRO</span>
      <h2>${escapeHtml(title)} is part of Clavis Pro</h2>
      <p>${escapeHtml(what)}</p>
      <ul>${FEATURES.filter(([, free, pro]) => pro && !free).slice(0, 4).map(([t]) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      <button type="button" class="pf-save" onclick="openPlans()">Unlock with Pro · ${money(PRICES.monthly)} a month</button>
      <div class="paywall-small">or ${money(PRICES.yearly)} a year. Cancel anytime.</div>
    </div>`;
}

/** The lock screens go in once; CSS shows them only on Free. */
export function installPaywalls() {
  for (const page of Object.keys(PRO_PAGES)) {
    const host = el(page);
    if (!host || host.querySelector('.paywall')) continue;
    host.classList.add('pro-page');
    const wall = document.createElement('div');
    wall.className = 'paywall';
    wall.innerHTML = paywallHtml(page);
    const top = host.querySelector('.topbar');
    if (top) top.after(wall); else host.prepend(wall);
  }
  // Daily returns on Free: the button opens the plans instead.
  el('dailyLogBtn')?.addEventListener('click', (e) => {
    if (!document.body.classList.contains('plan-free')) return;
    e.stopImmediatePropagation();
    openPlans();
  }, true);
}

/* ── The plan window ── */

export function compareHtml() {
  const tick = (on) => (on ? '<span class="cmp-yes" aria-label="Included">✓</span>' : '<span class="cmp-no" aria-label="Not included">—</span>');
  return `<table class="cmp">
      <thead><tr><th></th><th>Free</th><th class="cmp-pro">Pro</th></tr></thead>
      <tbody>${FEATURES.map(([t, free, pro]) => `<tr><td>${escapeHtml(t)}</td><td>${tick(free)}</td><td class="cmp-pro">${tick(pro)}</td></tr>`).join('')}</tbody>
    </table>`;
}

function plansHtml() {
  const p = plan;
  const paying = p?.reason === 'subscription';
  const sub = p?.subscription;
  const head = `<div class="pl-head">${logoSvg(30)}<div><div class="pl-title">Your plan</div><div class="pl-now">${escapeHtml(planLine(p) || 'Clavis')}</div></div></div>`;

  if (paying && confirming) {
    return `${head}<h3 class="pl-q">Cancel your subscription?</h3>
      <p class="pl-p">You keep Pro until <b>${day(sub.periodEnd)}</b>. Then your account moves to Free: Home, Positions, New trade, import and Friends stay. Nothing you added is deleted, and you can come back anytime.</p>
      <div class="pl-row"><button type="button" class="pl-ghost" data-pl-keep>Keep Pro</button><button type="button" class="pl-danger" data-pl-cancel>Cancel subscription</button></div>`;
  }
  const manage = paying
    ? `<div class="pl-sub"><div><b>Clavis Pro · ${sub.cadence === 'yearly' ? `${money(PRICES.yearly)} a year` : `${money(PRICES.monthly)} a month`}</b>
        <span>${sub.cancelAtPeriodEnd ? `Ends on ${day(sub.periodEnd)}. You will not be charged again.` : `Renews on ${day(sub.periodEnd)}.`}</span></div>
        ${sub.cancelAtPeriodEnd ? '<button type="button" class="pf-save" data-pl-resume>Keep my subscription</button>' : '<button type="button" class="pl-link" data-pl-ask>Cancel subscription</button>'}</div>`
    : `<div class="pl-cad" role="radiogroup" aria-label="How often to pay">
        <button type="button" class="${cadence === 'monthly' ? 'on' : ''}" data-pl-cad="monthly"><b>${money(PRICES.monthly)}</b><span>per month</span></button>
        <button type="button" class="${cadence === 'yearly' ? 'on' : ''}" data-pl-cad="yearly"><em>Save ${money(PRICES.monthly * 12 - PRICES.yearly)}</em><b>${money(PRICES.yearly)}</b><span>per year</span></button>
      </div>
      <button type="button" class="pf-save pl-up" data-pl-upgrade>${p?.plan === 'pro' ? 'Choose Pro for after my free period' : 'Upgrade to Pro'}</button>
      <p class="pl-small">Cancel anytime: you keep Pro until the end of the period you paid for.</p>`;
  return `${head}${manage}${compareHtml()}`;
}

function draw() {
  const body = el('plansBody');
  if (body) body.innerHTML = plansHtml();
}

function note(text, bad = false) {
  const n = el('plansNote');
  if (!n) return;
  n.textContent = text;
  n.classList.toggle('bad', bad);
}

let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  const modal = el('plansModal');
  modal.addEventListener('click', async (e) => {
    if (e.target === modal || e.target.closest('[data-pl-close]')) return closePlans();
    const cad = e.target.closest('[data-pl-cad]');
    if (cad) { cadence = cad.dataset.plCad; return draw(); }
    if (e.target.closest('[data-pl-ask]')) { confirming = true; return draw(); }
    if (e.target.closest('[data-pl-keep]')) { confirming = false; return draw(); }
    try {
      if (e.target.closest('[data-pl-upgrade]')) {
        if (!signedIn()) return note('Create a free account first, then choose Pro.');
        const out = await social.checkout(cadence);
        if (out.available && out.url) { window.location.href = out.url; return; }
        return note(out.message || 'Payments open soon.');
      }
      if (e.target.closest('[data-pl-cancel]')) {
        plan = await social.cancelPlan();
        confirming = false;
        apply(); draw();
        return note('Subscription cancelled. You keep Pro until the end of the period.');
      }
      if (e.target.closest('[data-pl-resume]')) {
        plan = await social.resumePlan();
        apply(); draw();
        return note('Your subscription continues.');
      }
    } catch (err) {
      note(err.message || String(err), true);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('plansModal').hidden) closePlans();
  });
}

export async function openPlans() {
  const modal = el('plansModal');
  if (!modal) return;
  bind();
  confirming = false;
  note('');
  window.closeProfile?.();
  window.toggleTools?.(false);
  modal.hidden = false;
  draw();
  if (signedIn()) {
    try { plan = await social.plan(); apply(); draw(); } catch { /* keep what we had */ }
  }
}

export function closePlans() {
  const modal = el('plansModal');
  if (modal) modal.hidden = true;
}
