/**
 * Terms of Service and Privacy Policy (November 2026): what they say, how
 * each person agrees, and the proof kept of it. Written from Rom's answers to
 * 22 questions; see assets/terms.html and assets/privacy.html.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver, query } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';
import signup from '../api/_auth/signup.js';
import deleteAccount from '../api/account.js';
import social from '../api/social/[action].js';
import {
  generateDataKey, wrapDataKey, encryptJson, generateRecoveryKey, normalizeRecoveryKey,
  generateAuthSalt, deriveAuthSecret,
} from '../src/core/crypto.js';

process.env.NODE_ENV = 'test';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const terms = read('assets/terms.html');
const privacy = read('assets/privacy.html');

let ip = 140;
async function person(email, password = 'correct horse battery') {
  const client = makeClient({ 'x-forwarded-for': `10.0.5.${ip++}` });
  const dataKey = generateDataKey();
  const recoveryKey = generateRecoveryKey();
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();
  const res = await client.call(signup, {
    method: 'POST',
    body: {
      email, authSalt, recoverySalt,
      authSecret: await deriveAuthSecret(password, authSalt),
      recoverySecret: await deriveAuthSecret(normalizeRecoveryKey(recoveryKey), recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, password),
      recoveryWrapper: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
      vault: await encryptJson({ positions: [], cash: 0 }, dataKey),
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const call = (action, body) => client.call(social, { method: body === undefined ? 'GET' : 'POST', body, url: `/api/social/${action}` });
  return { id: res.body.user.id, client, call, authSalt, password };
}

beforeEach(() => { useDriver(sqliteDriver()); });

describe('what the documents say', () => {
  test('who runs Riskbook, under which law, and the version', () => {
    for (const doc of [terms, privacy]) {
      assert.match(doc, /Rom Goldberg/);
      assert.match(doc, /Raanana, Israel/);
      assert.match(doc, /Version 1 · Effective 6 November 2026/);
    }
    assert.match(terms, /laws of the State of Israel/);
    assert.match(terms, /Tel Aviv–Jaffa/);
  });

  test('a tracking tool, not a financial service, and never advice', () => {
    assert.match(terms, /tracking and journal tool/);
    assert.match(terms, /not a financial service/);
    assert.match(terms, /not a broker, exchange, bank, investment adviser/);
    assert.match(terms, /Nothing in Riskbook is advice/);
    assert.match(terms, /Israel Securities Authority/);
    assert.match(terms, /broker's statements and records are the official ones/);
  });

  test('18 and over, free today, zero liability with a fallback the law allows', () => {
    assert.match(terms, /at least <b>18 years old<\/b>/);
    assert.match(privacy, /<b>18 and over<\/b>/);
    assert.match(terms, /currently <b>free<\/b>/);
    assert.match(terms, /Our total liability is limited to zero/);
    assert.match(terms, /limited to the lowest amount the applicable law permits/);
    assert.match(terms, /cannot be excluded or limited by law/);
  });

  test('changes: 30 days notice and accepting again', () => {
    assert.match(terms, /at least <b>30 days<\/b>/);
    assert.match(privacy, /at least <b>30 days<\/b>/);
  });

  test('the privacy promises: encrypted journal, never sold, named providers, rights, retention', () => {
    assert.match(privacy, /we cannot read your journal/);
    assert.match(privacy, /never sell or rent/);
    for (const provider of ['Vercel', 'Neon', 'Brevo']) assert.ok(privacy.includes(provider), provider);
    assert.match(privacy, /within <b>30 days<\/b>/);
    assert.match(privacy, /<b>3 years<\/b>/);
    assert.match(privacy, /pt_session/);
    assert.match(privacy, /pt_guest/);
    for (const right of ['access', 'correct', 'delete', 'withdraw consent', 'complain']) assert.ok(privacy.includes(right), right);
    assert.match(privacy, /We do not sell personal information/);
  });

  test('served at /terms and /privacy', () => {
    const vercel = JSON.parse(read('vercel.json'));
    assert.ok(vercel.rewrites.some((r) => r.source === '/terms' && r.destination === '/assets/terms.html'));
    assert.ok(vercel.rewrites.some((r) => r.source === '/privacy' && r.destination === '/assets/privacy.html'));
  });
});

describe('how each person agrees', () => {
  test('sign-up: a required box, never pre-ticked, and a separate optional one for news emails', () => {
    const lock = read('src/ui/views/lockScreen.js');
    assert.match(lock, /<input type="checkbox" id="lockAgree">/);
    assert.match(lock, /<input type="checkbox" id="lockMarketing">/);
    assert.doesNotMatch(lock, /id="lockAgree"[^>]*checked/);
    assert.match(lock, /if \(!el\('lockAgree'\)\?\.checked\) throw new Error\('To create an account, confirm you are 18 or older/);
    assert.match(lock, /legalVersion: LEGAL_VERSION/);
    assert.match(lock, /social\.accept\(LEGAL_VERSION, marketing\)/);
  });

  test('guests agree by entering, and are told so under the button', () => {
    assert.match(read('src/ui/views/lockScreen.js'), /By continuing as a guest you agree to the/);
  });

  test('existing accounts: a screen they must accept, the box unticked and the button off until it is', async () => {
    const { legalGateHtml } = await import('../src/ui/views/legal.js');
    const html = legalGateHtml();
    assert.match(html, /<input type="checkbox" id="legalAgree">/);
    assert.match(html, /data-legal-accept disabled/);
    assert.match(html, /data-legal-signout/);
    assert.match(read('src/ui/views/aboutYou.js'), /\|\| legalDue\(\)\) return;/);
    assert.match(read('src/ui/views/tour.js'), /\|\| legalDue\(\) \|\|/);
  });

  test('an account is due until it accepts the current version, then not again', async () => {
    const store = await import('../src/core/store.js');
    const { LEGAL_VERSION } = await import('../src/config/legal.js');
    store.clearState();
    store.loadState({ positions: [], cash: 0, snapshots: [], priceLog: {}, apiKey: '' });
    assert.equal(store.legalDue(), true, 'an account from before the documents');
    store.setLegalAccepted();
    assert.equal(store.state.legalVersion, LEGAL_VERSION);
    assert.equal(store.legalDue(), false);
    store.clearState();
    store.loadState({ positions: [], cash: 0, snapshots: [], priceLog: {}, apiKey: '', legalVersion: LEGAL_VERSION });
    assert.equal(store.legalDue(), false, 'agreed at sign-up');
    store.clearState();
  });
});

describe('the proof, on the server', () => {
  test('which version, when, and the news-email choice — changed later from Settings', async () => {
    const ana = await person('ana@example.com');
    assert.deepEqual((await ana.call('consent')).body, { version: 0, marketing: false });
    assert.equal((await ana.call('accept', { version: 1, marketing: true })).status, 200);
    let c = (await ana.call('consent')).body;
    assert.equal(c.version, 1);
    assert.equal(c.marketing, true);
    assert.ok(c.acceptedAt);
    await ana.call('marketing', { marketing: false });
    c = (await ana.call('consent')).body;
    assert.equal(c.marketing, false);
    assert.equal(c.version, 1, 'the accepted version stays');
    assert.equal((await ana.call('accept', { version: 'x' })).body.recorded, false);
  });

  test('a guest or someone signed out cannot record anything', async () => {
    const res = await makeClient({ 'x-forwarded-for': '10.0.6.1' }).call(social, { method: 'POST', body: { version: 1 }, url: '/api/social/accept' });
    assert.equal(res.status, 401);
  });

  test('deleting the account deletes the record', async () => {
    const dan = await person('dan@example.com');
    await dan.call('accept', { version: 1, marketing: false });
    await dan.client.call(deleteAccount, { method: 'POST', body: { authSecret: await deriveAuthSecret(dan.password, dan.authSalt) } });
    assert.equal((await query('SELECT * FROM consents WHERE user_id = $1', [dan.id])).rows.length, 0);
  });

  test('the questionnaire no longer offers "Under 18"', async () => {
    const { ABOUT_QUESTIONS } = await import('../src/config/aboutYou.js');
    const age = ABOUT_QUESTIONS.find((q) => q.id === 'age');
    assert.ok(!age.options.some(([id]) => id === 'u18'));
  });
});
