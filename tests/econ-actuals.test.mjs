/**
 * The figure a release actually printed.
 *
 * The calendar feed carries no actual on any row, so the number is read from
 * FRED and matched back onto the release. Nothing joins the two: a Thursday
 * claims release reports the week that ended the Saturday before, and an
 * August CPI is published in September. So the match is made by proving the
 * reading *behind* the newest one is what the calendar calls the previous.
 *
 * The failure this is written against is the quiet one. Before an agency
 * posts, FRED's newest observation is still the last release — publish it
 * unchecked and the panel shows a stale number as though it were today's news,
 * which is worse than the blank it replaced.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SERIES, seriesUrl, parseSeries, formatValue, actualFor, coverageStart,
  fetchActuals, attachActuals,
} from '../api/_lib/fred.js';

const csv = (rows) => ['observation_date,VALUE', ...rows].join('\n');

/** Weekly jobless claims, in the shape FRED serves them. */
const CLAIMS = parseSeries(csv([
  '2026-08-08,212000',
  '2026-08-15,207000',
  '2026-08-22,203000',
]));

describe('reading a series', () => {
  test('dates and values come off the CSV', () => {
    assert.deepEqual(CLAIMS[2], { date: '2026-08-22', value: 203000 });
    assert.equal(CLAIMS.length, 3);
  });

  test("FRED's dot for a period with no figure is dropped", () => {
    const rows = parseSeries(csv(['2026-08-15,.', '2026-08-22,203000']));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, 203000);
  });

  test('a header-only or empty answer is an empty series, not a crash', () => {
    assert.deepEqual(parseSeries(csv([])), []);
    assert.deepEqual(parseSeries(''), []);
    assert.deepEqual(parseSeries(null), []);
  });

  test('the request asks for two years and carries the transformation', () => {
    const url = seriesUrl(SERIES['cpi-y'], new Date('2026-09-03T12:00:00Z'));
    assert.match(url, /id=CPIAUCSL/);
    assert.match(url, /transformation=pc1/);
    assert.match(url, /cosd=2024-09-03/);
  });

  test('a series quoted as a level asks for no transformation', () => {
    assert.ok(!seriesUrl(SERIES.claims).includes('transformation'));
  });
});

describe('quoting it the way the calendar does', () => {
  test('claims are thousands', () => {
    assert.equal(formatValue(203000, 'thousands'), '203K');
    assert.equal(formatValue(212500, 'thousands'), '213K');
  });

  test('rates and changes carry one decimal and a sign', () => {
    assert.equal(formatValue(4.1, 'percent'), '4.1%');
    assert.equal(formatValue(-0.42248, 'percent'), '-0.4%');
    assert.equal(formatValue(0.07367, 'percent'), '0.1%');
  });

  test('nothing to format is nothing, not NaN', () => {
    assert.equal(formatValue(NaN, 'percent'), null);
    assert.equal(formatValue(undefined, 'thousands'), null);
  });
});

describe('the period a release covers', () => {
  test('weekly claims reach back to the Saturday the week ended', () => {
    // Thursday 3 September reports the week ended Saturday 29 August.
    assert.ok(coverageStart('2026-09-03', 'week') <= '2026-08-29');
    assert.ok(coverageStart('2026-09-03', 'week') > '2026-08-22');
  });

  test('a monthly figure describes the month before it lands in', () => {
    assert.equal(coverageStart('2026-09-10', 'month'), '2026-08-01');
    assert.equal(coverageStart('2026-01-13', 'month'), '2025-12-01');
  });

  test('GDP describes the quarter that finished before it', () => {
    // All three estimates of Q2 — July, August, September — point at Q2.
    assert.equal(coverageStart('2026-07-30', 'quarter'), '2026-04-01');
    assert.equal(coverageStart('2026-09-25', 'quarter'), '2026-04-01');
    // And January reaches back over the year end to Q4.
    assert.equal(coverageStart('2026-01-29', 'quarter'), '2025-10-01');
    assert.equal(coverageStart('2026-04-29', 'quarter'), '2026-01-01');
  });

  test('a date that is not one is nothing, not a crash', () => {
    assert.equal(coverageStart('not a date', 'week'), null);
  });
});

