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
  recordPayment, redeem, ReferralError, newCode, normalizeCode, sameIdentity, friendLabelFrom, useFreeMonth, freeMonthsLeft, REWARD_MONTHS, WELCOME_MONTHS, YEARLY_CAP, REDEEM_DAYS,
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
  test('a Referral button in the profile and in Settings opens one window that explains it all', () => {
    const html = read('index.html');
    assert.match(html, /class="pf-item pf-gift" type="button" onclick="closeProfile\(\);openReferral\(\)"/);
    assert.match(html, /onclick="closeSettings\(\);openReferral\(\)">Open my referral<\/button>/);
    assert.match(html, /<div class="ref-modal" id="referralModal"/);
    const view = read('src/ui/views/referral.js');
    assert.match(view, /Your friend gets 2 months free/);
    assert.match(view, /You get a free month/);
    assert.match(view, /data-ref-copy/);
    assert.match(view, /https:\/\/wa\.me\/\?text=/);
    assert.match(view, /\?ref=\$\{encodeURIComponent\(code\)\}/);
    assert.match(read('src/app/actions.js'), /openReferral, closeReferral,/);
  });
});

describe('the congratulations when a friend pays', () => {
  test('the friend is named by first name, or by the start of the email', () => {
    assert.equal(friendLabelFrom('Sasha', 'x@gmail.com'), 'Sasha');
    assert.equal(friendLabelFrom(null, 'sasha.levi@gmail.com'), 'Sasha');
    assert.equal(friendLabelFrom('', 'DAN_2@gmail.com'), 'Dan');
  });

  test('kept in the app until seen, and emailed to the member who invited them', async () => {
    process.env.MAIL_API_KEY = 'test-key';
    process.env.MAIL_FROM = 'noreply@clavis.test';
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: true, status: 201, text: async () => '' }; };
    try {
      const samuel = await person('samuel@gmail.com');
      const { code } = (await samuel.call('referral')).body;
      const sasha = await person('sasha.levi@gmail.com');
      await sasha.call('redeem', { code });
      assert.equal(sent.length, 0, 'nothing is sent when the friend only joins');
      await recordPayment(sasha.id, { paymentFingerprint: 'card-sasha' });

      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0].body.to, [{ email: 'samuel@gmail.com' }]);
      assert.match(sent[0].body.subject, /Congratulations: Sasha joined Clavis, you get a free month/);
      assert.match(sent[0].body.textContent, /Sasha joined Clavis with your referral code and has just paid for their first month/);

      const waiting = (await samuel.call('referral')).body.notices;
      assert.deepEqual(waiting.map((n) => [n.friend, n.months]), [['Sasha', 1]]);
      assert.equal((await samuel.call('referral-seen', {})).status, 200);
      assert.deepEqual((await samuel.call('referral')).body.notices, []);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.MAIL_API_KEY;
      delete process.env.MAIL_FROM;
    }
  });

  test('two friends pay: two months, and both names in the window', async () => {
    const { congratsHtml } = await import('../src/ui/views/referral.js');
    const html = congratsHtml([{ friend: 'Sasha', months: 1 }, { friend: 'Dan', months: 1 }]);
    assert.match(html, /<b>Sasha and Dan<\/b> have just paid for their first month with your code\. You get <b>2 free months<\/b>/);
  });
});

describe('spending free months: one per billing month', () => {
  test('two friends pay in the same month: one free month now, the other the month after', async () => {
    const samuel = await person('samuel@gmail.com');
    const { code } = (await samuel.call('referral')).body;
    for (const email of ['sasha@gmail.com', 'dan@gmail.com']) {
      const friend = await person(email);
      await friend.call('redeem', { code });
      await recordPayment(friend.id, { paymentFingerprint: `card-${email}` });
    }
    assert.equal(await freeMonthsLeft(samuel.id), 2);
    assert.deepEqual(await useFreeMonth(samuel.id, '2027-03'), { free: true, left: 1 });
    assert.deepEqual(await useFreeMonth(samuel.id, '2027-03'), { free: true, left: 1 }, 'asking twice for March uses nothing more');
    assert.deepEqual(await useFreeMonth(samuel.id, '2027-04'), { free: true, left: 0 });
    assert.deepEqual(await useFreeMonth(samuel.id, '2027-05'), { free: false, left: 0 }, 'May is paid as usual');
    assert.equal((await samuel.call('referral')).body.freeMonthsLeft, 0);
  });
});
