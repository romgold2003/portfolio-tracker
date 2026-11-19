/**
 * Clavis Free and Clavis Pro (November 2026): who has which plan, and a
 * subscription that cancels like subscription apps do.
 */
import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  planOf, startCheckout, cancelSubscription, resumeSubscription, activateSubscription, endSubscription, BillingError, TRIAL_DAYS,
} from '../api/_lib/billing.js';
import { FEATURES, PRO_PAGES } from '../src/config/plans.js';

const DAY = 86400000;
const user = (daysOld, email = 'sasha@gmail.com') => ({ id: `u-${email}`, email, created_at: new Date(Date.now() - daysOld * DAY).toISOString() });

beforeEach(() => { useDriver(sqliteDriver()); delete process.env.PLANS_ENFORCED; delete process.env.ADMIN_EMAILS; delete process.env.CHECKOUT_URL; });
afterEach(() => { delete process.env.PLANS_ENFORCED; delete process.env.ADMIN_EMAILS; delete process.env.CHECKOUT_URL; });

describe('who has which plan', () => {
  test('a new account: a month of Pro free', async () => {
    process.env.PLANS_ENFORCED = '1';
    const p = await planOf(user(3));
    assert.deepEqual([p.plan, p.reason], ['pro', 'trial']);
  });
  test('after the month, with plans enforced: Free', async () => {
    process.env.PLANS_ENFORCED = '1';
    const p = await planOf(user(TRIAL_DAYS + 1));
    assert.deepEqual([p.plan, p.reason], ['free', 'free']);
  });
  test('before payments open, everyone keeps Pro (early access)', async () => {
    const p = await planOf(user(200));
    assert.deepEqual([p.plan, p.reason, p.billingLive], ['pro', 'early-access', false]);
  });
  test('the admin always has Pro', async () => {
    process.env.PLANS_ENFORCED = '1';
    process.env.ADMIN_EMAILS = 'romy@gmail.com';
    assert.equal((await planOf(user(200, 'romy@gmail.com'))).reason, 'admin');
  });
});

describe('the subscription', () => {
  test('paid: Pro; cancelled: still Pro to the end of the period; then Free', async () => {
    process.env.PLANS_ENFORCED = '1';
    const u = user(90);
    const periodEnd = new Date(Date.now() + 20 * DAY).toISOString();
    await activateSubscription(u.id, { cadence: 'monthly', periodEnd });
    assert.deepEqual([(await planOf(u)).plan, (await planOf(u)).reason], ['pro', 'subscription']);

    const cancelled = await cancelSubscription(u);
    assert.deepEqual([cancelled.plan, cancelled.subscription.cancelAtPeriodEnd], ['pro', true]);
    const resumed = await resumeSubscription(u);
    assert.equal(resumed.subscription.cancelAtPeriodEnd, false);

    await endSubscription(u.id);
    assert.equal((await planOf(u, Date.now() + 21 * DAY)).plan, 'free');
  });
  test('cancelling without a paid plan says so', async () => {
    await assert.rejects(cancelSubscription(user(90)), (e) => e instanceof BillingError && e.status === 400);
  });
  test('upgrading before payments open: a clear message, no charge', async () => {
    const out = await startCheckout(user(90), 'yearly');
    assert.equal(out.available, false);
    assert.match(out.message, /Payments open soon/);
    await assert.rejects(startCheckout(user(90), 'weekly'), BillingError);
  });
});

describe('in the app and on the landing page', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  test('Free keeps Home, positions, trades, import and friends; Pro adds the rest', () => {
    const free = FEATURES.filter(([, f]) => f).map(([t]) => t).join(' | ');
    for (const word of ['Home', 'Positions', 'Import', 'Friends']) assert.match(free, new RegExp(word));
    assert.deepEqual(Object.keys(PRO_PAGES).sort(), ['crypto', 'insights', 'monthly', 'news']);
  });
  test('the Upgrade button sits under the profile, the plan window has Cancel, the landing page has the table', () => {
    const html = read('index.html');
    assert.match(html, /id="profileBtn"[\s\S]*?<\/button>\s*<!-- The plan, under the profile[^>]*-->\s*<button class="plan-btn" id="planBtn"/);
    assert.match(html, /<div class="ref-modal plans-modal" id="plansModal"/);
    const view = read('src/ui/views/plans.js');
    assert.match(view, /Cancel your subscription\?/);
    assert.match(view, /You keep Pro until/);
    assert.match(read('src/ui/views/landing.js'), /\$\{plansTableHtml\(\)\}/);
  });
});
