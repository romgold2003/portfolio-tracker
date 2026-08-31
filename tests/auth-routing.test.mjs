/**
 * The one function that all ten auth endpoints now live behind.
 *
 * This exists because of how the previous arrangement failed. Ten files meant
 * ten serverless functions, a Hobby deployment allows twelve, and the three the
 * password-reset flow added pushed the build over — at which point Vercel stops
 * deploying and the site quietly goes on serving the last good build. Nothing
 * was broken locally, every test passed, and the change simply never shipped.
 *
 * So the dispatcher is worth a test of its own: if a name here stops matching
 * the URL the browser asks for, that endpoint is a 404 in production and
 * nowhere else.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';

import auth from '../api/auth/[action].js';

process.env.NODE_ENV = 'test';

/** Every path src/services/cloud.js asks for. */
const ENDPOINTS = [
  'begin', 'signup', 'login', 'logout', 'session',
  'recover', 'password', 'forgot', 'reset', 'escrow',
];

beforeEach(() => {
  useDriver(sqliteDriver());
});

describe('the auth route', () => {
  test('every endpoint the app calls is reachable', async () => {
    const client = makeClient();
    for (const name of ENDPOINTS) {
      const res = await client.call(auth, {
        method: 'POST', url: `/api/auth/${name}`, body: {},
      });
      // What it answers depends on the endpoint — 400 for a malformed body, 401
      // for no session, 405 for the wrong method. None of those is 404, and 404
      // is the only failure this test is looking for.
      assert.notEqual(res.status, 404, `/api/auth/${name} should be routed`);
    }
  });

  test('a name nobody serves is a 404, not a crash', async () => {
    const client = makeClient();
    const res = await client.call(auth, {
      method: 'POST', url: '/api/auth/not-an-endpoint', body: {},
    });
    assert.equal(res.status, 404);
  });

  test('a query string does not change which endpoint is chosen', async () => {
    const client = makeClient();
    const withQuery = await client.call(auth, {
      method: 'GET', url: '/api/auth/session?from=test',
    });
    const without = await client.call(auth, { method: 'GET', url: '/api/auth/session' });
    assert.equal(withQuery.status, without.status);
    assert.deepEqual(withQuery.body, without.body);
  });

  test('a trailing slash still finds the endpoint', async () => {
    const client = makeClient();
    const res = await client.call(auth, { method: 'GET', url: '/api/auth/session/' });
    assert.notEqual(res.status, 404);
  });
});