describe('proving a figure belongs to the release', () => {
  const release = { date: '2026-09-03', previous: '203K' };

  test('an observation inside the release window is the printed figure', () => {
    const rows = [...CLAIMS, { date: '2026-08-29', value: 206000 }];
    assert.deepEqual(actualFor(rows, release, 'thousands', 'week'), {
      actual: '206K', observed: '2026-08-29',
    });
  });

  test('before the agency posts, nothing is claimed', () => {
    // This is the whole point. FRED's newest is still the week ended 22 August
    // — the last release — and showing it would put a stale number under
    // today's date as though it had just printed.
    assert.equal(actualFor(CLAIMS, release, 'thousands', 'week'), null);
  });

  test('a revision to the previous week does not blank the column', () => {
    // The regression this was rewritten for. FRED restated the week ended 22
    // August from 203K to 204K within an hour of the release; the calendar
    // still says 203K. Requiring those to be equal loses the figure entirely.
    const rows = [
      { date: '2026-08-15', value: 207000 },
      { date: '2026-08-22', value: 204000 },
      { date: '2026-08-29', value: 206000 },
    ];
    assert.equal(actualFor(rows, release, 'thousands', 'week').actual, '206K');
  });

  test('a series on the wrong scale is refused rather than shown', () => {
    // 204000 read as a percentage is 204000.0% against a previous of 203 —
    // three orders out, which is how a wrong mapping actually looks.
    const rows = [...CLAIMS, { date: '2026-08-29', value: 206000 }];
    assert.equal(actualFor(rows, release, 'percent', 'week'), null);
  });

  test('a monthly figure is refused until the month it describes appears', () => {
    const cpi = [{ date: '2026-06-01', value: 0.2 }, { date: '2026-07-01', value: 0.1 }];
    const due = { date: '2026-09-10', previous: '0.1%' };
    assert.equal(actualFor(cpi, due, 'percent', 'month'), null);

    cpi.push({ date: '2026-08-01', value: 0.3 });
    assert.equal(actualFor(cpi, due, 'percent', 'month').actual, '0.3%');
  });

  test('a calendar row with no previous or no date cannot be matched', () => {
    const rows = [...CLAIMS, { date: '2026-08-29', value: 206000 }];
    assert.equal(actualFor(rows, { date: '2026-09-03' }, 'thousands', 'week'), null);
    assert.equal(actualFor(rows, { previous: '203K' }, 'thousands', 'week'), null);
  });

  test('a series too short to have a previous is refused', () => {
    assert.equal(actualFor([{ date: '2026-08-29', value: 206000 }], release, 'thousands', 'week'), null);
    assert.equal(actualFor([], release, 'thousands', 'week'), null);
  });
});

describe('fetching only what the week needs', () => {
  const releases = [
    { id: 'claims', previous: '203K' },
    { id: 'unemployment', previous: '4.1%' },
    { id: 'cpi-m', previous: '0.1%' },
    { id: 'cpi-y', previous: '3.3%' },
  ];

  const stub = (bodies) => {
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      const hit = Object.entries(bodies).find(([id]) => url.includes(`id=${id}`));
      return hit
        ? { ok: true, text: async () => hit[1] }
        : { ok: false, status: 404, text: async () => '' };
    };
    return { fetchImpl, asked };
  };

  test('one request per series, not per row', async () => {
    // CPI month-on-month and year-on-year are two rows of one series under two
    // transformations, so they are two requests — but not four.
    const { fetchImpl, asked } = stub({});
    await fetchActuals(releases, { fetchImpl });
    assert.equal(asked.length, 4);
    assert.equal(asked.filter((u) => u.includes('id=CPIAUCSL')).length, 2);
  });

  test('a release with no previous is not looked up at all', async () => {
    const { fetchImpl, asked } = stub({});
    await fetchActuals([{ id: 'claims', previous: null }], { fetchImpl });
    assert.equal(asked.length, 0);
  });

  test('a title outside the watchlist is ignored', async () => {
    const { fetchImpl, asked } = stub({});
    await fetchActuals([{ id: 'ism-services', previous: '54.1' }], { fetchImpl });
    assert.equal(asked.length, 0);
  });

  test('the three GDP estimates read one series', async () => {
    const { fetchImpl, asked } = stub({});
    await fetchActuals([
      { id: 'gdp:advance-gdp-q-q', previous: '1.5%' },
      { id: 'gdp:final-gdp-q-q', previous: '1.5%' },
    ], { fetchImpl });
    assert.equal(asked.length, 1);
  });

  test('one series failing costs only its own figure', async () => {
    const { fetchImpl } = stub({
      ICSA: csv(['2026-08-22,204000', '2026-08-29,206000']),
      // UNRATE is absent, so its request 404s.
    });
    const rows = attachActuals(
      [
        { id: 'claims', date: '2026-09-03', previous: '203K' },
        { id: 'unemployment', date: '2026-09-04', previous: '4.1%' },
      ],
      await fetchActuals(releases, { fetchImpl }),
    );
    assert.equal(rows[0].actual, '206K');
    assert.equal(rows[1].actual, null);
  });

  test('every release keeps its schedule whether or not a figure was found', async () => {
    const rows = attachActuals(
      [{ id: 'claims', label: 'Unemployment Claims', date: '2026-09-03', previous: '203K' }],
      new Map(),
    );
    assert.equal(rows[0].label, 'Unemployment Claims');
    assert.equal(rows[0].date, '2026-09-03');
    assert.equal(rows[0].actual, null);
    assert.equal(rows[0].observed, null);
  });
});

describe('the series each release is read from', () => {
  test('every watchlist id the panel can show has somewhere to read it', async () => {
    const { WATCHLIST } = await import('../api/_lib/econ.js');
    for (const entry of WATCHLIST) {
      assert.ok(SERIES[entry.id], `no FRED series is mapped for "${entry.id}"`);
    }
  });

  test('claims are the only series not quoted as a percentage', () => {
    const levels = Object.entries(SERIES).filter(([, s]) => s.unit === 'thousands');
    assert.deepEqual(levels.map(([id]) => id), ['claims']);
  });
});
