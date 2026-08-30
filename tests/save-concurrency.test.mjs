/**
 * Saving must not race itself.
 *
 * The bug these cover: writing to localStorage was instant, so two saves could
 * never overlap and nothing guarded against it. Writing to a server takes a few
 * hundred milliseconds, and a price refresh, a tab switch and a snapshot timer
 * can each start one inside that window. Both sent the same base version, the
 * server rejected the second, and the app told the user another device had
 * changed their journal — every thirty seconds, on one device.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  state, setPersistHandler, flushNow, savePositions,
} from '../src/core/store.js';

/**
 * Stands in for the server: accepts a save only when it states the version the
 * store currently holds, exactly as the vault endpoint does.
 */
function fakeServer({ latencyMs = 20 } = {}) {
  const server = {
    version: 1,
    conflicts: 0,
    writes: 0,
    /** What the client believes the version is. */
    clientVersion: 1,
    async save() {
      const claimed = server.clientVersion;
      await new Promise((r) => setTimeout(r, latencyMs));
      if (claimed !== server.version) {
        server.conflicts += 1;
        const err = new Error('Your journal was changed on another device.');
        err.conflict = true;
        throw err;
      }
      server.version += 1;
      server.clientVersion = server.version;
      server.writes += 1;
    },
  };
  return server;
}

beforeEach(() => {
  state.positions = [];
  state.cash = 0;
  state.snapshots = [];
  state.apiKey = '';
  setPersistHandler(null);
});

describe('overlapping saves', () => {
  test('three saves fired at once produce no conflict', async () => {
    const server = fakeServer({ latencyMs: 30 });
    setPersistHandler(() => server.save());

    // A price refresh, a snapshot and a tab switch, all inside one network trip.
    await Promise.all([flushNow(), flushNow(), flushNow()]);

    assert.equal(server.conflicts, 0, 'a save raced itself and was reported as a device clash');
    assert.ok(server.writes >= 1, 'nothing was written at all');
  });

  test('a change made mid-save is still written', async () => {
    const server = fakeServer({ latencyMs: 40 });
    let seen = null;
    setPersistHandler(async (journal) => {
      await server.save();
      seen = journal.cash;
    });

    const first = flushNow();
    // The user edits while the first save is in the air.
    state.cash = 4242;
    await Promise.all([first, flushNow()]);

    assert.equal(server.conflicts, 0);
    assert.equal(seen, 4242, 'the change made during the save was never persisted');
  });

  test('a burst of scheduled saves collapses without conflicts', async () => {
    const server = fakeServer({ latencyMs: 15 });
    setPersistHandler(() => server.save());

    for (let i = 0; i < 12; i++) savePositions();
    await new Promise((r) => setTimeout(r, 400));
    await flushNow();

    assert.equal(server.conflicts, 0, 'a burst of edits raced itself');
  });
});

describe('a real conflict', () => {
  test('is still reported once the retry has also failed', async () => {
    // A server that has genuinely moved on, and stays ahead however often the
    // client retries — another device writing continuously.
    let reported = null;
    setPersistHandler(async () => {
      const err = new Error('Your journal was changed on another device.');
      err.conflict = true;
      throw err;
    });

    const originalAlert = globalThis.alert;
    globalThis.alert = (message) => { reported = message; };
    try {
      await flushNow();
    } finally {
      globalThis.alert = originalAlert;
    }

    assert.ok(reported, 'a genuine conflict must still be surfaced');
    assert.match(reported, /changed somewhere else/i);
    assert.doesNotMatch(
      reported, /private browsing/i,
      'a device clash must not be explained as a browser storage failure',
    );
  });

  test('a storage failure keeps its own explanation', async () => {
    let reported = null;
    setPersistHandler(async () => { throw new Error('QuotaExceededError'); });

    const originalAlert = globalThis.alert;
    globalThis.alert = (message) => { reported = message; };
    try {
      await flushNow();
    } finally {
      globalThis.alert = originalAlert;
    }

    assert.ok(reported);
    assert.match(reported, /private browsing|storage/i);
    assert.doesNotMatch(reported, /another device/i);
  });

  test('is reported once, not on every retry of a failing save', async () => {
    let alerts = 0;
    setPersistHandler(async () => { throw new Error('offline'); });

    const originalAlert = globalThis.alert;
    globalThis.alert = () => { alerts += 1; };
    try {
      await flushNow();
      await flushNow();
      await flushNow();
    } finally {
      globalThis.alert = originalAlert;
    }

    assert.equal(alerts, 1, 'the same failure was announced repeatedly');
  });
});
