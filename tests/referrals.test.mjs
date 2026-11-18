/**
 * Referral codes (November 2026): one code per member for life. Give a month,
 * get a month: the friend gets one on joining, the member one when the friend
 * first pays; at most six a year, and never between the same person.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';
import signup from '../api/_auth/signup.js';
import social from '../api/social/[action].js';
import {
  recordPayment, redeem, ReferralError, newCode, normalizeCode, sameIdentity, REWARD_MONTHS, WELCOME_MONTHS, YEARLY_CAP, REDEEM_DAYS,
} from '../api/_lib/referrals.js';
import {
  generateDataKey, wrapDataKey, encryptJson, generateRecoveryKey, normalizeRecoveryKey,
  generateAuthSalt, deriveAuthSecret,
} from '../src/core/crypto.js';

process.env.NODE_ENV = 'test';

let ip = 1;
async function person(email, password = 'correct horse battery') {
  const client = makeClient({ 'x-forwarded-for': `10.1.0.${ip++}` });
  const dataKey = generateDataKey();
  const recoveryKey = generateRecoveryKey();
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();
  const res = await client.call(signup, {
    method: 'POST',
    body: {
      email,
      authSalt,
      recoverySalt,
      authSecret: await deriveAuthSecret(password, authSalt),
      recoverySecret: await deriveAuthSecret(normalizeRecoveryKey(recoveryKey), recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, password),
      recoveryWrapper: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
      vault: await encryptJson({ positions: [], cash: 0 }, dataKey),
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const call = (action, body) => client.call(social, {
    method: body === undefined ? 'GET' : 'POST', body, url: `/api/social/${action}`,
  });
  return { email, id: res.body.user.id, call };
}

beforeEach(() => { useDriver(sqliteDriver()); });

describe('the code', () => {
  test('eight characters, none that read alike, and typed codes are tidied', () => {
    const code = newCode();
    assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/);
    assert.equal(normalizeCode(' ab-cd 23ef '), 'ABCD23EF');
  });

  test('one per member, the same every time it is asked for', async () => {
    const romy = await person('romy@gmail.com');
    const first = (await romy.call('referral')).body;
    const again = (await romy.call('referral')).body;
    assert.equal(first.code, again.code);
    assert.deepEqual([first.joined, first.paid, first.freeMonths, first.rewardMonths, first.yearlyCap, first.leftThisYear], [0, 0, 0, 1, YEARLY_CAP, YEARLY_CAP]);
    const dan = await person('dan@gmail.com');
    assert.notEqual((await dan.call('referral')).body.code, first.code);
  });
});

describe('who counts as the same person', () => {
  test('the same mailbox behind plus-addressing or Gmail dots, or the same company domain', () => {
    assert.equal(sameIdentity('romy@gmail.com', 'r.o.m.y+clavis@googlemail.com'), true);
    assert.equal(sameIdentity('romy@acme.io', 'dan@acme.io'), true);
    assert.equal(sameIdentity('Romy+1@Outlook.com', 'romy@outlook.com'), true);
  });
  test('different people on a public provider, or on different domains, are not', () => {
    assert.equal(sameIdentity('romy@gmail.com', 'dan@gmail.com'), false);
    assert.equal(sameIdentity('romy@acme.io', 'romy@other.io'), false);
  });
});

describe('joining with a code: give a month', () => {
  test('the friend is linked and gets a free month at once; once only', async () => {
    const romy = await person('romy@gmail.com');
    const { code } = (await romy.call('referral')).body;
    const dan = await person('dan@gmail.com');
    const linked = await dan.call('redeem', { code: code.toLowerCase() });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.freeMonths, WELCOME_MONTHS);
    assert.equal((await romy.call('referral')).body.joined, 1);
    const danStats = (await dan.call('referral')).body;
    assert.deepEqual([danStats.referred, danStats.freeMonths], [true, 1]);
    assert.equal((await dan.call('redeem', { code })).status, 409);
  });

  test('refused: your own code, an unknown code, an old account, yourself under another address', async () => {
    const romy = await person('romy@gmail.com');
    const { code } = (await romy.call('referral')).body;
    assert.equal((await romy.call('redeem', { code })).status, 400);
    const dan = await person('dan@gmail.com');
    assert.equal((await dan.call('redeem', { code: 'ZZZZZZZZ' })).status, 404);
    const old = new Date(Date.now() - (REDEEM_DAYS + 1) * 86400000).toISOString();
    await assert.rejects(redeem({ id: dan.id, email: dan.email, created_at: old }, code), (err) => err instanceof ReferralError && err.status === 400);
    const alias = await person('r.omy+2@gmail.com');
    const refused = await alias.call('redeem', { code });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /cannot be used between these two accounts/);
    const boss = await person('boss@acme.io');
    const bossCode = (await boss.call('referral')).body.code;
    const colleague = await person('colleague@acme.io');
    assert.equal((await colleague.call('redeem', { code: bossCode })).status, 400);
    assert.equal((await romy.call('referral')).body.joined, 0);
  });
});

describe('the reward: get a month', () => {
  test('one free month when the friend first pays, never twice for the same friend', async () => {
    const romy = await person('romy@gmail.com');
    const { code } = (await romy.call('referral')).body;
    const dan = await person('dan@gmail.com');
    await dan.call('redeem', { code });
    assert.deepEqual(await recordPayment(dan.id, { paymentFingerprint: 'card-dan' }), { rewarded: true, referrer: romy.id, months: REWARD_MONTHS });
    assert.equal((await recordPayment(dan.id, { paymentFingerprint: 'card-dan' })).rewarded, false, 'a second payment pays nothing more');
    const stats = (await romy.call('referral')).body;
    assert.deepEqual([stats.joined, stats.paid, stats.freeMonths, stats.leftThisYear], [1, 1, 1, YEARLY_CAP - 1]);
  });

  test('no reward when the friend pays with a card the member has paid with', async () => {
    const romy = await person('romy@gmail.com');
    await recordPayment(romy.id, { paymentFingerprint: 'card-romy' });
    const { code } = (await romy.call('referral')).body;
    const dan = await person('dan@gmail.com');
    await dan.call('redeem', { code });
    assert.deepEqual(await recordPayment(dan.id, { paymentFingerprint: 'card-romy' }), { rewarded: false, reason: 'same-payment' });
    assert.equal((await romy.call('referral')).body.freeMonths, 0);
  });

  test('at most six free months in a year, however many friends pay', async () => {
    const romy = await person('romy@gmail.com');
    const { code } = (await romy.call('referral')).body;
    const results = [];
    for (let i = 0; i < 8; i += 1) {
      const friend = await person(`friend${i}@gmail.com`);
      await friend.call('redeem', { code });
      results.push(await recordPayment(friend.id, { paymentFingerprint: `card-${i}` }));
    }
    assert.equal(results.filter((r) => r.rewarded).length, YEARLY_CAP);
    assert.deepEqual(results.at(-1), { rewarded: false, reason: 'capped' });
    const stats = (await romy.call('referral')).body;
    assert.deepEqual([stats.joined, stats.paid, stats.freeMonths, stats.leftThisYear], [8, 8, YEARLY_CAP, 0]);
  });

  test('a member nobody referred pays and nothing happens', async () => {
    const eve = await person('eve@gmail.com');
    assert.deepEqual(await recordPayment(eve.id), { rewarded: false });
  });
});

describe('in the app', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  test('an invite link fills the sign-up form, and the code is linked once the account exists', () => {
    const lock = read('src/ui/views/lockScreen.js');
    assert.match(lock, /id="lockRef"[^>]*value="\$\{escapeHtml\(storedReferral\(\)\)\}"/);
    assert.match(lock, /social\.redeem\(referral\)\.then\(forgetReferral\)/);
    assert.match(read('src/ui/views/landing.js'), /url\.searchParams\.get\('ref'\)/);
  });
  test('the profile panel has the code, the invite link, and give a month, get a month', () => {
    assert.match(read('index.html'), /Invite friends<\/div>\s*<div id="profileInvite">/);
    const view = read('src/ui/views/profileMenu.js');
    assert.match(view, /data-copy-code/);
    assert.match(view, /\?ref=\$\{encodeURIComponent\(code\)\}/);
    assert.match(view, /Give a month, get a month\./);
  });
});
