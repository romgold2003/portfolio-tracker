/**
 * The Clavis landing page (November 2026): in front of the sign-in card for a
 * first-time visitor, once per device.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('seen once a real account has signed in on this device, under the pt_ prefix', async () => {
  const { landingSeen, markLandingSeen } = await import('../src/ui/views/landing.js');
  assert.equal(landingSeen(), false);
  markLandingSeen();
  assert.equal(landingSeen(), true);
  assert.equal(store.get('pt_landing_seen'), '1');
});

test('the lock screen shows it in cloud mode on sign-in only, and marks it on a real sign-in, not a guest', () => {
  const lock = read('src/ui/views/lockScreen.js');
  assert.match(lock, /if \(cloudMode\(\) && mode === 'signin' && !landingSeen\(\)\)/);
  assert.match(lock, /if \(!isGuest\(\)\) markLandingSeen\(\);/);
  assert.match(lock, /choice === 'demo'\) \{ enterAsGuest\(\)/);
});

test('every button leads somewhere: sign in, start free, the demo', () => {
  const page = read('src/ui/views/landing.js');
  const actions = new Set([...page.matchAll(/data-ld="(\w+)"/g)].map((m) => m[1]));
  assert.deepEqual([...actions].sort(), ['create', 'demo', 'signin']);
  assert.match(page, /not investment advice/);
});
