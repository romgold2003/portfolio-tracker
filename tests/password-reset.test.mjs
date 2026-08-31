/**
 * Resetting a forgotten password from a link in an email.
 *
 * The whole flow, against the real handlers and the real browser crypto, with
 * SQLite standing in for Postgres and one stubbed fetch standing in for the
 * mail provider. The token is read out of the message body exactly as a person
 * would read it out of their inbox.
 *
 * What is being tested is not that the endpoints answer. It is that someone who
 * has forgotten their password ends up signed in with their trades intact, that
 * the link cannot be used twice, that the old password stops working, and that
 * asking about an address never reveals whether it has an account.
 */
import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';

import signup from '../api/_auth/signup.js';
import login from '../api/_auth/login.js';
import begin from '../api/_auth/begin.js';
import session from '../api/_auth/session.js';
import forgot from '../api/_auth/forgot.js';
import reset from '../api/_auth/reset.js';
import escrow from '../api/_auth/escrow.js';
import config from '../api/config.js';

import {
  generateDataKey, wrapDataKey, unwrapDataKey, encryptJson, decryptJson,
  generateRecoveryKey, normalizeRecoveryKey, generateAuthSalt, deriveAuthSecret,
  toBase64, fromBase64,
} from '../src/core/crypto.js';

process.env.NODE_ENV = 'test';

const JOURNAL = {
  positions: [{ id: 1, ticker: 'AVGO', cls: 'Stocks', dir: 'Long', status: 'Open', entry: 210, cur: 305, qty: 30 }],
  cash: 8359.63,
  snapshots: [],
  apiKey: '',
};

/** Everything the browser does before it talks to the server. */
async function enrol(password, { escrow = true, journal = JOURNAL } = {}) {
  const dataKey = generateDataKey();
  const recoveryKey = generateRecoveryKey();
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();
  return {
    dataKey,
    recoveryKey,
    body: {
      authSalt,
      recoverySalt,
      authSecret: await deriveAuthSecret(password, authSalt),
      recoverySecret: await deriveAuthSecret(normalizeRecoveryKey(recoveryKey), recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, password),
      recoveryWrapper: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
      vault: await encryptJson(journal, dataKey),
      ...(escrow ? { escrowDataKey: toBase64(dataKey) } : {}),
    },
  };
}

/** The browser's half of the reset, which is where the new wrapper is built. */
async function chooseNewPassword(client, token, newPassword) {
  const opened = await client.call(reset, { method: 'POST', body: { token, step: 'open' } });
  if (opened.status !== 200) return { opened, committed: null, dataKey: null };

  const dataKey = fromBase64(opened.body.dataKey);
  const authSalt = generateAuthSalt();
  const committed = await client.call(reset, {
    method: 'POST',
    body: {
      token,
      step: 'commit',
      authSalt,
      authSecret: await deriveAuthSecret(newPassword, authSalt),
      passwordWrapper: await wrapDataKey(dataKey, newPassword),
      dataKey: opened.body.dataKey,
    },
  });
  return { opened, committed, dataKey };
}

let db;
let sent;
let realFetch;

beforeEach(() => {
  db = sqliteDriver();
  useDriver(db);

  process.env.ESCROW_SECRET = 'a-secret-that-lives-in-the-environment';
  process.env.MAIL_API_KEY = 'test-key';
  process.env.MAIL_FROM = 'noreply@riskbook.test';

  // The inbox. One entry per message the app tried to send.
  sent = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 201, text: async () => '' };
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ESCROW_SECRET;
  delete process.env.MAIL_API_KEY;
  delete process.env.MAIL_FROM;
});

/** Pull the token out of the message, the way the recipient's browser would. */
function tokenFromLastEmail() {
  const message = sent.at(-1);
  if (!message) return null;
  const match = /[?&]reset=([A-Za-z0-9_-]+)/.exec(message.body.textContent);
  return match ? match[1] : null;
}

