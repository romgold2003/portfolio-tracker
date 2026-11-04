/**
 * "About you" (November 2026): eight optional questions a new account is
 * asked once after sign-up, kept on the server apart from the encrypted
 * journal so Romy can see who uses Riskbook. Against SQLite in memory.
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
import { ABOUT_CHOICES, cleanAnswers } from '../api/_lib/about.js';
import { ABOUT_QUESTIONS, COUNTRY_CODES, COMMON_COUNTRIES, countryName } from '../src/config/aboutYou.js';
import {
  generateDataKey, wrapDataKey, encryptJson, generateRecoveryKey, normalizeRecoveryKey,
  generateAuthSalt, deriveAuthSecret,
} from '../src/core/crypto.js';

process.env.NODE_ENV = 'test';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

let ip = 50;
async function person(email, password = 'correct horse battery') {
  const client = makeClient({ 'x-forwarded-for': `10.0.1.${ip++}` });
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
  const about = (body) => client.call(social, { method: 'POST', body, url: '/api/social/about' });
  return { id: res.body.user.id, client, about, authSalt, password };
}

beforeEach(() => { useDriver(sqliteDriver()); });

describe('the questions', () => {
  test('the eight Romy chose, in her order', () => {
    assert.deepEqual(ABOUT_QUESTIONS.map((q) => q.id), ['sex', 'age', 'goal', 'experience', 'style', 'country', 'heard', 'occupation']);
  });

  test('the app offers exactly the answers the server accepts', () => {
    for (const q of ABOUT_QUESTIONS.filter((x) => !x.country)) {
      assert.deepEqual(q.options.map(([id]) => id), ABOUT_CHOICES[q.id], q.id);
    }
  });

  test('every country, each with a name, Israel first among the suggested', () => {
    assert.ok(COUNTRY_CODES.length >= 245, `${COUNTRY_CODES.length}`);
    assert.equal(new Set(COUNTRY_CODES).size, COUNTRY_CODES.length);
    assert.equal(COMMON_COUNTRIES[0], 'IL');
    assert.equal(countryName('IL'), 'Israel');
    for (const c of COMMON_COUNTRIES) assert.ok(COUNTRY_CODES.includes(c), c);
  });

  test('the country window finds a country by name and lists them all A to Z', async () => {
    const { countryListHtml } = await import('../src/ui/views/aboutYou.js');
    const fr = countryListHtml('fran');
    assert.match(fr, /data-country="FR"/);
    assert.doesNotMatch(fr, /data-country="IL"/);
    const all = countryListHtml('');
    assert.equal((all.match(/data-country="/g) ?? []).length, COUNTRY_CODES.length);
    assert.ok(all.indexOf('Afghanistan') < all.indexOf('Zimbabwe'));
    assert.match(countryListHtml('zzzz'), /No country called/);
  });

  test('one question a slide: a welcome that reassures, the eight questions, a thank-you', async () => {
    const { slideHtml } = await import('../src/ui/views/aboutYou.js');
    const welcome = slideHtml(0, {});
    assert.match(welcome, /Let’s get to know you/);
    assert.match(welcome, /portfolio stays encrypted/);
    assert.match(welcome, /answers stay private/);
    assert.match(welcome, /data-about-skipall/);
    ABOUT_QUESTIONS.forEach((q, n) => {
      const html = slideHtml(n + 1, {});
      assert.match(html, new RegExp(`Question ${n + 1} of ${ABOUT_QUESTIONS.length}`), q.id);
      assert.ok(html.includes(q.ask.replace(/'/g, '&#39;')), q.id);
      assert.match(html, /data-about-back/);
      assert.match(html, /Skip ›/, 'every question can be skipped');
      for (const [, , emoji] of q.options ?? []) assert.ok(html.includes(emoji), `${q.id} ${emoji}`);
    });
    const chosen = slideHtml(1, { sex: 'female' });
    assert.match(chosen, /data-q="sex" data-v="female" aria-pressed="true"/);
    assert.match(chosen, /Next ›/);
    const country = slideHtml(ABOUT_QUESTIONS.findIndex((q) => q.country) + 1, { country: 'IL' });
    for (const c of COMMON_COUNTRIES) assert.match(country, new RegExp(`data-country="${c}"`));
    assert.match(country, /id="aboutSearch"/);
    assert.match(slideHtml(ABOUT_QUESTIONS.length + 1, { sex: 'female' }), /Thank you/);
    assert.match(slideHtml(ABOUT_QUESTIONS.length + 1, {}), /data-about-finish/);
  });
});

describe('on the server', () => {
  test('saved, apart from the journal, and saved again replaces it', async () => {
    const romy = await person('romy@example.com');
    let res = await romy.about({ sex: 'female', age: '18-24', goal: 'wealth', country: 'il', heard: 'university' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.answered, 5);
    res = await romy.about({ sex: 'female', age: '25-34', occupation: 'student', country: 'IL' });
    assert.equal(res.status, 200);
    const { rows } = await query('SELECT * FROM about_you WHERE user_id = $1', [romy.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].age, '25-34');
    assert.equal(rows[0].country, 'IL');
    assert.equal(rows[0].occupation, 'student');
    assert.equal(rows[0].goal, null, 'a later answer replaces the whole set');
  });

  test('only the listed choices are kept: anything else is left empty', () => {
    const a = cleanAnswers({ sex: 'robot', age: '25-34', country: 'Israel', goal: '<script>', extra: 'x' });
    assert.equal(a.sex, null);
    assert.equal(a.age, '25-34');
    assert.equal(a.country, null);
    assert.equal(a.goal, null);
    assert.ok(!('extra' in a));
  });

  test('signed in only', async () => {
    const res = await makeClient({ 'x-forwarded-for': '10.0.2.1' }).call(social, { method: 'POST', body: { sex: 'male' }, url: '/api/social/about' });
    assert.equal(res.status, 401);
  });

  test('deleting the account deletes the answers', async () => {
    const dan = await person('dan@example.com');
    await dan.about({ sex: 'male', age: '35-44' });
    const res = await dan.client.call(deleteAccount, {
      method: 'POST', body: { authSecret: await deriveAuthSecret(dan.password, dan.authSalt) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { rows } = await query('SELECT * FROM about_you WHERE user_id = $1', [dan.id]);
    assert.equal(rows.length, 0);
  });
});

describe('when it is asked', () => {
  test('every account once, new or made before the questions — and before the tutorial, which follows it', async () => {
    const store = read('src/core/store.js');
    // Accounts made before the questions have no flag, so they are asked too.
    assert.match(store, /aboutVersion: 0,/);
    assert.match(store, /aboutVersion: state\.aboutVersion/);
    assert.match(read('src/ui/views/aboutYou.js'), /if \(!aboutDue\(\) \|\| !isUnlocked\(\)\) return;/);
    assert.match(read('src/ui/views/tour.js'), /\(aboutDue\(\) && cloudEnabled\(\)\)/);
    // Only the eight questions: an existing account is never asked for its email or password again.
    const { slideHtml } = await import('../src/ui/views/aboutYou.js');
    for (let i = 0; i <= ABOUT_QUESTIONS.length + 1; i++) assert.doesNotMatch(slideHtml(i, {}), /email|password/i, `slide ${i}`);
    const view = read('src/ui/views/aboutYou.js');
    assert.match(view, /if \(!state\.tourSeen\) setTimeout\(openTour/);
    assert.match(read('src/app/actions.js'), /import '\.\.\/ui\/views\/aboutYou\.js';/);
  });

  test('everyone is asked this round at their next sign-in — new, never asked, or answered the first round', async () => {
    const { loadState, clearState, aboutDue, setAboutDone, state } = await import('../src/core/store.js');
    const { ABOUT_VERSION } = await import('../src/config/aboutYou.js');
    assert.ok(ABOUT_VERSION >= 2);
    const journal = (extra) => ({ positions: [], cash: 0, snapshots: [], priceLog: {}, apiKey: '', ...extra });
    for (const [label, extra, due] of [
      ['a new account', {}, true],
      ['an account from before the questions', { tourSeen: true }, true],
      ['an account that answered the first, darker round', { aboutDone: true }, true],
      ['an account that answered this round', { aboutVersion: ABOUT_VERSION }, false],
    ]) {
      clearState();
      loadState(journal(extra));
      assert.equal(aboutDue(), due, label);
    }
    clearState();
    loadState(journal({ aboutDone: true }));
    setAboutDone();
    assert.equal(state.aboutVersion, ABOUT_VERSION);
    assert.equal(aboutDue(), false, 'answered or skipped: not asked again this round');
    clearState();
  });

  test('a new cloud account opens the journal it was made with, not an empty one', () => {
    // Without it the About you flag was lost on the first load and the questions never showed.
    assert.match(read('src/core/profiles.js'), /session = \{ profile: response\.user, dataKey, version: response\.vaultVersion, blob: vault \};/);
  });
});
