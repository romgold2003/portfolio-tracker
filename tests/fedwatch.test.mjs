/**
 * The odds on the Fed's next move, from fed funds futures.
 *
 * The arithmetic is checked against a case worked by hand from real prices on
 * 31 August 2026, and the calendar handling against the boundary that matters:
 * the panel must move to the next meeting on its own the moment one passes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  nextMeeting, contractSymbol, impliedRateAfter,
  stepProbabilities, outcomeOdds, readDecision, requiredContracts,
  FOMC_MEETINGS,
} from '../api/_lib/fedwatch.js';

describe('the meeting it is talking about', () => {
  test('is the next one scheduled', () => {
    assert.equal(nextMeeting('2026-08-31'), '2026-09-16');
  });

  test('is still today\'s meeting on the day itself', () => {
    // The decision lands in the afternoon; until then it is the thing ahead.
    assert.equal(nextMeeting('2026-09-16'), '2026-09-16');
  });

  test('moves on by itself the day after', () => {
    assert.equal(nextMeeting('2026-09-17'), '2026-10-28');
  });

  test('crosses the year without being told', () => {
    assert.equal(nextMeeting('2026-12-10'), '2027-01-27');
  });

  test('runs out rather than inventing a date', () => {
    assert.equal(nextMeeting('2028-01-01'), null);
  });

  test('every date in the calendar is a real one, in order', () => {
    for (const d of FOMC_MEETINGS) {
      assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date(d + 'T00:00:00Z').toISOString().slice(0, 10), d);
    }
    assert.deepEqual([...FOMC_MEETINGS].sort(), FOMC_MEETINGS);
  });
});

describe('naming the contract', () => {
  test('uses the exchange month codes', () => {
    assert.equal(contractSymbol(2026, 9), 'ZQU26.CBT');   // September
    assert.equal(contractSymbol(2026, 12), 'ZQZ26.CBT');  // December
    assert.equal(contractSymbol(2027, 1), 'ZQF27.CBT');   // January
  });

  test('asks for the meeting month and the months before it', () => {
    const wanted = requiredContracts('2026-08-31');
    assert.ok(wanted.includes('ZQU26.CBT'), 'the meeting month');
    assert.ok(wanted.includes('ZQQ26.CBT'), 'the month before, which anchors the rate');
  });
});

describe('solving for the rate the meeting leaves behind', () => {
  /**
   * September 2026: 30 days, decision on the 16th. The new rate applies from
   * the 17th, so 16 days average the old rate and 14 the new one.
   */
  test('splits the month either side of the announcement', () => {
    const after = impliedRateAfter({
      impliedAverage: 3.705, entering: 3.630, year: 2026, month: 9, day: 16,
    });
    // (3.705 * 30 - 3.630 * 16) / 14
    assert.equal(after.toFixed(3), '3.791');
  });

  test('a meeting on the last day of the month tells you nothing', () => {
    // No day of the contract month is affected, so the price cannot speak to it.
    assert.equal(impliedRateAfter({
      impliedAverage: 3.7, entering: 3.63, year: 2026, month: 9, day: 30,
    }), null);
  });
});

describe('turning a rate into odds', () => {
  test('a rate between two steps splits between them', () => {
    // 10bp of a 25bp step is the market pricing the move at two in five.
    const odds = outcomeOdds(3.630, 3.730);
    assert.equal((odds.increase * 100).toFixed(1), '40.0');
    assert.equal((odds.hold * 100).toFixed(1), '60.0');
    assert.equal(odds.decrease, 0);
  });

  test('a rate exactly on a step is that step alone', () => {
    const odds = outcomeOdds(3.630, 3.630);
    assert.equal(odds.hold, 1);
    assert.equal(odds.increase, 0);
    assert.equal(odds.decrease, 0);
  });

  test('a cut reads as a cut', () => {
    const odds = outcomeOdds(4.00, 3.90);
    assert.equal((odds.decrease * 100).toFixed(0), '40');
    assert.equal((odds.hold * 100).toFixed(0), '60');
  });

  test('more than a quarter point is carried outward, not clipped', () => {
    // Priced at 37.5bp: half of a 25 and half of a 50, both increases.
    const steps = stepProbabilities(4.00, 4.375);
    assert.deepEqual(steps.map((s) => s.steps), [1, 2]);
    assert.equal(outcomeOdds(4.00, 4.375).increase, 1);
  });

  test('the three always account for the whole of it', () => {
    for (const expected of [3.4, 3.63, 3.7, 3.88, 4.1, 3.2]) {
      const odds = outcomeOdds(3.63, expected);
      const total = odds.increase + odds.hold + odds.decrease;
      assert.ok(Math.abs(total - 1) < 1e-9, `${expected} summed to ${total}`);
    }
  });
});

describe('reading a decision from contract prices', () => {
  // The real prices on 31 August 2026.
  const prices = { 'ZQQ26.CBT': 96.37, 'ZQU26.CBT': 96.295 };

  test('anchors on the month with no meeting in it', () => {
    const d = readDecision({ today: '2026-08-31', prices });
    assert.equal(d.meeting, '2026-09-16');
    // August holds no meeting, so its average states the prevailing rate.
    assert.equal(d.entering.toFixed(3), '3.630');
    assert.equal(d.expected.toFixed(3), '3.791');
    assert.equal(Math.round(d.changeBps), 16);
    assert.equal((d.odds.increase * 100).toFixed(1), '64.3');
  });

  test('says nothing rather than guessing when the contracts are missing', () => {
    assert.equal(readDecision({ today: '2026-08-31', prices: {} }), null);
    assert.equal(readDecision({ today: '2026-08-31', prices: { 'ZQQ26.CBT': 96.37 } }), null);
  });

  test('a nonsense price is treated as no price', () => {
    assert.equal(readDecision({
      today: '2026-08-31', prices: { 'ZQQ26.CBT': 0, 'ZQU26.CBT': 96.295 },
    }), null);
  });
});