async function signUp(client, email, password, options) {
  const enrolled = await enrol(password, options);
  const res = await client.call(signup, { method: 'POST', body: { email, ...enrolled.body } });
  assert.equal(res.status, 201, 'signup should succeed');
  return enrolled;
}

describe('resetting a forgotten password by email', () => {
  test('the link arrives, and the journal is still there afterwards', async () => {
    const laptop = makeClient();
    await signUp(laptop, 'romy@example.com', 'the original password');

    // A different machine, a forgotten password, nothing but the address.
    const phone = makeClient({ 'x-forwarded-for': '10.9.9.9' });
    const asked = await phone.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    assert.equal(asked.status, 200);

    assert.equal(sent.length, 1, 'exactly one message should have been sent');
    assert.equal(sent[0].body.to[0].email, 'romy@example.com');
    const token = tokenFromLastEmail();
    assert.ok(token, 'the message should carry a reset token');

    const { committed, dataKey } = await chooseNewPassword(phone, token, 'a brand new password');
    assert.equal(committed.status, 200);
    assert.ok(phone.jar.pt_session, 'finishing a reset should sign the browser in');

    // The point of the whole exercise: the trades are still readable.
    const journal = await decryptJson(committed.body.vault, dataKey);
    assert.deepEqual(journal.positions[0].ticker, 'AVGO');
    assert.equal(journal.cash, 8359.63);
  });

  test('the new password works and the old one does not', async () => {
    const client = makeClient();
    await signUp(client, 'romy@example.com', 'the original password');
    await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    await chooseNewPassword(client, tokenFromLastEmail(), 'a brand new password');

    const salts = await client.call(begin, { method: 'POST', body: { email: 'romy@example.com' } });

    const withNew = await client.call(login, {
      method: 'POST',
      body: {
        email: 'romy@example.com',
        authSecret: await deriveAuthSecret('a brand new password', salts.body.authSalt),
      },
    });
    assert.equal(withNew.status, 200, 'the new password should sign in');

    const withOld = await client.call(login, {
      method: 'POST',
      body: {
        email: 'romy@example.com',
        authSecret: await deriveAuthSecret('the original password', salts.body.authSalt),
      },
    });
    assert.equal(withOld.status, 401, 'the old password must stop working');
  });

  test('the new password opens the wrapper the server hands back', async () => {
    const client = makeClient();
    await signUp(client, 'romy@example.com', 'the original password');
    await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    const { committed, dataKey } = await chooseNewPassword(client, tokenFromLastEmail(), 'second password');

    const unwrapped = await unwrapDataKey(committed.body.user.passwordWrapper, 'second password');
    assert.ok(unwrapped, 'the stored wrapper should open with the new password');
    assert.deepEqual([...unwrapped], [...dataKey], 'and yield the same data key');
  });

  test('a session held from before the reset is thrown out', async () => {
    const attacker = makeClient();
    await signUp(attacker, 'romy@example.com', 'the original password');
    const before = await attacker.call(session);
    assert.equal(before.body.user?.email, 'romy@example.com', 'signed in to begin with');

    const owner = makeClient({ 'x-forwarded-for': '10.9.9.9' });
    await owner.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    const { committed } = await chooseNewPassword(owner, tokenFromLastEmail(), 'locked you out now');
    assert.equal(committed.status, 200);

    const after = await attacker.call(session);
    assert.equal(after.body.user, null, 'the old session must not survive a reset');
  });
});

