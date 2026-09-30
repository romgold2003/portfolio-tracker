/**
 * Holding a session lookup for a few seconds, and what that is allowed to cost.
 *
 * Every endpoint asks who a token belongs to before it does anything, and the
 * answer costs two queries — the session, then the user. Opening the News page
 * fires five panels at once, so one page view was ten round trips.
 *
 * The database is billed by how long it stays awake and suspends itself when
 * nothing touches it, which makes a steady trickle of queries worse than an
 * occasional burst: the trickle is what stops it ever going to sleep. So the
 * lookup is held briefly, and the bursts collapse.
 *
 * The cost is real and worth naming: a session revoked somewhere else stays
 * usable on an already-warm server until the window passes. These tests are
 * mostly about the cases where that must NOT happen — signing out, changing a
 * password, deleting an account — because those are the ones where a stale yes
 * would matter.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/_lib/accounts.js', import.meta.url), 'utf8');
const lookup = source.match(/export async function userForToken[\s\S]*?\n\}/)[0];

describe('the window', () => {
  test('is short enough that "signed out everywhere" still means it', () => {
    const ttl = source.match(/const SESSION_TTL_MS = ([\d_]+);/);
    assert.ok(ttl, 'the cache has gone from accounts.js');
    const ms = Number(ttl[1].replace(/_/g, ''));
    assert.ok(ms <= 30_000, `${ms}ms is too long to call a sign-out immediate`);
    assert.ok(ms >= 5_000, `${ms}ms is too short to collapse a page load`);
  });
});

describe('every way a session is torn down also forgets it', () => {
  const body = (name) => {
    const m = source.match(new RegExp(`function ${name}\\(([\\s\\S]*?)\\n\\}`));
    assert.ok(m, `${name} is missing`);
    return m[1];
  };

  test('signing out drops the token it just deleted', () => {
    assert.match(body('endSession'), /forgetSession\(token\)/);
  });

  test('a password change, which signs out everywhere, drops everything held', () => {
    assert.match(body('endAllSessions'), /forgetAllSessions\(\)/);
  });

  test('and so does deleting the account', () => {
    assert.match(body('deleteUser'), /forgetAllSessions\(\)/);
  });

  test('the forgetting comes before the delete, not after', () => {
    // If the delete throws, the cache must already be clear rather than still
    // holding a session the database no longer has.
    const end = body('endSession');
    assert.ok(end.indexOf('forgetSession') < end.indexOf('DELETE FROM sessions'),
      'a failed delete would leave the session usable');
  });
});

describe('what is remembered', () => {
  test('includes "no such session", so a bad token is not re-queried in a loop', () => {
    assert.match(lookup, /sessionCache\.set\(key, \{ at: Date\.now\(\), gen, user: null \}\)/);
  });

  test('is keyed by the hash, never by the token itself', () => {
    assert.match(lookup, /const key = hashToken\(token\)/);
    assert.doesNotMatch(lookup, /sessionCache\.(get|set)\(token/, 'a raw token must not be a key');
  });

  test('is thrown away when the database underneath changes', () => {
    // db.js keeps a generation counter for exactly this: anything holding a
    // value that came out of the database has to check it, or swapping the
    // database leaves behind an answer that belonged to the old one.
    assert.match(lookup, /const gen = driverGeneration\(\)/);
    assert.match(lookup, /held\.gen === gen/);
    assert.doesNotMatch(lookup, /sessionCache\.set\(key, \{ at: Date\.now\(\), user/,
      'an entry with no generation on it cannot be checked against one');
  });

  test('and an expired row is never cached as valid', () => {
    const expiry = lookup.indexOf('expires_at');
    const cacheValid = lookup.indexOf('sessionCache.set(key, { at: Date.now(), gen, user });');
    assert.ok(expiry < cacheValid, 'expiry has to be checked before the answer is kept');
  });
});
