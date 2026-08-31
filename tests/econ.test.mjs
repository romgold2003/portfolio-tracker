/**
 * Picking the watched US releases out of the calendar feed, and keeping them.
 *
 * The feed covers one week and has no history endpoint, so most of the
 * watchlist is absent from it most weeks. Everything below is really about that
 * one fact: a monthly release must not disappear from the panel between prints.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  WATCHLIST, selectReleases, mergeReleases, orderReleases,
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

describe('keeping what the feed has stopped mentioning', () => {
  const cpi = { id: 'cpi-m', label: 'CPI m/m', date: '2026-08-12', forecast: '0.2%', previous: '0.1%' };
  const claims = { id: 'claims', label: 'Unemployment Claims', date: '2026-09-03', forecast: '205K', previous: '203K' };

  test('a release missing from this week is carried through', () => {
    const merged = mergeReleases([cpi], [claims]);
    assert.equal(merged.length, 2);
    assert.ok(merged.find((r) => r.id === 'cpi-m'), 'August CPI must survive September');
  });

  test('a newer print replaces the older one', () => {
    const newer = { ...cpi, date: '2026-09-10', forecast: '0.3%', previous: '0.2%' };
    const merged = mergeReleases([cpi], [newer]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].date, '2026-09-10');
    assert.equal(merged[0].forecast, '0.3%');
  });

  test('an older print never rewinds a newer one', () => {
    const older = { ...cpi, date: '2026-07-15', forecast: '0.1%' };
    const merged = mergeReleases([{ ...cpi, date: '2026-09-10' }], [older]);
    assert.equal(merged[0].date, '2026-09-10', 'a late feed must not undo a newer reading');
  });

  test('starting from nothing is not an error', () => {
    assert.deepEqual(mergeReleases(null, [claims]), [claims]);
    assert.deepEqual(mergeReleases([claims], []), [claims]);
  });
});

describe('the order it reads in', () => {
  test('follows the watchlist rather than the feed', () => {
    const rows = orderReleases([
      { id: 'claims', label: 'Unemployment Claims', date: '2026-09-03' },
      { id: 'cpi-m', label: 'CPI m/m', date: '2026-09-10' },
    ]);
    assert.equal(rows[0].label, 'CPI m/m', 'CPI is first in the watchlist');
  });

  test('puts the most recent GDP reading first among its siblings', () => {
    const rows = orderReleases([
      { id: 'gdp:advance-gdp-q-q', label: 'Advance GDP q/q', date: '2026-07-30' },
      { id: 'gdp:final-gdp-q-q', label: 'Final GDP q/q', date: '2026-09-25' },
    ]);
    assert.equal(rows[0].label, 'Final GDP q/q');
  });

  test('every watchlist entry has a distinct id', () => {
    assert.equal(new Set(WATCHLIST.map((w) => w.id)).size, WATCHLIST.length);
  });
});
