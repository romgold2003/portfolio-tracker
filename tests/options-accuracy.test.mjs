/**
 * The three things that were wrong with GEX and DEX, and stay fixed.
 *
 *   1. the totals were banded to ±20% of spot, which quietly removed most of
 *      the delta — gamma lives near spot, delta does not
 *   2. the greeks came from CBOE's four-decimal fields, which round a real
 *      S&P gamma of 0.0012 to three significant figures and round thousands of
 *      contracts away to exactly zero
 *   3. carry was taken as zero, which is fine for a weekly and badly wrong for
 *      the multi-year options that carry much of the open interest
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  greeks, impliedForward, maxPain, aggregate, fromCboe, fromDeribit,
} from '../api/_lib/options.js';

const near = (a, b, tol) => Math.abs(a - b) <= tol;

describe('the forward, read back out of the chain', () => {
  /** A synthetic chain priced off a known forward and discount. */
  const build = (F, D) => {
    const pairs = [];
    for (let k = 90; k <= 110; k += 2) pairs.push({ strike: k, call: 0, put: 0 });
    // C - P = D*(F - K), plus an arbitrary positive level so both legs are > 0.
    return pairs.map((p) => {
      const diff = D * (F - p.strike);
      const base = 20;
      return { strike: p.strike, call: base + diff / 2, put: base - diff / 2 };
    });
  };

  test('recovers the forward and the discount it was built from', () => {
    const got = impliedForward(build(103.5, 0.96), 100);
    assert.ok(near(got.forward, 103.5, 0.01), `forward ${got.forward}`);
    assert.ok(near(got.discount, 0.96, 0.001), `discount ${got.discount}`);
  });

  test('a forward above spot is what a positive rate looks like', () => {
    const got = impliedForward(build(108, 0.95), 100);
    assert.ok(got.forward > 100);
  });

  test('refuses a fit it cannot make rather than inventing one', () => {
    assert.equal(impliedForward([{ strike: 100, call: 5, put: 5 }], 100), null);
    assert.equal(impliedForward([], 100), null);
  });

  test('an absurd discount factor is rejected, not passed on', () => {
    // Prices that imply a discount of 3 are bad data, not a bond market.
    const bad = [90, 95, 100, 105, 110].map((k) => ({ strike: k, call: 50 - 3 * k, put: 1 }));
    assert.equal(impliedForward(bad, 100), null);
  });
});

describe('carry, which used to be assumed away', () => {
  const base = { spot: 100, strike: 100, years: 2, iv: 0.2, isCall: true };

  test('a forward above spot lifts a call delta', () => {
    const flat = greeks(base);
    const carried = greeks({ ...base, forward: 110, discount: 0.9 });
    assert.ok(carried.delta > flat.delta, `${carried.delta} vs ${flat.delta}`);
  });

  test('the discount factor is applied, not just the forward', () => {
    // F/S alone was the tempting shortcut and leaves the whole discount in.
    const withDiscount = greeks({ ...base, forward: 110, discount: 0.9 });
    const shortcut = greeks({ ...base, forward: 110, discount: 1 });
    assert.ok(withDiscount.delta < shortcut.delta);
    assert.ok(near(withDiscount.delta / shortcut.delta, 0.9, 1e-9));
  });

  test('no forward given leaves the old zero-carry behaviour alone', () => {
    const a = greeks(base);
    const b = greeks({ ...base, forward: 100, discount: 1 });
    assert.ok(near(a.delta, b.delta, 1e-12));
    assert.ok(near(a.gamma, b.gamma, 1e-12));
  });

  test('a put delta stays negative under carry', () => {
    const p = greeks({ ...base, isCall: false, forward: 110, discount: 0.9 });
    assert.ok(p.delta < 0, `${p.delta}`);
  });

  test('gamma is positive for both sides', () => {
    assert.ok(greeks({ ...base, forward: 110, discount: 0.9 }).gamma > 0);
    assert.ok(greeks({ ...base, isCall: false, forward: 110, discount: 0.9 }).gamma > 0);
  });
});

describe('the totals cover the whole chain, the picture covers the band', () => {
  /** One near-the-money line, and one deep in-the-money call far outside it. */
  const contracts = [
    { strike: 100, isCall: true, openInterest: 1000, delta: 0.5, gamma: 0.02 },
    { strike: 100, isCall: false, openInterest: 1000, delta: -0.5, gamma: 0.02 },
    // Deep ITM: delta ~1, miles below the band, and this is the one that was lost.
    { strike: 40, isCall: true, openInterest: 5000, delta: 0.99, gamma: 0.0001 },
  ];

  test('a deep in-the-money call counts towards net delta', () => {
    const got = aggregate(contracts, 100, { multiplier: 100, band: 0.2 });
    // The matched call and put at 100 cancel exactly, so the whole net delta is
    // the deep line — which the old banded total reported as zero.
    const deep = 0.99 * 5000 * 100 * 100;
    assert.ok(near(got.netDex, deep, 1), `net delta ${got.netDex} should be the ${deep} deep line`);
    assert.ok(got.netDex !== 0, 'the band used to remove this entirely');
  });

  test('but it is not drawn, because it is outside the band', () => {
    const got = aggregate(contracts, 100, { multiplier: 100, band: 0.2 });
    assert.ok(got.strikes.every((r) => r.strike >= 80 && r.strike <= 120));
  });

  test('the card is told what the band left out', () => {
    const got = aggregate(contracts, 100, { multiplier: 100, band: 0.2 });
    assert.equal(got.band.pct, 20);
    assert.equal(got.band.oiTotal, 7000);
    assert.equal(got.band.oiShown, 2000);
  });

  test('widening the band changes the picture and not the total', () => {
    const narrow = aggregate(contracts, 100, { multiplier: 100, band: 0.2 });
    const wide = aggregate(contracts, 100, { multiplier: 100, band: 0.9 });
    assert.equal(narrow.netDex, wide.netDex);
    assert.equal(narrow.netGex, wide.netGex);
    assert.ok(wide.strikes.length > narrow.strikes.length);
  });

  test('put gamma still subtracts, which is the dealer assumption', () => {
    const calls = aggregate([contracts[0]], 100, { multiplier: 100 });
    const both = aggregate([contracts[0], contracts[1]], 100, { multiplier: 100 });
    assert.ok(both.netGex < calls.netGex);
    assert.ok(near(both.netGex, 0, 1));
  });

  test('delta is summed with its own sign, not the dealer sign', () => {
    // A matched call and put at the same strike net to roughly zero delta.
    const both = aggregate([contracts[0], contracts[1]], 100, { multiplier: 100 });
    assert.ok(near(both.netDex, 0, 1), `${both.netDex}`);
  });
});

