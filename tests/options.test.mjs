/**
 * Gamma and delta exposure by strike.
 *
 * The arithmetic is checked against values worked by hand, and the parsing
 * against the two symbol formats the sources actually use — an OCC symbol whose
 * root varies in length, and Deribit's dated name.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOccSymbol, parseDeribitName, greeks, aggregate, fromCboe, fromDeribit,
} from '../api/_lib/options.js';

describe('reading an OCC symbol', () => {
  test('takes the strike from the last eight digits, in thousandths', () => {
    const p = parseOccSymbol('SPX260918C00200000');
    assert.equal(p.strike, 200);
    assert.equal(p.isCall, true);
    assert.equal(p.expiry, '2026-09-18');
  });

  test('does not care how long the root is', () => {
    // SPX and SPXW, NDX and NDXP: the root is the part that varies.
    assert.equal(parseOccSymbol('NDXP260901C31400000').strike, 31400);
    assert.equal(parseOccSymbol('SPXW261231P06000000').strike, 6000);
    assert.equal(parseOccSymbol('SPXW261231P06000000').isCall, false);
  });

  test('refuses anything that is not one', () => {
    assert.equal(parseOccSymbol('BTC-26MAR27-104000-C'), null);
    assert.equal(parseOccSymbol(''), null);
    assert.equal(parseOccSymbol(null), null);
  });
});

describe('reading a Deribit name', () => {
  test('takes the strike, the type and the expiry', () => {
    const p = parseDeribitName('BTC-26MAR27-104000-C');
    assert.equal(p.strike, 104000);
    assert.equal(p.isCall, true);
    // Deribit settles at 08:00 UTC.
    assert.equal(new Date(p.expiryMs).toISOString(), '2027-03-26T08:00:00.000Z');
  });

  test('refuses a month that is not one', () => {
    assert.equal(parseDeribitName('BTC-26XXX27-104000-C'), null);
    assert.equal(parseDeribitName('BTC-26MAR27-104000-X'), null);
    assert.equal(parseDeribitName('nonsense'), null);
  });
});

describe('the greeks', () => {
  test('an at-the-money call is about half delta', () => {
    const g = greeks({ spot: 100, strike: 100, years: 0.25, iv: 0.4, isCall: true });
    assert.ok(Math.abs(g.delta - 0.54) < 0.03, `delta was ${g.delta}`);
    assert.ok(g.gamma > 0);
  });

  test('a put is the call minus one', () => {
    const args = { spot: 100, strike: 100, years: 0.25, iv: 0.4 };
    const call = greeks({ ...args, isCall: true });
    const put = greeks({ ...args, isCall: false });
    assert.ok(Math.abs((call.delta - 1) - put.delta) < 1e-9);
    // Gamma is the same for both: it does not know which side you are on.
    assert.ok(Math.abs(call.gamma - put.gamma) < 1e-12);
  });

  test('deep out of the money is nearly no delta and no gamma', () => {
    const g = greeks({ spot: 100, strike: 300, years: 0.05, iv: 0.4, isCall: true });
    assert.ok(g.delta < 0.001, `delta was ${g.delta}`);
    assert.ok(g.gamma < 0.001);
  });

  test('an expired or unpriced contract has none', () => {
    assert.equal(greeks({ spot: 100, strike: 100, years: 0, iv: 0.4, isCall: true }), null);
    assert.equal(greeks({ spot: 100, strike: 100, years: 0.25, iv: 0, isCall: true }), null);
    assert.equal(greeks({ spot: 0, strike: 100, years: 0.25, iv: 0.4, isCall: true }), null);
  });
});

describe('aggregating a chain', () => {
  const chain = [
    { strike: 100, isCall: true, openInterest: 1000, delta: 0.5, gamma: 0.02 },
    { strike: 100, isCall: false, openInterest: 500, delta: -0.5, gamma: 0.02 },
    { strike: 110, isCall: true, openInterest: 2000, delta: 0.3, gamma: 0.01 },
  ];

  test('calls add gamma and puts subtract it', () => {
    const a = aggregate(chain, 100, { multiplier: 1 });
    const atHundred = a.strikes.find((r) => r.strike === 100);
    // (0.02*1000 - 0.02*500) * 100^2 * 0.01 = 10 * 100 = 1000
    assert.equal(atHundred.gex, 1000);
  });

  test('delta is summed as it comes, signs and all', () => {
    const a = aggregate(chain, 100, { multiplier: 1 });
    const atHundred = a.strikes.find((r) => r.strike === 100);
    // (0.5*1000 + -0.5*500) * 100 = 250 * 100 = 25000
    assert.equal(atHundred.dex, 25000);
  });

  test('strikes far from spot are left out', () => {
    const far = [...chain, { strike: 1000, isCall: true, openInterest: 9e6, delta: 1, gamma: 1 }];
    const a = aggregate(far, 100, { multiplier: 1 });
    assert.ok(!a.strikes.some((r) => r.strike >= 1000), 'a strike ten times spot is not context');
  });

  test('contracts nobody holds are ignored', () => {
    const a = aggregate([{ strike: 100, isCall: true, openInterest: 0, delta: 1, gamma: 1 }], 100);
    assert.equal(a, null);
  });

  test('an empty or unpriced chain is null, not an empty chart', () => {
    assert.equal(aggregate([], 100), null);
    assert.equal(aggregate(chain, 0), null);
  });

  test('strikes come back in order', () => {
    const a = aggregate(chain, 100, { multiplier: 1 });
    const order = a.strikes.map((r) => r.strike);
    assert.deepEqual(order, [...order].sort((x, y) => x - y));
  });
});

describe('the sources', () => {
  test('a CBOE payload becomes a profile', () => {
    const payload = { data: { close: 100, options: [
      { option: 'SPX260918C00100000', open_interest: 1000, delta: 0.5, gamma: 0.02 },
      { option: 'SPX260918P00100000', open_interest: 500, delta: -0.5, gamma: 0.02 },
    ] } };
    const p = fromCboe(payload);
    assert.equal(p.spot, 100);
    assert.ok(p.strikes.length >= 1);
    // The index multiplier of 100 is applied.
    assert.equal(p.netGex, 100000);
  });

  test('a Deribit payload becomes a profile', () => {
    const now = Date.UTC(2026, 0, 1);
    const rows = [{
      instrument_name: 'BTC-26MAR26-100000-C',
      open_interest: 100, mark_iv: 50, underlying_price: 100000,
    }];
    const p = fromDeribit(rows, now);
    assert.equal(p.spot, 100000);
    assert.ok(p.netGex > 0, 'a call adds gamma');
    assert.ok(p.netDex > 0);
  });

  test('a malformed payload is null rather than a wrong chart', () => {
    assert.equal(fromCboe({}), null);
    assert.equal(fromCboe({ data: { close: 100, options: 'nope' } }), null);
    assert.equal(fromDeribit(null), null);
    assert.equal(fromDeribit([]), null);
  });
});
