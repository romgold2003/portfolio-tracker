/**
 * The GDP guard, tested through the path the panel actually takes.
 *
 * GDP is published three times for one quarter — advance, second, final — and
 * FRED keeps a single observation per quarter, revised in place. So the day the
 * second estimate lands, the final estimate's row already has a plausible
 * number sitting in the series weeks before it is published. A value cannot say
 * which estimate produced it, so a series whose estimates share one observation
 * is held back until the release date is properly past.
 *
 * `actualFor` has taken a `shared` flag for that since it was written, and it
 * worked. The flag never reached it. `fetchActuals` built each entry as
 * `{ rows, unit, freq }` and dropped `shared`, so `attachActuals` read
 * `found.shared` as undefined, every series looked unshared, and GDP was
 * allowed to print on its release date — showing the figure the previous
 * estimate had left behind. Reported twice as data appearing before it was
 * published, and both times the guard was there and simply never ran.
 *
 * The lesson is the shape of this file: the unit test of `actualFor` passed
 * throughout. Only going through `fetchActuals` catches a flag lost in transit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SERIES, fetchActuals, attachActuals, actualFor } from '../api/_lib/fred.js';

const TODAY = new Date('2026-09-30T12:00:00Z');

/** Quarterly GDP, the newest row being the quarter under revision. */
const GDP_ROWS = [
  'observation_date,A191RL1Q225SBEA',
  '2025-10-01,2.4',
  '2026-01-01,3.1',
  '2026-04-01,1.5',
].join('\n');

/** A FRED that answers every request with the same series. */
const fredServing = (csv) => async () => ({ ok: true, text: async () => csv });

/** The release as the calendar carries it, dated `date`. */
const gdpRelease = (date) => ({
  id: 'gdp:final-gdp-q-q', label: 'Final GDP q/q', date,
  forecast: '1.5%', previous: '3.1%',
});

describe('the shared flag survives the trip from SERIES to actualFor', () => {
  test('it is still on the entry fetchActuals hands over', async () => {
    const release = gdpRelease('2026-09-25');
    const found = await fetchActuals([release], { fetchImpl: fredServing(GDP_ROWS), now: TODAY });
    assert.equal(found.get('gdp')?.shared, true, 'dropping this is what silenced the guard');
  });

  test('and the series it came from still declares it', () => {
    assert.equal(SERIES.gdp.shared, true);
  });
});

describe('a GDP estimate due today', () => {
  test('shows nothing, because the number there belongs to the last estimate', async () => {
    const release = gdpRelease('2026-09-30'); // today
    const found = await fetchActuals([release], { fetchImpl: fredServing(GDP_ROWS), now: TODAY });
    const [out] = attachActuals([release], found, { now: TODAY });
    assert.equal(out.actual, null, 'this is the figure that kept appearing early');
  });

  test('and shows nothing when it is still days away', async () => {
    const release = gdpRelease('2026-10-03');
    const found = await fetchActuals([release], { fetchImpl: fredServing(GDP_ROWS), now: TODAY });
    const [out] = attachActuals([release], found, { now: TODAY });
    assert.equal(out.actual, null);
  });

  test('but does show once the release date is properly past', async () => {
    const release = gdpRelease('2026-09-25');
    const found = await fetchActuals([release], { fetchImpl: fredServing(GDP_ROWS), now: TODAY });
    const [out] = attachActuals([release], found, { now: TODAY });
    assert.equal(out.actual, '1.5%');
  });
});

describe('a series whose estimates do not share an observation', () => {
  const CPI_ROWS = [
    'observation_date,CPILFESL_PCH',
    '2026-06-01,0.2',
    '2026-07-01,0.3',
    '2026-08-01,0.4',
  ].join('\n');
  const cpi = (date) => ({ id: 'core-cpi-m', label: 'Core CPI m/m', date, forecast: '0.3%', previous: '0.3%' });

  test('is still allowed to print on the day it lands', async () => {
    const release = cpi('2026-09-30');
    const found = await fetchActuals([release], { fetchImpl: fredServing(CPI_ROWS), now: TODAY });
    assert.equal(found.get('core-cpi-m')?.shared, false, 'only GDP shares an observation');
    const [out] = attachActuals([release], found, { now: TODAY });
    assert.equal(out.actual, '0.4%', 'a monthly series has nothing newer to mistake it for');
  });

  test('and is still refused before it lands', async () => {
    const release = cpi('2026-10-01');
    const found = await fetchActuals([release], { fetchImpl: fredServing(CPI_ROWS), now: TODAY });
    const [out] = attachActuals([release], found, { now: TODAY });
    assert.equal(out.actual, null);
  });
});

describe('actualFor itself, which was never the broken part', () => {
  const rows = [
    { date: '2026-01-01', value: 3.1 },
    { date: '2026-04-01', value: 1.5 },
  ];
  const release = gdpRelease('2026-09-30');

  test('refuses a shared series dated today', () => {
    assert.equal(actualFor(rows, release, 'percent', 'quarter', { now: TODAY, shared: true }), null);
  });

  test('and would have allowed it without the flag — which is the whole bug', () => {
    const hit = actualFor(rows, release, 'percent', 'quarter', { now: TODAY, shared: false });
    assert.equal(hit?.actual, '1.5%');
  });
});