describe('max pain', () => {
  test('is the strike the open interest is piled at', () => {
    assert.equal(maxPain([
      { strike: 90, isCall: true, openInterest: 10 },
      { strike: 90, isCall: false, openInterest: 10 },
      { strike: 100, isCall: true, openInterest: 100 },
      { strike: 100, isCall: false, openInterest: 100 },
      { strike: 110, isCall: true, openInterest: 10 },
      { strike: 110, isCall: false, openInterest: 10 },
    ]), 100);
  });

  test('leans towards the heavy side rather than splitting the difference', () => {
    const pain = maxPain([
      { strike: 90, isCall: false, openInterest: 1 },
      { strike: 100, isCall: false, openInterest: 1 },
      { strike: 110, isCall: true, openInterest: 1000 },
    ]);
    assert.ok(pain <= 100, `${pain}`);
  });

  test('one strike is not a max pain', () => {
    assert.equal(maxPain([{ strike: 100, isCall: true, openInterest: 5 }]), null);
  });
});

describe('reading a CBOE payload end to end', () => {
  const chain = (rows) => ({ data: { close: 100, options: rows } });
  const occ = (k, t) => `SPX271217${t}${String(k * 1000).padStart(8, '0')}`;

  /** Enough paired strikes for the parity fit to have something to work with. */
  const rows = [];
  for (let k = 92; k <= 108; k += 2) {
    const diff = 0.97 * (103 - k);
    rows.push({ option: occ(k, 'C'), bid: 20 + diff / 2 - 0.1, ask: 20 + diff / 2 + 0.1,
      iv: 0.2, open_interest: 100, delta: 0.5, gamma: 0.02 });
    rows.push({ option: occ(k, 'P'), bid: 20 - diff / 2 - 0.1, ask: 20 - diff / 2 + 0.1,
      iv: 0.2, open_interest: 100, delta: -0.5, gamma: 0.02 });
  }

  test('models the greeks itself rather than trusting four decimal places', () => {
    const got = fromCboe(chain(rows), { now: Date.parse('2026-09-11T13:00:00Z') });
    assert.ok(got.greeks.modelled > 0);
    assert.equal(got.greeks.published, 0);
    assert.ok(got.greeks.forwards >= 1, 'a forward should have been fitted');
  });

  test('falls back to the published greeks when there is no usable vol', () => {
    const noVol = rows.map((r) => ({ ...r, iv: 0 }));
    const got = fromCboe(chain(noVol), { now: Date.parse('2026-09-11T13:00:00Z') });
    assert.equal(got.greeks.modelled, 0);
    assert.ok(got.greeks.published > 0);
    assert.ok(Number.isFinite(got.netGex));
  });

  test('a payload with no chain is null, not an empty axis', () => {
    assert.equal(fromCboe({ data: { close: 100 } }), null);
    assert.equal(fromCboe({ data: { close: 0, options: rows } }), null);
  });
});

describe('reading a Deribit payload', () => {
  const rows = [
    { instrument_name: 'BTC-26DEC26-80000-C', open_interest: 100, mark_iv: 55,
      underlying_price: 78500, estimated_delivery_price: 77600 },
    { instrument_name: 'BTC-26DEC26-80000-P', open_interest: 100, mark_iv: 55,
      underlying_price: 78500, estimated_delivery_price: 77600 },
    { instrument_name: 'BTC-26DEC26-70000-P', open_interest: 50, mark_iv: 60,
      underlying_price: 78500, estimated_delivery_price: 77600 },
  ];

  test('scales by the spot, not by whichever expiry sorted first', () => {
    const got = fromDeribit(rows, Date.parse('2026-09-11T00:00:00Z'));
    assert.equal(got.spot, 77600, 'estimated_delivery_price is the spot');
  });

  test('still prices each contract off its own forward', () => {
    // The forward sits above the spot here, so the call delta must exceed the
    // value it would take if the spot were used for both.
    const got = fromDeribit(rows, Date.parse('2026-09-11T00:00:00Z'));
    assert.ok(Number.isFinite(got.netDex));
    assert.ok(got.maxPain > 0);
  });

  test('an empty book is null rather than a flat chart', () => {
    assert.equal(fromDeribit([], Date.now()), null);
    assert.equal(fromDeribit(null, Date.now()), null);
  });
});
