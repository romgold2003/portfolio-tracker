/**
 * Reading the derivatives market: who is positioned which way.
 *
 * Asked for as "check open interest to find the percentage of longs and
 * shorts", which contains the one thing that cannot be done. Open interest is a
 * single number — every contract has a long and a short, so the two are equal
 * by definition and no formula splits them. What can be read is how open
 * interest MOVED against price, what the crowded side is PAYING, and how many
 * accounts and how much whale size sit on each side. Three different questions,
 * none of them the one that was asked, and together they answer it.
 *
 * The thresholds are the conventional ones and were checked against the live
 * board: funding past 0.05% per eight hours is the 98th percentile of 861
 * perpetuals. What none of this has is validation — Binance keeps thirty-one
 * days of positioning data, so unlike the volume tiers beside it nothing here
 * was tested out of sample, and the tests below pin the reading rather than any
 * claim that the reading pays.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  openInterestReading, fundingReading, crowdReading, whaleReading,
  verdictOf, readPositioning, GAP_TYPICAL, FUNDING_EXTREME,
} from '../src/services/positioning.js';
import { verdictCell } from '../src/ui/views/unusualVolume.js';

describe('what a move in open interest means', () => {
  test('price up on growing open interest is new money going long', () => {
    const r = openInterestReading(8, 5);
    assert.equal(r.id, 'new-longs');
    assert.equal(r.score, 1);
  });

  test('price down on growing open interest is new money going short', () => {
    assert.equal(openInterestReading(8, -5).id, 'new-shorts');
    assert.equal(openInterestReading(8, -5).score, -1);
  });

  test('price up on shrinking open interest is a squeeze, which scores nothing', () => {
    const r = openInterestReading(-8, 5);
    assert.equal(r.id, 'squeeze');
    assert.equal(r.score, 0, 'a rally with nobody left to fuel it is not a bull case');
    assert.match(r.text, /buying their way out/);
  });

  test('price down on shrinking open interest is an unwind, which also scores nothing', () => {
    const r = openInterestReading(-8, -5);
    assert.equal(r.id, 'unwind');
    assert.equal(r.score, 0, 'a market getting smaller is a weaker statement than one growing');
  });

  test('a coin with no open interest to compare says nothing', () => {
    assert.equal(openInterestReading(null, 5), null);
    assert.equal(openInterestReading(8, undefined), null);
  });
});

describe('what the funding rate means', () => {
  test('is contrarian, but only at the extremes', () => {
    assert.equal(fundingReading(0.09).score, -1, 'longs paying heavily');
    assert.equal(fundingReading(-0.09).score, 1, 'shorts paying heavily');
    assert.equal(fundingReading(0.03).score, 0, 'leaning is not crowding');
    assert.equal(fundingReading(0.004).score, 0, 'the median perpetual');
  });

  test('says what the crowded side is actually paying', () => {
    assert.match(fundingReading(0.142).text, /0\.142% every 8h/);
    assert.match(fundingReading(-0.096).text, /0\.096% every 8h/);
    assert.match(fundingReading(-0.096).text, /squeeze fuel/);
  });

  test('the threshold is the one the live board says is extreme', () => {
    assert.equal(FUNDING_EXTREME, 0.05, '98th percentile of 861 perpetuals');
    assert.equal(fundingReading(FUNDING_EXTREME + 0.001).score, -1);
    assert.equal(fundingReading(FUNDING_EXTREME).score, 0, 'the threshold itself is not past it');
  });
});

describe('the crowd, read against', () => {
  test('a lopsided crowd counts against the side it is on', () => {
    assert.equal(crowdReading(0.65).score, -1);
    assert.equal(crowdReading(0.35).score, 1);
    assert.match(crowdReading(0.65).text, /65% of accounts are long/);
  });

  test('a split crowd is no signal, and says so', () => {
    assert.equal(crowdReading(0.52).score, 0);
    assert.match(crowdReading(0.52).text, /no crowd either way/);
  });
});

/**
 * The bug this pins. Reading the whale level directly scored +1 for "whales
 * long" against the crowd's -1 for "crowd long" — and on most coins both are
 * long, so the pair cancelled exactly and contributed nothing at all.
 */
