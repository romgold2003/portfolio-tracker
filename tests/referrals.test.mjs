/**
 * Referral codes (November 2026): one code per member for life; a new member
 * who joins with it is linked to the member who shared it; that member earns
 * two free months when the new member first pays — once per person.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';
import signup from '../api/_auth/signup.js';
import social from '../api/social/[action].js';
import { recordPayment, redeem, ReferralError, newCode, normalizeCode, REWARD_MONTHS, REDEEM_DAYS } from '../api/_lib/referrals.js';
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
    const romy = await person('romy@example.com');
    const first = (await romy.call('referral')).body;
    const again = (await romy.call('referral')).body;
    assert.equal(first.code, again.code);
    assert.deepEqual([first.joined, first.paid, first.freeMonths, first.rewardMonths], [0, 0, 0, REWARD_MONTHS]);
    const dan = await person('dan@example.com');
    assert.notEqual((await dan.call('referral')).body.code, first.code);
  });
});

describe('joining with a code', () => {
  test('a new member links to the friend who shared it, once', async () => {
    const romy = await person('romy@example.com');
    const { code } = (await romy.call('referral')).body;
    const dan = await person('dan@example.com');
    const linked = await dan.call('redeem', { code: code.toLowerCase() });
    assert.equal(linked.status, 200);
    assert.equal((await romy.call('referral')).body.joined, 1);
    assert.equal((await dan.call('referral')).body.referred, true);
    const twice = await dan.call('redeem', { code });
    assert.equal(twice.status, 409);
  });

  test('refused: your own code, an unknown code, an account older than the window', async () => {
    const romy = await person('romy@example.com');
    const { code } = (await romy.call('referral')).body;
    assert.equal((await romy.call('redeem', { code })).status, 400);
    const dan = await person('dan@example.com');
    assert.equal((await dan.call('redeem', { code: 'ZZZZZZZZ' })).status, 404);
    const old = new Date(Date.now() - (REDEEM_DAYS + 1) * 86400000).toISOString();
    await assert.rejects(redeem({ id: dan.id, created_at: old }, code), (err) => err instanceof ReferralError && err.status === 400);
    assert.equal((await romy.call('referral')).body.joined, 0);
  });
});

describe('the reward', () => {
  test('two free months when the friend first pays, never twice for the same friend', async () => {
    const romy = await person('romy@example.com');
    const { code } = (await romy.call('referral')).body;
    const dan = await person('dan@example.com');
    await dan.call('redeem', { code });

    assert.deepEqual(await recordPayment(dan.id), { rewarded: true, referrer: romy.id, months: REWARD_MONTHS });
    assert.equal((await recordPayment(dan.id)).rewarded, false, 'a second payment pays nothing more');
    const stats = (await romy.call('referral')).body;
    assert.deepEqual([stats.joined, stats.paid, stats.freeMonths], [1, 1, 2]);
  });

  test('a member nobody referred pays and nothing happens', async () => {
    const eve = await person('eve@example.com');
    assert.deepEqual(await recordPayment(eve.id), { rewarded: false });
  });

  test('each friend who pays earns two more months', async () => {
    const romy = await person('romy@example.com');
    const { code } = (await romy.call('referral')).body;
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
      const friend = await person(email);
      await friend.call('redeem', { code });
      if (email !== 'c@example.com') await recordPayment(friend.id);
    }
    const stats = (await romy.call('referral')).body;
    assert.deepEqual([stats.joined, stats.paid, stats.freeMonths], [3, 2, 4]);
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
  test('the profile panel has the code, the invite link and what it has earned', () => {
    assert.match(read('index.html'), /Invite friends<\/div>\s*<div id="profileInvite">/);
    const view = read('src/ui/views/profileMenu.js');
    assert.match(view, /data-copy-code/);
    assert.match(view, /\?ref=\$\{encodeURIComponent\(code\)\}/);
  });
});
