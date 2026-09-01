/**
 * Picking this week's watched US releases out of the calendar feed.
 *
 * The feed covers one week and rolls over on its own every Monday, so the panel
 * is a schedule of what is landing between now and Sunday. Most weeks that is
 * two or three rows, and that is the answer rather than a gap.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  WATCHLIST, selectReleases, orderReleases, weekOf,
} from '../api/_lib/econ.js';

const event = (over = {}) => ({
  title: 'CPI m/m', country: 'USD', date: '2026-09-10T08:30:00-04:00',
  impact: 'High', forecast: '0.3%', previous: '0.2%', ...over,
});

describe('choosing what to keep', () => {
  test('keeps a watched release with its two figures', () => {
    const [row] = selectReleases([event()]);
    assert.equal(row.label, 'CPI m/m');
    assert.equal(row.forecast, '0.3%');
    assert.equal(row.previous, '0.2%');
    assert.equal(row.date, '2026-09-10');
    assert.equal(row.impact, 'High');
  });

  test('ignores everything that is not the United States', () => {
    assert.equal(selectReleases([event({ country: 'EUR' })]).length, 0);
    assert.equal(selectReleases([event({ country: 'GBP' })]).length, 0);
  });

  test('ignores releases nobody asked for', () => {
    assert.equal(selectReleases([event({ title: 'Beige Book' })]).length, 0);
    assert.equal(selectReleases([event({ title: 'Crude Oil Inventories' })]).length, 0);
  });

  test('does not confuse a headline reading with its core', () => {
    const rows = selectReleases([event({ title: 'Core CPI m/m' }), event({ title: 'CPI m/m' })]);
    assert.deepEqual(rows.map((r) => r.label).sort(), ['CPI m/m', 'Core CPI m/m']);
  });

  test('drops a diary entry with no figures at all', () => {
    // A speech has a time and nothing else; two dashes is not information.
    assert.equal(selectReleases([event({ forecast: '', previous: '' })]).length, 0);
    assert.equal(selectReleases([event({ forecast: '-', previous: '-' })]).length, 0);
  });

  test('keeps a release that has only one of the two', () => {
    const [row] = selectReleases([event({ forecast: '' })]);
    assert.equal(row.forecast, null);
    assert.equal(row.previous, '0.2%');
  });

  test('takes every flavour of GDP under its own name', () => {
    const rows = selectReleases([
      event({ title: 'Advance GDP q/q' }),
      event({ title: 'Prelim GDP q/q' }),
      event({ title: 'Final GDP q/q' }),
    ]);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.label), ['Advance GDP q/q', 'Prelim GDP q/q', 'Final GDP q/q']);
    // Distinct ids, or they would overwrite each other on the way in.
    assert.equal(new Set(rows.map((r) => r.id)).size, 3);
  });

  test('survives a feed full of junk', () => {
    assert.deepEqual(selectReleases([null, undefined, {}, { title: 5 }, 'x']), []);
    assert.deepEqual(selectReleases(null), []);
  });
});

describe('the order it reads in', () => {
  test('runs through the week, earliest first', () => {
    const rows = orderReleases([
      { id: 'cpi-m', label: 'CPI m/m', date: '2026-09-10' },
      { id: 'claims', label: 'Unemployment Claims', date: '2026-09-03' },
    ]);
    assert.deepEqual(rows.map((r) => r.label), ['Unemployment Claims', 'CPI m/m']);
  });

  test('two on the same day fall back to the watchlist order', () => {
    // CPI and its core always print together; the headline reads first.
    const rows = orderReleases([
      { id: 'core-cpi-m', label: 'Core CPI m/m', date: '2026-09-10' },
      { id: 'cpi-m', label: 'CPI m/m', date: '2026-09-10' },
    ]);
    assert.deepEqual(rows.map((r) => r.label), ['CPI m/m', 'Core CPI m/m']);
  });

  test('every watchlist entry has a distinct id', () => {
    assert.equal(new Set(WATCHLIST.map((w) => w.id)).size, WATCHLIST.length);
  });
});

describe('the week it is reporting on', () => {
  test('runs Monday to Sunday', () => {
    assert.deepEqual(weekOf('2026-08-31'), { from: '2026-08-31', to: '2026-09-06' });
  });

  test('a midweek day belongs to the same week', () => {
    assert.deepEqual(weekOf('2026-09-03'), { from: '2026-08-31', to: '2026-09-06' });
  });

  test('Sunday belongs to the week that began six days earlier', () => {
    // Not to the one starting tomorrow, which is the mistake a 0-indexed
    // getUTCDay invites.
    assert.deepEqual(weekOf('2026-09-06'), { from: '2026-08-31', to: '2026-09-06' });
  });

  test('the next Monday starts a new one', () => {
    assert.deepEqual(weekOf('2026-09-07'), { from: '2026-09-07', to: '2026-09-13' });
  });

  test('a week spanning a month boundary is still seven days', () => {
    const { from, to } = weekOf('2026-12-31');
    assert.equal(from, '2026-12-28');
    assert.equal(to, '2027-01-03');
  });
});
