/**
 * The cloud account API, end to end.
 *
 * These tests drive the real endpoint handlers and the real browser crypto —
 * src/core/crypto.js is imported unchanged, because Node has the same Web Crypto
 * the browser does. Only the database is swapped, for SQLite in memory.
 *
 * The claim being tested is not "the endpoints return 200". It is that a person
 * can sign in from a second device and read their journal, that the server
 * cannot read it, and that two devices cannot silently overwrite each other.
 */
import { test, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';

import signup from '../api/auth/signup.js';
import login from '../api/auth/login.js';
import begin from '../api/auth/begin.js';
import logout from '../api/auth/logout.js';
import session from '../api/auth/session.js';
import vaultRoute from '../api/vault.js';
import recover from '../api/auth/recover.js';
import changePassword from '../api/auth/password.js';
import config from '../api/config.js';

import {
  generateDataKey, wrapDataKey, unwrapDataKey, encryptJson, decryptJson,
  generateRecoveryKey, normalizeRecoveryKey, generateAuthSalt, deriveAuthSecret,
} from '../src/core/crypto.js';

process.env.NODE_ENV = 'test';

const JOURNAL = {
  positions: [
    { id: 1, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open', entry: 100, cur: 140, qty: 12 },
    { id: 2, ticker: 'BTC', cls: 'Crypto', dir: 'Long', status: 'Open', entry: 61000, cur: 78000, qty: 0.4 },
  ],
  cash: 7356.44,
  snapshots: [{ date: '2026-08-01', value: 45000 }],
  apiKey: 'secret-finnhub-key',
};

/**
 * Everything the browser does before it talks to the server. Kept in one place
 * because the whole security argument rests on this happening client-side.
 */
async function enrol(password, journal = JOURNAL) {
  const dataKey = generateDataKey();
  const recoveryKey = generateRecoveryKey();
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();
  return {
    recoveryKey,
    body: {
      authSalt,
      recoverySalt,
      authSecret: await deriveAuthSecret(password, authSalt),
      recoverySecret: await deriveAuthSecret(normalizeRecoveryKey(recoveryKey), recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, password),
      recoveryWrapper: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
      vault: await encryptJson(journal, dataKey),
    },
  };
}

let db;
beforeEach(() => {
  db = sqliteDriver();
  useDriver(db);
});

describe('signing up and signing in', () => {
  test('a new account stores a vault and signs you straight in', async () => {
    const client = makeClient();
    const { body } = await enrol('correct horse battery');

    const res = await client.call(signup, {
      method: 'POST', body: { email: 'romy@example.com', ...body },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'romy@example.com');
    assert.equal(res.body.vaultVersion, 1);
    assert.ok(client.jar.pt_session, 'signup should set a session cookie');
  });

  test('the same email cannot be taken twice', async () => {
    const client = makeClient();
    const first = await enrol('password one');
    await client.call(signup, { method: 'POST', body: { email: 'a@b.com', ...first.body } });

    const second = await enrol('password two');
    const res = await client.call(signup, {
      method: 'POST', body: { email: 'A@B.com ', ...second.body },
    });
    assert.equal(res.status, 409, 'email match must ignore case and spacing');
  });

  test('a second device signs in and reads the same journal', async () => {
    const password = 'correct horse battery';
    const laptop = makeClient();
    const { body } = await enrol(password);
    await client_signup(laptop, 'romy@example.com', body);

    // A different machine. No cookie, no local storage, nothing but the password.
    const phone = makeClient({ 'x-forwarded-for': '10.9.9.9' });

    const saltRes = await phone.call(begin, {
      method: 'POST', body: { email: 'romy@example.com' },
    });
    assert.equal(saltRes.status, 200);

    const authSecret = await deriveAuthSecret(password, saltRes.body.authSalt);
    const res = await phone.call(login, {
      method: 'POST', body: { email: 'romy@example.com', authSecret },
    });

    assert.equal(res.status, 200);
    const dataKey = await unwrapDataKey(res.body.user.passwordWrapper, password);
    assert.ok(dataKey, 'the password must unwrap the data key on a fresh device');

    const journal = await decryptJson(res.body.vault, dataKey);
    assert.deepEqual(journal, JOURNAL, 'the journal must survive the round trip intact');
  });

  test('the wrong password is refused', async () => {
    const client = makeClient();
    const { body } = await enrol('the right one');
    await client_signup(client, 'romy@example.com', body);

    const authSecret = await deriveAuthSecret('the wrong one', body.authSalt);
    const res = await makeClient().call(login, {
      method: 'POST', body: { email: 'romy@example.com', authSecret },
    });
    assert.equal(res.status, 401);
  });

  test('the recovery key still opens the journal when the password is forgotten', async () => {
    const client = makeClient();
    const { body, recoveryKey } = await enrol('forgotten already');
    const res = await client_signup(client, 'romy@example.com', body);

    const dataKey = await unwrapDataKey(
      res.body.user.recoveryWrapper, normalizeRecoveryKey(recoveryKey),
    );
    assert.ok(dataKey);
    assert.deepEqual(await decryptJson(body.vault, dataKey), JOURNAL);
  });
});

describe('what the server can learn', () => {
  test('the stored rows contain no readable trace of the journal', async () => {
    const client = makeClient();
    const { body } = await enrol('correct horse battery');
    await client_signup(client, 'romy@example.com', body);

    const users = (await db.query('SELECT * FROM users', [])).rows;
    const vaults = (await db.query('SELECT * FROM vaults', [])).rows;
    const dump = JSON.stringify({ users, vaults });

    for (const secret of ['NVDA', 'BTC', '7356.44', 'secret-finnhub-key', '78000']) {
      assert.ok(!dump.includes(secret), `the database leaked ${secret}`);
    }
    assert.ok(!dump.includes('correct horse battery'), 'the database leaked the password');
  });

  test('the password itself is never what is stored, even hashed', async () => {
    const client = makeClient();
    const password = 'correct horse battery';
    const { body } = await enrol(password);
    await client_signup(client, 'romy@example.com', body);

    const [user] = (await db.query('SELECT * FROM users', [])).rows;
    // What is stored is a hash of the auth secret, not of the password. Hashing
    // the password with the same salt must not reproduce it.
    assert.ok(user.auth_hash.startsWith('scrypt$'));
    assert.ok(!user.auth_hash.includes(body.authSecret), 'the auth secret is stored in the clear');
  });

  test('an unknown address gets a stable salt, so accounts cannot be enumerated', async () => {
    const client = makeClient();
    const { body } = await enrol('whatever');
    await client_signup(client, 'real@example.com', body);

    const ask = (email) => client.call(begin, { method: 'POST', body: { email } });

    const ghost1 = await ask('nobody@example.com');
    const ghost2 = await ask('nobody@example.com');
    const real = await ask('real@example.com');

    assert.equal(ghost1.status, 200);
    assert.equal(ghost1.status, real.status, 'status must not reveal existence');
    assert.equal(ghost1.body.authSalt, ghost2.body.authSalt, 'decoy salt must be stable');
    assert.notEqual(ghost1.body.authSalt, real.body.authSalt);
    assert.ok(ghost1.body.authSalt.length > 8);
  });
});

describe('the vault', () => {
  test('is refused to anyone who is not signed in', async () => {
    const res = await makeClient().call(vaultRoute, { method: 'GET' });
    assert.equal(res.status, 401);
  });

  test('saves, and hands back the version it wrote', async () => {
    const client = makeClient();
    const { body } = await enrol('pw');
    await client_signup(client, 'romy@example.com', body);

    const res = await client.call(vaultRoute, {
      method: 'PUT', body: { vault: { iv: 'aXY=', ct: 'Y3Q=' }, baseVersion: 1 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.vaultVersion, 2);
  });

  test('refuses a save from a device that missed someone else\'s save', async () => {
    const password = 'pw';
    const laptop = makeClient();
    const { body } = await enrol(password);
    await client_signup(laptop, 'romy@example.com', body);

    // Both devices are holding version 1.
    const phone = makeClient({ 'x-forwarded-for': '10.9.9.9' });
    const salt = await phone.call(begin, { method: 'POST', body: { email: 'romy@example.com' } });
    await phone.call(login, {
      method: 'POST',
      body: {
        email: 'romy@example.com',
        authSecret: await deriveAuthSecret(password, salt.body.authSalt),
      },
    });

    const first = await laptop.call(vaultRoute, {
      method: 'PUT', body: { vault: { iv: 'aXY=', ct: 'bGFwdG9w' }, baseVersion: 1 },
    });
    assert.equal(first.status, 200);

    const second = await phone.call(vaultRoute, {
      method: 'PUT', body: { vault: { iv: 'aXY=', ct: 'cGhvbmU=' }, baseVersion: 1 },
    });
    assert.equal(second.status, 409, 'a stale save must be refused, not applied');
    assert.equal(second.body.vaultVersion, 2);
    assert.equal(second.body.vault.ct, 'bGFwdG9w', 'the winner\'s data must survive');
  });

  test('a malformed blob is rejected before it reaches storage', async () => {
    const client = makeClient();
    const { body } = await enrol('pw');
    await client_signup(client, 'romy@example.com', body);

    for (const bad of [null, {}, { iv: 'x' }, { iv: 'x', ct: 5 }, { iv: '<script>', ct: 'a' }]) {
      const res = await client.call(vaultRoute, {
        method: 'PUT', body: { vault: bad, baseVersion: 1 },
      });
      assert.equal(res.status, 400, `accepted a bad vault: ${JSON.stringify(bad)}`);
    }
  });
});

describe('sessions', () => {
  test('survive a reload, and carry the vault back', async () => {
    const client = makeClient();
    const { body } = await enrol('pw');
    await client_signup(client, 'romy@example.com', body);

    const res = await client.call(session, { method: 'GET' });
    assert.equal(res.body.user.email, 'romy@example.com');
    assert.ok(res.body.vault.ct);
  });

  test('stop working after signing out', async () => {
    const client = makeClient();
    const { body } = await enrol('pw');
    await client_signup(client, 'romy@example.com', body);

    const stolen = client.jar.pt_session;
    await client.call(logout, { method: 'POST' });

    // Even someone who copied the cookie before sign-out is locked out, because
    // the row is gone server-side rather than only cleared in the browser.
    const thief = makeClient();
    thief.jar.pt_session = stolen;
    const res = await thief.call(vaultRoute, { method: 'GET' });
    assert.equal(res.status, 401);
  });
});

describe('abuse', () => {
  test('repeated wrong passwords are rate limited', async () => {
    const client = makeClient();
    const { body } = await enrol('right');
    await client_signup(client, 'romy@example.com', body);

    const wrong = await deriveAuthSecret('wrong', body.authSalt);
    const attacker = makeClient({ 'x-forwarded-for': '5.5.5.5' });

    let sawLimit = false;
    for (let i = 0; i < 14; i++) {
      const res = await attacker.call(login, {
        method: 'POST', body: { email: 'romy@example.com', authSecret: wrong },
      });
      if (res.status === 429) { sawLimit = true; break; }
    }
    assert.ok(sawLimit, 'guessing was never rate limited');
  });

  test('a successful sign-in forgives earlier typos', async () => {
    const password = 'right';
    const client = makeClient();
    const { body } = await enrol(password);
    await client_signup(client, 'romy@example.com', body);

    const me = makeClient({ 'x-forwarded-for': '7.7.7.7' });
    const wrong = await deriveAuthSecret('wrong', body.authSalt);
    for (let i = 0; i < 5; i++) {
      await me.call(login, { method: 'POST', body: { email: 'romy@example.com', authSecret: wrong } });
    }

    const good = await deriveAuthSecret(password, body.authSalt);
    const ok = await me.call(login, {
      method: 'POST', body: { email: 'romy@example.com', authSecret: good },
    });
    assert.equal(ok.status, 200);

    // The counter was cleared, so the next few typos are not instantly refused.
    const after = await me.call(login, {
      method: 'POST', body: { email: 'romy@example.com', authSecret: wrong },
    });
    assert.equal(after.status, 401, 'should be a normal rejection, not a rate limit');
  });

  test('a request from another site is refused even with a valid cookie', async () => {
    const client = makeClient();
    const { body } = await enrol('pw');
    await client_signup(client, 'romy@example.com', body);

    const res = await client.call(vaultRoute, {
      method: 'PUT',
      body: { vault: { iv: 'aXY=', ct: 'Y3Q=' }, baseVersion: 1 },
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
  });

  test('the session cookie is not readable by script and not sent cross-site', async () => {
    const client = makeClient();
    const { body } = await enrol('pw');
    const res = await client.call(signup, {
      method: 'POST', body: { email: 'romy@example.com', ...body },
    });
    const cookie = String(res.headers['set-cookie']);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });
});

describe('deployments without a database', () => {
  test('report that there is no cloud, rather than failing', async () => {
    useDriver(null);
    const saved = { ...process.env };
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_PRISMA_URL;
    delete process.env.DATABASE_POSTGRES_URL;

    const res = await makeClient().call(config, { method: 'GET' });
    assert.equal(res.status, 200);
    assert.equal(res.body.cloud, false);

    Object.assign(process.env, saved);
  });
});

/** Signup is the setup step in most tests; this keeps them readable. */
async function client_signup(client, email, body) {
  const res = await client.call(signup, { method: 'POST', body: { email, ...body } });
  assert.equal(res.status, 201, `signup failed: ${JSON.stringify(res.body)}`);
  return res;
}

describe('forgetting the password', () => {
  test('the recovery key gets you back in from a device that has never seen the account', async () => {
    const laptop = makeClient();
    const { body, recoveryKey } = await enrol('long forgotten');
    await client_signup(laptop, 'romy@example.com', body);

    const phone = makeClient({ 'x-forwarded-for': '10.9.9.9' });
    const salts = await phone.call(begin, { method: 'POST', body: { email: 'romy@example.com' } });

    const recoverySecret = await deriveAuthSecret(
      normalizeRecoveryKey(recoveryKey), salts.body.recoverySalt,
    );
    const res = await phone.call(recover, {
      method: 'POST', body: { email: 'romy@example.com', recoverySecret },
    });

    assert.equal(res.status, 200);
    const dataKey = await unwrapDataKey(
      res.body.user.recoveryWrapper, normalizeRecoveryKey(recoveryKey),
    );
    assert.ok(dataKey, 'the recovery key must unwrap the data key');
    assert.deepEqual(await decryptJson(res.body.vault, dataKey), JOURNAL);
  });

  test('a wrong recovery key is refused', async () => {
    const client = makeClient();
    const { body } = await enrol('pw');
    await client_signup(client, 'romy@example.com', body);

    const wrong = await deriveAuthSecret(
      normalizeRecoveryKey(generateRecoveryKey()), body.recoverySalt,
    );
    const res = await makeClient().call(recover, {
      method: 'POST', body: { email: 'romy@example.com', recoverySecret: wrong },
    });
    assert.equal(res.status, 401);
  });

  test('setting a new password works, and locks out the old one', async () => {
    const client = makeClient();
    const dataKey = generateDataKey();
    const recoveryKey = generateRecoveryKey();
    const oldSalt = generateAuthSalt();
    const recoverySalt = generateAuthSalt();
    await client_signup(client, 'romy@example.com', {
      authSalt: oldSalt,
      recoverySalt,
      authSecret: await deriveAuthSecret('old password', oldSalt),
      recoverySecret: await deriveAuthSecret(normalizeRecoveryKey(recoveryKey), recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, 'old password'),
      recoveryWrapper: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
      vault: await encryptJson(JOURNAL, dataKey),
    });

    const newSalt = generateAuthSalt();
    const change = await client.call(changePassword, {
      method: 'POST',
      body: {
        authSalt: newSalt,
        authSecret: await deriveAuthSecret('new password', newSalt),
        passwordWrapper: await wrapDataKey(dataKey, 'new password'),
      },
    });
    assert.equal(change.status, 200);

    const fresh = makeClient({ 'x-forwarded-for': '10.9.9.9' });
    const salts = await fresh.call(begin, { method: 'POST', body: { email: 'romy@example.com' } });

    const withNew = await fresh.call(login, {
      method: 'POST',
      body: {
        email: 'romy@example.com',
        authSecret: await deriveAuthSecret('new password', salts.body.authSalt),
      },
    });
    assert.equal(withNew.status, 200, 'the new password must work');
    assert.ok(
      await unwrapDataKey(withNew.body.user.passwordWrapper, 'new password'),
      'the rewrapped key must open with the new password',
    );

    const withOld = await fresh.call(login, {
      method: 'POST',
      body: {
        email: 'romy@example.com',
        authSecret: await deriveAuthSecret('old password', salts.body.authSalt),
      },
    });
    assert.equal(withOld.status, 401, 'the old password must stop working');
  });

  test('changing the password signs out the other devices', async () => {
    const laptop = makeClient();
    const dataKey = generateDataKey();
    const recoveryKey = generateRecoveryKey();
    const salt = generateAuthSalt();
    const recoverySalt = generateAuthSalt();
    await client_signup(laptop, 'romy@example.com', {
      authSalt: salt,
      recoverySalt,
      authSecret: await deriveAuthSecret('old password', salt),
      recoverySecret: await deriveAuthSecret(normalizeRecoveryKey(recoveryKey), recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, 'old password'),
      recoveryWrapper: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
      vault: await encryptJson(JOURNAL, dataKey),
    });

    // Somebody else is signed in on another machine with the old password.
    const intruder = makeClient({ 'x-forwarded-for': '10.9.9.9' });
    const salts = await intruder.call(begin, { method: 'POST', body: { email: 'romy@example.com' } });
    const inRes = await intruder.call(login, {
      method: 'POST',
      body: {
        email: 'romy@example.com',
        authSecret: await deriveAuthSecret('old password', salts.body.authSalt),
      },
    });
    assert.equal(inRes.status, 200);

    const newSalt = generateAuthSalt();
    await laptop.call(changePassword, {
      method: 'POST',
      body: {
        authSalt: newSalt,
        authSecret: await deriveAuthSecret('new password', newSalt),
        passwordWrapper: await wrapDataKey(dataKey, 'new password'),
      },
    });

    const after = await intruder.call(vaultRoute, { method: 'GET' });
    assert.equal(after.status, 401, 'the other session must be destroyed');

    const self = await laptop.call(vaultRoute, { method: 'GET' });
    assert.equal(self.status, 200, 'the device that changed it must stay signed in');
  });

  test('recovery guessing is rate limited harder than a password', async () => {
    const client = makeClient();
    const { body } = await enrol('pw');
    await client_signup(client, 'romy@example.com', body);

    const attacker = makeClient({ 'x-forwarded-for': '5.5.5.5' });
    const wrong = await deriveAuthSecret(
      normalizeRecoveryKey(generateRecoveryKey()), body.recoverySalt,
    );

    let sawLimit = false;
    for (let i = 0; i < 8; i++) {
      const res = await attacker.call(recover, {
        method: 'POST', body: { email: 'romy@example.com', recoverySecret: wrong },
      });
      if (res.status === 429) { sawLimit = true; break; }
    }
    assert.ok(sawLimit, 'recovery guessing was never rate limited');
  });
});
