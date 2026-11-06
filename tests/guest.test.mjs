/**
 * Guest visits (November 2026): look around Riskbook without an account. A
 * guest gets a signed pass for the market data and a sample portfolio held in
 * memory — no account, no vault, nothing saved — and is told so on the way in.
 */
import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';
import guestEntry from '../api/_auth/guest.js';
import social from '../api/social/[action].js';
import vault from '../api/vault.js';
import { issueGuestPass, validGuestPass, guestFor, GUEST_COOKIE } from '../api/_lib/guest.js';

process.env.NODE_ENV = 'test';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

beforeEach(() => { useDriver(sqliteDriver()); process.env.GUEST_SECRET = 'test-guest-secret'; });
afterEach(() => { delete process.env.GUEST_SECRET; });

describe('the guest pass', () => {
  test('signed by the server, good for twelve hours, and not to be made up or stretched', () => {
    const now = Date.now();
    const pass = issueGuestPass(now);
    assert.equal(validGuestPass(pass, now), true);
    assert.equal(validGuestPass(pass, now + 11 * 3600_000), true);
    assert.equal(validGuestPass(pass, now + 13 * 3600_000), false, 'expired');
    const [expires, nonce, mac] = pass.split('.');
    assert.equal(validGuestPass(`${Number(expires) + 86400_000}.${nonce}.${mac}`, now), false, 'a longer expiry breaks the signature');
    assert.equal(validGuestPass('made.up.pass', now), false);
    assert.equal(validGuestPass(undefined, now), false);
  });

  test('no secret on the deployment, no guests', () => {
    delete process.env.GUEST_SECRET;
    const saved = [process.env.CRON_SECRET, process.env.ESCROW_SECRET];
    delete process.env.CRON_SECRET;
    delete process.env.ESCROW_SECRET;
    assert.equal(issueGuestPass(), null);
    if (saved[0] !== undefined) process.env.CRON_SECRET = saved[0];
    if (saved[1] !== undefined) process.env.ESCROW_SECRET = saved[1];
  });

  test('entering as a guest sets the pass; it opens market data and nothing about accounts', async () => {
    const client = makeClient({ 'x-forwarded-for': '10.0.9.1' });
    const res = await client.call(guestEntry, { method: 'POST', url: '/api/auth/guest' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(String(res.headers['set-cookie']), new RegExp(`^${GUEST_COOKIE}=`));
    // Friends, the questionnaire, Admin and the vault all still want a real sign-in.
    for (const action of ['friends', 'role', 'admin']) {
      assert.equal((await client.call(social, { method: 'GET', url: `/api/social/${action}` })).status, 401, action);
    }
    assert.equal((await client.call(social, { method: 'POST', body: { sex: 'male' }, url: '/api/social/about' })).status, 401);
    assert.equal((await client.call(vault, { method: 'GET', url: '/api/vault' })).status, 401);
  });

  test('every market-data endpoint lets a guest through, and only those', () => {
    const open = ['api/quote.js', 'api/history.js', ...['earnings', 'econ', 'etf', 'fed', 'options', 'sentiment', 'weekstart', 'whales'].map((n) => `api/_panels/${n}.js`)];
    for (const f of open) assert.match(read(f), /\?\? guestFor\(req\)/, f);
    for (const f of ['api/vault.js', 'api/account.js', 'api/social/[action].js']) assert.doesNotMatch(read(f), /guestFor/, f);
    const req = { headers: { cookie: `${GUEST_COOKIE}=${encodeURIComponent(issueGuestPass())}` } };
    assert.deepEqual(guestFor(req), { guest: true, id: 'guest' });
    assert.equal(guestFor({ headers: {} }), null);
  });
});

describe('in the app', () => {
  test('a guest journal is held in memory: read back, never written, gone on leaving', async () => {
    const writes = [];
    globalThis.localStorage = { getItem: () => null, setItem: (k) => writes.push(k), removeItem: () => {} };
    const profiles = await import('../src/core/profiles.js');
    await profiles.startGuest({ positions: [{ ticker: 'AAPL' }], cash: 10 });
    assert.equal(profiles.isGuest(), true);
    assert.equal(profiles.isUnlocked(), true);
    assert.equal((await profiles.readVault()).positions[0].ticker, 'AAPL');
    assert.equal(await profiles.saveVault({ positions: [], cash: 999 }), true);
    assert.deepEqual(writes, [], 'nothing stored in the browser');
    profiles.lock();
    assert.equal(profiles.isGuest(), false);
    assert.equal(profiles.isUnlocked(), false);
  });

  test('the way in: a button on the sign-in screen, the sample portfolio, and the notice', async () => {
    const lock = read('src/ui/views/lockScreen.js');
    assert.match(lock, /id="lockGuest">Continue as a guest</);
    assert.match(lock, /Nothing you do is saved\./);
    assert.match(lock, /startGuest\(\{ \.\.\.buildDemoJournal/);
    const { guestNoticeHtml } = await import('../src/ui/views/guest.js');
    const notice = guestNoticeHtml();
    assert.match(notice, /You are exploring as a guest/);
    assert.match(notice, /Nothing is saved\./);
    assert.match(notice, /data-guest-create/);
    assert.match(read('src/ui/views/guest.js'), /Guest mode<\/b> — nothing you do is saved/);
  });

  test('a guest is never counted, asked the questions, offered Admin, or shown to friends', () => {
    assert.match(read('src/services/usage.js'), /&& !isGuest\(\)/);
    assert.match(read('src/ui/views/aboutYou.js'), /\|\| isGuest\(\) \|\|/);
    assert.match(read('src/ui/views/admin.js'), /\|\| isGuest\(\)\) return;/);
    assert.match(read('src/services/social.js'), /if \(!cloudEnabled\(\) \|\| isGuest\(\)\) return;/);
    assert.match(read('src/ui/views/friends.js'), /const online = cloudEnabled\(\) && !isGuest\(\);/);
    assert.match(read('src/ui/views/tour.js'), /\|\| isGuest\(\) \|\|/);
  });
});
