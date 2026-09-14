/**
 * Past days priced as they were traded, not as the price history adjusts them.
 *
 * Found auditing a real bank history: SCO was bought at $7.79 on 7 April 2026
 * and the price history said $31.60 that day, because SCO did a 1-for-4 reverse
 * split on 28 May and every earlier close was multiplied by four. The account
 * swung +15.9%, −11.4%, +12.3% and −20.1% on days nothing of the kind happened,
 * and every window containing that week — six months, the year, all time — was
 * out by a point.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { asTradedClose } from '../src/core/portfolioHistory.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

describe('a close from before a split', () => {
  test('a reverse split is undone: SCO in April, before its 1-for-4 in May', () => {
    const r = asTradedClose(31.6, '2026-04-07', [{ date: '2026-05-28', numerator: 1, denominator: 4 }]);
    assert.ok(near(r, 7.9), `${r}`);
  });

  test('a forward split is undone the other way: NFLX before its 10-for-1', () => {
    const r = asTradedClose(120, '2025-06-02', [{ date: '2025-11-17', numerator: 10, denominator: 1 }]);
    assert.ok(near(r, 1200), `${r}`);
  });

  test('only the splits after the day count: IONZ in May, between its two reverse splits', () => {
    const splits = [
      { date: '2025-12-09', numerator: 1, denominator: 6 },
      { date: '2026-09-09', numerator: 1, denominator: 10 },
    ];
    const r = asTradedClose(28.8, '2026-05-21', splits);
    // Traded at $3.09 that day; the history said $28.80.
    assert.ok(near(r, 2.88), `${r}`);
  });

  test('a close on or after the split is left as it is', () => {
    const splits = [{ date: '2026-05-28', numerator: 1, denominator: 4 }];
    assert.equal(asTradedClose(30, '2026-05-28', splits), 30);
    assert.equal(asTradedClose(30, '2026-06-15', splits), 30);
  });
});

describe('a split the journal already applied', () => {
  test('is not undone twice: ETHU, reported by IBKR a day before the price service dates it', () => {
    // The IBKR import rescales every earlier ETHU holding to after-split shares,
    // which is the unit the adjusted history already uses.
    const splits = [{ date: '2025-04-09', numerator: 1, denominator: 20 }];
    const applied = [{ ticker: 'ETHU', date: '2025-04-08', ratio: 0.05 }];
    assert.equal(asTradedClose(7.23, '2025-01-10', splits, applied), 7.23);
  });

  test('while a different split of the same ticker still is', () => {
    const splits = [
      { date: '2025-04-09', numerator: 1, denominator: 20 },
      { date: '2026-03-02', numerator: 1, denominator: 5 },
    ];
    const applied = [{ ticker: 'ETHU', date: '2025-04-08', ratio: 0.05 }];
    assert.ok(near(asTradedClose(10, '2025-01-10', splits, applied), 2));
  });
});

test('no price is still no price', () => {
  assert.equal(asTradedClose(null, '2026-04-07', [{ date: '2026-05-28', numerator: 1, denominator: 4 }]), null);
});
