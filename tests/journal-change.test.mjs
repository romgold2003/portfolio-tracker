/**
 * Telling the views a different journal is in place.
 *
 * Reported: after replacing an imported bank history with IBKR statements the
 * app kept showing the bank account's returns. The daily history those returns
 * come from was cached by the home view and nothing said the journal had
 * changed. Every load and every sign-out now announces it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadState, clearState, onJournalLoaded, state } from '../src/core/store.js';

describe('a journal being replaced', () => {
  test('is announced when a journal is loaded, with the new one already in place', () => {
    const seen = [];
    const stop = onJournalLoaded(() => seen.push(state.cash));
    loadState({ positions: [], cash: 1234 });
    stop();
    assert.deepEqual(seen, [1234]);
  });

  test('is announced on sign-out too', () => {
    let calls = 0;
    const stop = onJournalLoaded(() => { calls += 1; });
    clearState();
    stop();
    assert.equal(calls, 1);
  });

  test('a listener that fails does not stop the load or the others', () => {
    let reached = false;
    const stopBad = onJournalLoaded(() => { throw new Error('broken view'); });
    const stopGood = onJournalLoaded(() => { reached = true; });
    loadState({ positions: [], cash: 50 });
    stopBad();
    stopGood();
    assert.equal(state.cash, 50);
    assert.equal(reached, true);
  });

  test('stops hearing once told to', () => {
    let calls = 0;
    const stop = onJournalLoaded(() => { calls += 1; });
    stop();
    loadState({ positions: [], cash: 1 });
    assert.equal(calls, 0);
  });
});
