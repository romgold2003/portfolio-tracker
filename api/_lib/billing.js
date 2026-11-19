/**
 * Plans: Clavis Free and Clavis Pro (November 2026).
 *
 * Free: Home, Positions, New trade, import, Friends, and the year against the
 * S&P 500 as a single figure. Pro adds Clavis Insights, Monthly, daily
 * returns, News, Crypto, fear & greed and several sub-accounts. Every new
 * member starts with a month of Pro free; after it, Free unless they subscribe.
 *
 * Payments are not connected yet. Until PLANS_ENFORCED=1 is set on the
 * deployment, every member has Pro ("early access"), so nobody loses pages
 * they have no way to pay for. The payment provider's webhook will call
 * activateSubscription() and endSubscription(); cancelling here keeps Pro to
 * the end of the period already paid, as subscription apps do.
 */
import { query, one, driverGeneration } from './db.js';
import { isAdmin } from './admin.js';

export const TRIAL_DAYS = 30;
export const PRICES = { monthly: 3.5, yearly: 35 };
const DAY = 86400000;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS subscriptions (
     user_id              TEXT PRIMARY KEY,
     status               TEXT NOT NULL,
     cadence              TEXT,
     current_period_end   TEXT,
     cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
     updated_at           TEXT NOT NULL
   )`,
];

let readyFor = -1;
async function ensureTables() {
  if (readyFor === driverGeneration()) return;
  for (const statement of TABLES) await query(statement, []);
  readyFor = driverGeneration();
}

const now = () => new Date().toISOString();

export class BillingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Whether the deployment charges yet: plans are only enforced once payments are live. */
export const plansEnforced = () => process.env.PLANS_ENFORCED === '1';

async function subscriptionOf(userId) {
  await ensureTables();
  return one('SELECT * FROM subscriptions WHERE user_id = $1', [userId]);
}

/** A subscription that still gives Pro: active, or cancelled but paid until a date still ahead. */
function subscriptionGivesPro(sub, at = Date.now()) {
  if (!sub) return false;
  if (sub.status === 'active') return true;
  return sub.status === 'canceled' && Date.parse(sub.current_period_end ?? '') > at;
}

/**
 * The plan this member has right now, and why: what the app shows and locks.
 * `user` is the signed-in row (id, email, created_at).
 */
export async function planOf(user, at = Date.now()) {
  const sub = await subscriptionOf(user.id);
  const created = Date.parse(user.created_at ?? user.createdAt ?? '');
  const trialEnds = Number.isFinite(created) ? new Date(created + TRIAL_DAYS * DAY).toISOString() : null;
  const subscription = sub ? {
    status: sub.status,
    cadence: sub.cadence,
    periodEnd: sub.current_period_end,
    cancelAtPeriodEnd: Boolean(Number(sub.cancel_at_period_end)),
  } : null;
  const base = { trialEndsAt: trialEnds, subscription, billingLive: plansEnforced(), prices: PRICES, trialDays: TRIAL_DAYS };

  if (subscriptionGivesPro(sub, at)) return { ...base, plan: 'pro', reason: 'subscription' };
  if (isAdmin(user)) return { ...base, plan: 'pro', reason: 'admin' };
  if (trialEnds && Date.parse(trialEnds) > at) return { ...base, plan: 'pro', reason: 'trial' };
  if (!plansEnforced()) return { ...base, plan: 'pro', reason: 'early-access' };
  return { ...base, plan: 'free', reason: 'free' };
}

/**
 * Upgrading: the payment page. Until a provider is connected there is nothing
 * to charge with, and the app says so; afterwards this returns its URL.
 */
export async function startCheckout(user, cadence) {
  if (!['monthly', 'yearly'].includes(cadence)) throw new BillingError(400, 'Choose monthly or yearly.');
  if (!plansEnforced() || !process.env.CHECKOUT_URL) {
    return { available: false, message: 'Payments open soon. Until then you have Pro free, as an early member.' };
  }
  const url = new URL(process.env.CHECKOUT_URL);
  url.searchParams.set('plan', cadence);
  url.searchParams.set('ref', user.id);
  return { available: true, url: url.toString() };
}

/** Cancel: Pro stays until the end of the period already paid, then Free. Nothing is deleted. */
export async function cancelSubscription(user) {
  const sub = await subscriptionOf(user.id);
  if (!sub || sub.status !== 'active') throw new BillingError(400, 'You have no paid subscription to cancel.');
  await query('UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = $1 WHERE user_id = $2', [now(), user.id]);
  return planOf(user);
}

/** Changed your mind before the period ended: keep the subscription going. */
export async function resumeSubscription(user) {
  const sub = await subscriptionOf(user.id);
  if (!sub || sub.status !== 'active' || !Number(sub.cancel_at_period_end)) throw new BillingError(400, 'Your subscription is not set to end.');
  await query('UPDATE subscriptions SET cancel_at_period_end = 0, updated_at = $1 WHERE user_id = $2', [now(), user.id]);
  return planOf(user);
}

/* ── Hooks for the payment provider's webhook ── */

/** A payment succeeded: Pro until `periodEnd`. */
export async function activateSubscription(userId, { cadence = 'monthly', periodEnd }) {
  await ensureTables();
  const row = [userId, 'active', cadence, periodEnd, now()];
  if (await subscriptionOf(userId)) {
    await query('UPDATE subscriptions SET status = $2, cadence = $3, current_period_end = $4, updated_at = $5 WHERE user_id = $1', row);
  } else {
    await query('INSERT INTO subscriptions (user_id, status, cadence, current_period_end, cancel_at_period_end, updated_at) VALUES ($1, $2, $3, $4, 0, $5)', row);
  }
}

/** The period ran out after a cancel, or a payment failed for good: back to Free. */
export async function endSubscription(userId) {
  await ensureTables();
  await query("UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = 0, updated_at = $1 WHERE user_id = $2", [now(), userId]);
}

export async function forgetBilling(userId) {
  await ensureTables();
  await query('DELETE FROM subscriptions WHERE user_id = $1', [userId]);
}