describe('the whales, read against the crowd rather than against even', () => {
  test('do not simply cancel the crowd out', () => {
    // Both long, which is the ordinary case.
    const parts = [crowdReading(0.64), whaleReading(0.68, 0.64)];
    assert.notEqual(parts[0].score + parts[1].score, 0,
      'these two used to cancel on every coin where both were long');
  });

  test('leaning further in than usual counts for', () => {
    // Whales 21 points above the crowd, against a usual seven.
    const r = whaleReading(0.81, 0.60);
    assert.equal(r.score, 1);
    assert.match(r.text, /21 points more long than the crowd/);
    assert.match(r.text, new RegExp(`usual ${GAP_TYPICAL}`));
  });

  test('and barely leaning at all counts against', () => {
    const r = whaleReading(0.60, 0.60);
    assert.equal(r.score, -1, 'no lean where there is normally a seven-point one');
    assert.match(r.text, /barely lean longer/);
  });

  test('the wrong way round is named as such', () => {
    const r = whaleReading(0.50, 0.62);
    assert.equal(r.score, -1);
    assert.match(r.text, /12 points less long than the crowd/);
  });

  test('a normal lean is neither', () => {
    assert.equal(whaleReading(0.57, 0.50).score, 0);
  });

  test('with no crowd figure it reports the level and scores nothing', () => {
    const r = whaleReading(0.7, null);
    assert.equal(r.score, 0);
    assert.match(r.text, /70\/30 long/);
  });
});

describe('the verdict', () => {
  const part = (score) => ({ id: 'x', score, text: 'x' });

  test('needs two readings agreeing before it commits', () => {
    assert.equal(verdictOf([part(1), part(1)]).label, 'Bullish');
    assert.equal(verdictOf([part(-1), part(-1)]).label, 'Bearish');
    assert.equal(verdictOf([part(1)]).label, 'Leaning bullish');
    assert.equal(verdictOf([part(-1)]).label, 'Leaning bearish');
  });

  test('says mixed out loud rather than rounding to an opinion', () => {
    assert.equal(verdictOf([part(1), part(-1)]).label, 'Mixed');
    assert.equal(verdictOf([part(0), part(0)]).label, 'Mixed');
  });

  test('a coin with no futures market has no verdict at all', () => {
    const v = verdictOf([null, null, null, null]);
    assert.equal(v.id, 'unknown');
    assert.equal(v.label, 'No futures market');
  });

  test('and keeps every reason, so the verdict can be argued with', () => {
    const v = readPositioning({ oiChange: 8, priceChange: 5, funding: 0.004, longAccounts: 0.52, topLong: 0.59 });
    assert.equal(v.parts.length, 4);
    assert.ok(v.parts.every((p) => p.text));
  });
});

describe('how it is shown', () => {
  test('a coin without futures says so plainly', () => {
    const cell = verdictCell(null);
    assert.equal(cell.text, 'no futures');
    assert.match(cell.why, /spot only/);
  });

  test('a committed verdict is coloured, a mixed one is not', () => {
    assert.match(verdictCell({ id: 'bullish', label: 'Bullish', score: 3, parts: [] }).tone, /green/);
    assert.match(verdictCell({ id: 'bearish', label: 'Bearish', score: -3, parts: [] }).tone, /red/);
    assert.match(verdictCell({ id: 'mixed', label: 'Mixed', score: 0, parts: [] }).tone, /text3/);
  });

  test('the reasons are on the hover, one per line', () => {
    const v = readPositioning({ oiChange: 8, priceChange: 5, funding: 0.09, longAccounts: 0.7, topLong: 0.9 });
    const cell = verdictCell(v);
    assert.equal(cell.why.split('\n').length, 4);
    assert.ok(cell.why.startsWith('• '));
  });
});