describe('the reset link as a credential', () => {
  test('it works once', async () => {
    const client = makeClient();
    await signUp(client, 'romy@example.com', 'the original password');
    await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    const token = tokenFromLastEmail();

    const first = await chooseNewPassword(client, token, 'first new password');
    assert.equal(first.committed.status, 200);

    const second = await chooseNewPassword(client, token, 'second new password');
    assert.notEqual(second.opened.status, 200, 'a spent token must not open again');
  });

  test('asking a second time kills the first link', async () => {
    const client = makeClient();
    await signUp(client, 'romy@example.com', 'the original password');

    await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    const older = tokenFromLastEmail();
    await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    const newer = tokenFromLastEmail();
    assert.notEqual(older, newer);

    const stale = await client.call(reset, { method: 'POST', body: { token: older, step: 'open' } });
    assert.equal(stale.status, 400, 'the superseded link must stop working');

    const live = await client.call(reset, { method: 'POST', body: { token: newer, step: 'open' } });
    assert.equal(live.status, 200, 'the newest link is the one that works');
  });

  test('a made-up token is refused', async () => {
    const client = makeClient();
    const res = await client.call(reset, {
      method: 'POST', body: { token: 'not-a-real-token', step: 'open' },
    });
    assert.equal(res.status, 400);
  });
});

describe('what the endpoint will not tell you', () => {
  test('an unknown address gets the same answer as a real one', async () => {
    const client = makeClient();
    await signUp(client, 'romy@example.com', 'the original password');

    const known = await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    const unknown = await client.call(forgot, {
      method: 'POST', body: { email: 'nobody@example.com' },
    });

    assert.equal(known.status, unknown.status);
    assert.deepEqual(known.body, unknown.body, 'the reply must not reveal who has an account');
    assert.equal(sent.length, 1, 'and no mail should go to an address with no account');
  });
});

describe('deployments that hold no keys', () => {
  test('with no escrow secret, nothing is stored and no link is sent', async () => {
    delete process.env.ESCROW_SECRET;

    const client = makeClient();
    await signUp(client, 'romy@example.com', 'the original password');
    const res = await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });

    assert.equal(res.status, 200, 'the answer is still the same either way');
    assert.equal(sent.length, 0, 'but there is nothing to send a link for');
  });

  test('an account created without escrow cannot be reset by email', async () => {
    const client = makeClient();
    // The client declines to hand over a copy of its key.
    await signUp(client, 'romy@example.com', 'the original password', { escrow: false });

    await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    assert.equal(sent.length, 0, 'no key held means no link offered');
  });

  test('an older account can hand over a key once signed in, and then reset', async () => {
    const client = makeClient();
    // Signed up before reset links existed: no key was ever handed over.
    await signUp(client, 'romy@example.com', 'the original password', { escrow: false });

    const before = await client.call(session);
    assert.equal(before.body.escrowed, false, 'the app should be told there is no key held');

    // What the browser does on the next sign-in, having just unlocked the vault.
    const dataKey = generateDataKey();
    const deposited = await client.call(escrow, {
      method: 'POST', body: { dataKey: toBase64(dataKey) },
    });
    assert.equal(deposited.status, 200);

    const after = await client.call(session);
    assert.equal(after.body.escrowed, true);

    await client.call(forgot, { method: 'POST', body: { email: 'romy@example.com' } });
    assert.equal(sent.length, 1, 'now a link can be sent');

    const opened = await client.call(reset, {
      method: 'POST', body: { token: tokenFromLastEmail(), step: 'open' },
    });
    assert.equal(opened.body.dataKey, toBase64(dataKey), 'and it returns the key it was given');
  });

  test('the escrow endpoint refuses a browser that is not signed in', async () => {
    const stranger = makeClient();
    const res = await stranger.call(escrow, {
      method: 'POST', body: { dataKey: toBase64(generateDataKey()) },
    });
    assert.equal(res.status, 401);
  });

  test('config tells the app which of the two it is', async () => {
    const client = makeClient();

    const on = await client.call(config);
    assert.equal(on.body.cloud, true);
    assert.equal(on.body.emailReset, true);

    delete process.env.MAIL_API_KEY;
    const off = await client.call(config);
    assert.equal(off.body.cloud, true);
    assert.equal(off.body.emailReset, false, 'no mail provider, no reset links');
  });
});
