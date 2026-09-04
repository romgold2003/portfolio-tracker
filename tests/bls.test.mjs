/**
 * Release figures read straight from the Bureau of Labor Statistics.
 *
 * The bug this exists for: the August unemployment rate printed at 08:30 and
 * the panel still showed nothing at 09:01. Nothing was broken — FRED
 * republishes rather than publishes, and had not caught up. BLS had the figure
 * at once, because BLS is who released it.
 *
 * The thing that must not drift is the arithmetic. BLS serves an index and the
 * calendar quotes a percent change, so it is computed here — and it has to come
 * out where FRED's own `pch` and `pc1` transformations come out, or the panel
 * would report a different number depending on which source happened to answer
 * first. The fixtures below are the real published indices, checked against
 * FRED to the decimal.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SERIES, parseSeries, derive, fetchActuals } from '../api/_lib/bls.js';
import { formatValue } from '../api/_lib/fred.js';

/** BLS answers newest first, months as M01–M12. */
const row = (year, month, value) => ({ year: String(year), period: `M${month}`, value: String(value) });

/** The real CPI index (CUSR0000SA0), May to July 2026. */
const CPI = [row(2026, '07', 332.813), row(2026, '06', 332.568), row(2026, '05', 333.979)];

describe('reading a series', () => {
  test('it comes back oldest first, dated to the month described', () => {
    assert.deepEqual(parseSeries(CPI), [
      { date: '2026-05-01', value: 333.979 },
      { date: '2026-06-01', value: 332.568 },
      { date: '2026-07-01', value: 332.813 },
    ]);
  });

  test('the annual average is not a month and is dropped', () => {
    // M13 is the year's average. Charted as a month it would invent one.
    const rows = parseSeries([row(2026, '13', 330), row(2026, '07', 332.813)]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-07-01');
  });

  test('a row with no usable value is dropped, not read as zero', () => {
    assert.deepEqual(parseSeries([{ year: '2026', period: 'M07', value: '-' }]), []);
    assert.deepEqual(parseSeries([]), []);
    assert.deepEqual(parseSeries(null), []);
  });
});

describe('the arithmetic matches FRED', () => {
  test('month on month, to the decimal FRED reports', () => {
    // FRED's CPIAUCSL pch for July 2026 is 0.07367, which prints as 0.1%.
    const mom = derive(parseSeries(CPI), 'mom');
    const july = mom[mom.length - 1];
    assert.equal(july.date, '2026-07-01');
    assert.ok(Math.abs(july.value - 0.07367) < 0.0005, `got ${july.value}`);
    assert.equal(formatValue(july.value, 'percent'), '0.1%');
  });

  test('year on year needs the year behind it and says nothing without one', () => {
    // Three months cannot produce a twelve-month change, and inventing one from
    // whatever is oldest would be a different statistic wearing the same label.
    assert.deepEqual(derive(parseSeries(CPI), 'yoy'), []);

    const full = parseSeries(Array.from({ length: 14 }, (_, i) => {
      const month = 14 - i;
      const year = month > 12 ? 2025 : 2026;
      const m = String(month > 12 ? month - 12 : month).padStart(2, '0');
      return row(year, m, 100 + (14 - i));
    }));
    const yoy = derive(full, 'yoy');
    assert.ok(yoy.length > 0);
    assert.equal(yoy[0].date, full[12].date, 'the first answerable month is the thirteenth');
  });

  test('a level series is passed through untouched', () => {
    const rows = parseSeries([row(2026, '08', 4.1), row(2026, '07', 4.1)]);
    assert.deepEqual(derive(rows, 'level'), rows);
  });

  test('an unchanged month is zero, never minus zero', () => {
    // PPI came in flat and printed as "-0.0%", which reads as a fall.
    const flat = parseSeries([row(2026, '07', 156.563), row(2026, '06', 156.563)]);
    const [only] = derive(flat, 'mom');
    assert.equal(Object.is(only.value, -0), false);
    assert.equal(formatValue(only.value, 'percent'), '0.0%');
  });
});

describe('asking for a week of releases', () => {
  const releases = [
    { id: 'unemployment', previous: '4.1%' },
    { id: 'cpi-m', previous: '0.1%' },
    { id: 'cpi-y', previous: '3.3%' },
    { id: 'claims', previous: '203K' },
  ];

  const stub = (payload, { ok = true } = {}) => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return { ok, status: ok ? 200 : 503, json: async () => payload };
    };
    return { fetchImpl, calls };
  };

  const answer = (series) => ({ status: 'REQUEST_SUCCEEDED', Results: { series } });

  test('every series in one request, and each id asked for once', () => {
    // CPI month-on-month and year-on-year are two rows of one series.
    const { fetchImpl, calls } = stub(answer([]));
    return fetchActuals(releases, { fetchImpl }).then(() => {
      assert.equal(calls.length, 1, 'BLS takes a list; it should be one call');
      assert.deepEqual([...calls[0].seriesid].sort(), ['CUSR0000SA0', 'LNS14000000']);
    });
  });

  test('claims are not asked of BLS — that series is not theirs', async () => {
    const { fetchImpl, calls } = stub(answer([]));
    await fetchActuals([{ id: 'claims', previous: '203K' }], { fetchImpl });
    assert.equal(calls.length, 0);
  });

  test('what comes back is keyed the way FRED keys it, so either can stand in', async () => {
    const { fetchImpl } = stub(answer([
      { seriesID: 'LNS14000000', data: [row(2026, '08', 4.1), row(2026, '07', 4.1)] },
    ]));
    const out = await fetchActuals([{ id: 'unemployment', previous: '4.1%' }], { fetchImpl });

    assert.ok(out.has('unemployment'), 'keyed by watchlist id, not by the BLS series id');
    assert.equal(out.get('unemployment').unit, 'percent');
    assert.equal(out.get('unemployment').freq, 'month');
    assert.equal(out.get('unemployment').rows.at(-1).value, 4.1);
  });

  test('a throttled or refused request is empty, so FRED still answers', async () => {
    // The public tier caps requests a day. Failing here must cost the speed,
    // not the figure.
    const { fetchImpl } = stub({ status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold'] });
    assert.equal((await fetchActuals(releases, { fetchImpl })).size, 0);

    const dead = stub(null, { ok: false });
    assert.equal((await fetchActuals(releases, { fetchImpl: dead.fetchImpl })).size, 0);
  });

  test('a series too short to derive from is left out rather than half-answered', async () => {
    const { fetchImpl } = stub(answer([
      { seriesID: 'CUSR0000SA0', data: [row(2026, '07', 332.813)] },
    ]));
    const out = await fetchActuals([{ id: 'cpi-m', previous: '0.1%' }], { fetchImpl });
    assert.equal(out.size, 0);
  });
});

describe('the series it covers', () => {
  test('the household survey, CPI and PPI — and nothing BLS does not publish', () => {
    assert.deepEqual(Object.keys(SERIES).sort(), [
      'core-cpi-m', 'core-cpi-y', 'core-ppi-m', 'cpi-m', 'cpi-y', 'ppi-m', 'unemployment',
    ]);
    // Claims are Labor's ETA, retail is Census, GDP is the BEA. All stay on FRED.
    for (const id of ['claims', 'retail-m', 'core-retail-m', 'gdp']) {
      assert.equal(SERIES[id], undefined, `${id} is not a BLS series`);
    }
  });

  test('the computed changes read seasonally adjusted indices', () => {
    // The calendar quotes the seasonally adjusted month-on-month change. CUUR
    // is the unadjusted series and would answer a different question.
    for (const [id, s] of Object.entries(SERIES)) {
      if (s.kind === 'level') continue;
      assert.ok(s.id.startsWith('CUSR') || s.id.startsWith('WPSFD'), `${id} uses ${s.id}`);
    }
  });
});
