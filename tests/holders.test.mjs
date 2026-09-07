/**
 * Holder balances: the one tracker here that watches what is held, not what moved.
 *
 * This is the only tracker in the app that watches balances rather than flows,
 * and the reason is worth restating: a whale can sell through an exchange, over
 * the counter, by bridging somewhere unread, or by shorting a perpetual that
 * never touches spot. Six ordinary routes out, and the transfer tracker catches
 * one. A balance catches all of them, because it is not an event — whatever the
 * route, the holding fell.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import * as holders from '../api/_lib/holders.js';

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;

const snap = (over = {}) => ([{
  chain: 'ethereum', token: '0xTOK', symbol: 'FOO', holder: '0xTEAM',
  name: 'GnosisSafeProxy', kind: 'team', units: 40_000_000, usd: 80_000_000, ...over,
}]);

beforeEach(() => {
  useDriver(sqliteDriver());
  holders.resetTableCache();
  holders.resetCreatorCache();
});

describe('what kind of holder it is', () => {
  test('the address that created the contract is the deployer', () => {
    assert.equal(holders.classify({
      address: '0xAAA', name: null, isContract: false, creator: '0xaaa',
    }), 'deployer', 'the comparison must not care about case');
  });

  test('a Safe, a timelock or a vesting contract is the team', () => {
    // This is how teams and treasuries actually hold an allocation. Chainlink's
    // top holders include five Safes of thirty million LINK each.
    for (const name of ['GnosisSafeProxy', 'SafeProxy', 'TokenVesting', 'Timelock', 'Treasury']) {
      assert.equal(holders.classify({ address: '0xB', name, isContract: true, creator: '0xZ' }),
        'team', `${name} was not read as an insider`);
    }
  });

  test('an ordinary contract is a contract, not a team', () => {
    // A pool holding a lot of a token is liquidity, not an allocation.
    assert.equal(holders.classify({
      address: '0xD', name: 'UniswapV3Pool', isContract: true, creator: '0xZ',
    }), 'contract');
  });

  test('an unattributed address stays a plain wallet', () => {
    assert.equal(holders.classify({
      address: '0xE', name: null, isContract: false, creator: '0xZ',
    }), 'wallet');
    assert.ok(holders.INSIDER.has('team') && holders.INSIDER.has('deployer'));
    assert.ok(!holders.INSIDER.has('wallet') && !holders.INSIDER.has('contract'));
  });
});

describe('a balance falling over time', () => {
  test('a team selling down across three days is one report of the whole fall', async () => {
    await holders.record(snap({ units: 40_000_000, usd: 80_000_000 }), { now: NOW - 3 * DAY });
    await holders.record(snap({ units: 33_000_000, usd: 66_000_000 }), { now: NOW - 2 * DAY });
    await holders.record(snap({ units: 25_000_000, usd: 50_000_000 }), { now: NOW });

    const [m] = await holders.changes({ days: 7, now: NOW, minUsd: 1_000_000 });
    assert.equal(m.kind, 'team');
    assert.equal(m.insider, true);
    // Against the earliest snapshot in the window, not against yesterday: a
    // position sold down over three weeks is three weeks of selling.
    assert.equal(m.unitsBefore, 40_000_000);
    assert.equal(m.unitsAfter, 25_000_000);
    assert.equal(m.pct, -37.5);
    assert.equal(m.usdDelta, -30_000_000);
  });

  test('a holder seen only once has not sold anything', async () => {
    // It has only just been seen. Calling that a sale would make every new
    // entry to the top fifty an alarm.
    await holders.record(snap({ holder: '0xNEW' }), { now: NOW });
    const moves = await holders.changes({ days: 7, now: NOW });
    assert.ok(!moves.some((m) => m.holder === '0xNEW'));
  });

  test('two snapshots in one day are one snapshot', async () => {
    await holders.record(snap({ units: 40_000_000 }), { now: NOW });
    await holders.record(snap({ units: 39_000_000 }), { now: NOW + 3600_000 });
    // Same day, so the second replaced the first and there is nothing to
    // compare against yet.
    assert.deepEqual(await holders.changes({ days: 7, now: NOW + 3600_000 }), []);
  });

  test('a wobble is not a decision', async () => {
    await holders.record(snap({ units: 40_000_000, usd: 80_000_000 }), { now: NOW - DAY });
    await holders.record(snap({ units: 39_800_000, usd: 79_600_000 }), { now: NOW });
    assert.deepEqual(await holders.changes({ days: 7, now: NOW, minPct: 2 }), []);
  });

  test('buying is reported too, and reads as positive', async () => {
    await holders.record(snap({ units: 10_000_000, usd: 20_000_000 }), { now: NOW - DAY });
    await holders.record(snap({ units: 25_000_000, usd: 50_000_000 }), { now: NOW });
    const [m] = await holders.changes({ days: 7, now: NOW, minUsd: 1_000_000 });
    assert.ok(m.usdDelta > 0);
    assert.equal(m.pct, 150);
  });

  test('a window that ends before the change began reports nothing', async () => {
    await holders.record(snap({ units: 40_000_000 }), { now: NOW - 40 * DAY });
    await holders.record(snap({ units: 25_000_000 }), { now: NOW - 35 * DAY });
    assert.deepEqual(await holders.changes({ days: 7, now: NOW }), []);
    assert.equal((await holders.changes({ days: 60, now: NOW, minUsd: 1 })).length, 1);
  });

  test('what has aged out is dropped', async () => {
    await holders.record(snap({ units: 40_000_000 }), { now: NOW - 200 * DAY });
    await holders.record(snap({ units: 25_000_000 }), { now: NOW });
    await holders.prune({ now: NOW });
    // Only the recent snapshot survives, so there is no earlier one to
    // difference against and nothing is claimed.
    assert.deepEqual(await holders.changes({ days: 365, now: NOW }), []);
  });
});
