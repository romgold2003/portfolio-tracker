/**
 * The week's printed figures from Nasdaq's calendar (November 2026): jobless
 * claims printed 200K on Thursday the 12th at 08:30 and the panel still had a
 * dash more than a day later, because FRED had not republished it. End to end,
 * through the real handler: an earlier econ guard passed its own test and was
 * never reached in the panel.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { makeClient } from './support/http.mjs';
import { issueGuestPass, GUEST_COOKIE } from '../api/_lib/guest.js';
import econ from '../api/_panels/econ.js';
import { matchActuals, distance } from '../api/_lib/nasdaqEcon.js';

process.env.NODE_ENV = 'test';

const FEED = [
  { title: 'CPI m/m', country: 'USD', date: '2026-11-10T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.6%' },
  { title: 'CPI y/y', country: 'USD', date: '2026-11-10T08:30:00-05:00', impact: 'High', forecast: '3.1%', previous: '3.0%' },
  { title: 'Unemployment Claims', country: 'USD', date: '2026-11-12T08:30:00-05:00', impact: 'Medium', forecast: '194K', previous: '189K' },
  { title: 'PPI m/m', country: 'USD', date: '2026-11-13T08:30:00-05:00', impact: 'High', forecast: '0.4%', previous: '1.3%' },
];
// Nasdaq files a day's events under the next day's date.
const NASDAQ = {
  '2026-11-11': [
    { country: 'United States', eventName: 'CPI', actual: '0.4%', consensus: '0.3%', previous: '0.6%' },
    { country: 'United States', eventName: 'CPI', actual: '3.2%', consensus: '3.1%', previous: '3.0%' },
  ],
  '2026-11-13': [
    { country: 'United States', eventName: 'Initial Jobless Claims', actual: '200K', consensus: '194K', previous: '191K' },
    { country: 'United States', eventName: 'Continuing Jobless Claims', actual: '1,697K', consensus: '1,710K', previous: '1,717K' },
  ],
  '2026-11-14': [
    { country: 'United States', eventName: 'PPI', actual: '&nbsp;', consensus: '0.4%', previous: '1.3%' },
  ],
};

let realFetch;
beforeEach(() => {
  process.env.GUEST_SECRET = 'test-guest-secret';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('faireconomy')) return { ok: true, json: async () => FEED };
    if (u.includes('api.nasdaq.com/api/calendar')) {
      const date = new URL(u).searchParams.get('date');
      return { ok: true, json: async () => ({ data: { rows: NASDAQ[date] ?? [] } }) };
    }
    // FRED and BLS hang, as FRED did for over two minutes.
    return new Promise(() => {});
  };
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.GUEST_SECRET; });

describe('the printed figure', () => {
  test('claims, CPI m/m and y/y each get their own row, matched on consensus and previous', () => {
    const releases = [
      { id: 'claims', forecast: '194K', previous: '189K' },
      { id: 'cpi-m', forecast: '0.3%', previous: '0.6%' },
      { id: 'cpi-y', forecast: '3.1%', previous: '3.0%' },
    ];
    const rows = [...NASDAQ['2026-11-11'], ...NASDAQ['2026-11-13']];
    const m = matchActuals(rows, releases);
    assert.equal(m.get('claims'), '200K', 'a revised previous (189K → 191K) still matches');
    assert.equal(m.get('cpi-m'), '0.4%');
    assert.equal(m.get('cpi-y'), '3.2%');
    assert.equal(distance({ consensus: '0.3%', previous: '0.6%' }, { forecast: '3.1%', previous: '3.0%' }), null, 'a monthly figure is not the yearly one');
  });

  test('through the panel: Nasdaq\'s figures within seconds, while FRED and BLS do not answer', async () => {
    const client = makeClient({ 'x-forwarded-for': '10.9.9.9' });
    client.jar[GUEST_COOKIE] = issueGuestPass();
    const started = Date.now();
    const res = await client.call(econ, { method: 'GET', url: '/api/econ' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Date.now() - started < 9000, 'a hanging source is passed over');
    const byLabel = Object.fromEntries(res.body.releases.map((r) => [r.label, r]));
    assert.equal(byLabel['Unemployment Claims'].actual, '200K');
    assert.equal(byLabel['CPI m/m'].actual, '0.4%');
    assert.equal(byLabel['CPI y/y'].actual, '3.2%');
    assert.equal(byLabel['PPI m/m'].actual ?? null, null, 'still to come');
    assert.equal(byLabel['Unemployment Claims'].at, '2026-11-12T08:30:00-05:00');
  });
});
