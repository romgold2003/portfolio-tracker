/**
 * The account against the indexes.
 *
 * A comparison chart is only worth drawing if every line is measured from the
 * same morning over the same days. Most of what is checked here is that — the
 * rebasing, the shut-market days, and the refusal to draw a line that would be
 * measured from a different start than the one beside it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { closeOn, rebase, benchmarkLines, leadOver } from '../src/core/benchmarkCurve.js';

const rows = (...pairs) => pairs.map(([date, close]) => ({ date, close }));

describe('reading an index on a given day', () => {
  const spx = rows(['2026-01-02', 100], ['2026-01-05', 102], ['2026-01-06', 104]);

  test('an exact trading day is itself', () => {
    assert.equal(closeOn(spx, '2026-01-05'), 102);
  });

  test('a weekend carries the last close forward', () => {
    // 3 and 4 January are a Saturday and Sunday: nothing traded, so the level
    // did not change.
    assert.equal(closeOn(spx, '2026-01-03'), 100);
    assert.equal(closeOn(spx, '2026-01-04'), 100);
  });

  test('a date before the history begins has no close', () => {
    assert.equal(closeOn(spx, '2025-12-31'), null);
  });

  test('a date after the last close holds at the last close', () => {
    assert.equal(closeOn(spx, '2026-02-01'), 104);
  });

  test('a gap in the data is skipped rather than drawn as zero', () => {
    const holed = rows(['2026-01-02', 100], ['2026-01-05', null], ['2026-01-06', 104]);
    assert.equal(closeOn(holed, '2026-01-05'), 100);
  });
});

describe('rebasing an index onto the window', () => {
  const dates = ['2026-01-02', '2026-01-03', '2026-01-05', '2026-01-06'];
  const spx = rows(['2026-01-02', 100], ['2026-01-05', 110], ['2026-01-06', 105]);

  test('starts at zero, like every other line', () => {
    assert.equal(rebase(spx, dates)[0], 0);
  });

  test('is the move from the first day, in percent', () => {
    const r = rebase(spx, dates);
    assert.equal(r[2], 10);   // 110 on 100
    assert.equal(r[3], 5);    // 105 on 100
  });

  test('a shut day repeats the day before rather than dipping', () => {
    const r = rebase(spx, dates);
    assert.equal(r[1], 0, 'the weekend drew a fall that never happened');
  });

  test('an index with no close by the opening day is refused', () => {
    /**
     * The important one. A history that starts after the window would other-
     * wise be rebased to its own first day, putting two lines on one chart
     * measured from different mornings — which reads as the account beating
     * the market by however much the market moved before the line began.
     */
    const late = rows(['2026-03-01', 100], ['2026-03-02', 110]);
    assert.equal(rebase(late, dates), null);
  });

  test('no history at all is refused rather than drawn flat', () => {
    assert.equal(rebase([], dates), null);
    assert.equal(rebase(null, dates), null);
  });
});

describe('the lines the chart draws', () => {
  const dates = ['2026-01-02', '2026-01-05', '2026-01-06'];
  const percent = [0, 5, 12];
  const indexes = [
    { symbol: 'VOO', name: 'S&P 500', rows: rows(['2026-01-02', 100], ['2026-01-05', 102], ['2026-01-06', 104]) },
    { symbol: 'QQQ', name: 'Nasdaq 100', rows: rows(['2026-01-02', 50], ['2026-01-05', 52], ['2026-01-06', 55]) },
  ];

  test('the account comes first and keeps its own numbers', () => {
    const { lines } = benchmarkLines({ dates, percent, indexes });
    assert.equal(lines[0].key, 'account');
    assert.deepEqual(lines[0].data, percent);
  });

  test('every index that could be rebased is drawn', () => {
    const { lines, missing } = benchmarkLines({ dates, percent, indexes });
    assert.deepEqual(lines.map((l) => l.key), ['account', 'VOO', 'QQQ']);
    assert.deepEqual(missing, []);
    assert.deepEqual(lines[1].data, [0, 2, 4]);
    assert.deepEqual(lines[2].data, [0, 4, 10]);
  });

  test('all three lines are the same length as the window', () => {
    const { lines } = benchmarkLines({ dates, percent, indexes });
    for (const line of lines) assert.equal(line.data.length, dates.length);
  });

  test('an index that could not be fetched is named, not silently dropped', () => {
    const { lines, missing } = benchmarkLines({
      dates, percent, indexes: [indexes[0], { symbol: 'QQQ', name: 'Nasdaq 100', rows: null }],
    });
    assert.deepEqual(lines.map((l) => l.key), ['account', 'VOO']);
    assert.deepEqual(missing, ['Nasdaq 100']);
  });

  test('with no indexes at all the account still draws', () => {
    const { lines, missing } = benchmarkLines({ dates, percent, indexes: [] });
    assert.equal(lines.length, 1);
    assert.deepEqual(missing, []);
  });
});

describe('how far ahead the account finished', () => {
  const dates = ['2026-01-02', '2026-01-06'];
  const indexes = [
    { symbol: 'VOO', name: 'S&P 500', rows: rows(['2026-01-02', 100], ['2026-01-06', 104]) },
  ];

  test('is the gap between the two right-hand ends', () => {
    const { lines } = benchmarkLines({ dates, percent: [0, 12], indexes });
    assert.deepEqual(leadOver(lines), [{ name: 'S&P 500', points: 8 }]);
  });

  test('and is negative when the market won', () => {
    const { lines } = benchmarkLines({ dates, percent: [0, 1], indexes });
    assert.deepEqual(leadOver(lines), [{ name: 'S&P 500', points: -3 }]);
  });

  test('nothing to compare against is an empty list, not a zero', () => {
    const { lines } = benchmarkLines({ dates, percent: [0, 12], indexes: [] });
    assert.deepEqual(leadOver(lines), []);
  });
});

describe('a placeholder account line is not raced against the market', () => {
  const dates = ['2026-01-02', '2026-01-06'];
  const indexes = [
    { symbol: 'VOO', name: 'S&P 500', rows: rows(['2026-01-02', 100], ['2026-01-06', 104]) },
  ];

  /**
   * With too little history the curve falls back to an illustrative shape that
   * ends on the true account value. It is fine as a picture of a balance while
   * the real days accumulate. It is not a performance record, and it rises by
   * a fixed amount by construction — so drawing it against real index data
   * would show a fabricated line winning or losing a race it never ran.
   */
  test('it is left out and said to be missing', () => {
    const { lines, missing } = benchmarkLines({
      dates, percent: [0, 16], indexes, accountReady: false,
    });
    assert.deepEqual(lines.map((l) => l.key), ['VOO']);
    assert.match(missing.join(' '), /your own history/i);
  });

  test('so there is no lead to report either', () => {
    const { lines } = benchmarkLines({ dates, percent: [0, 16], indexes, accountReady: false });
    assert.deepEqual(leadOver(lines), []);
  });

  test('and with real history it is drawn as normal', () => {
    const { lines, missing } = benchmarkLines({
      dates, percent: [0, 16], indexes, accountReady: true,
    });
    assert.equal(lines[0].key, 'account');
    assert.deepEqual(missing, []);
  });
});
