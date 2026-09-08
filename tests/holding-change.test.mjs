/**
 * The 30d change column on the Top Holder Whales card.
 *
 * What it must say, and nothing else: how much bigger or smaller a holder's
 * position got over thirty days, as a percentage of what they held at the
 * start — green up, red down, "Unchanged" when the position is the size it was.
 *
 * The denominator is the point. A whale that added two million to three
 * million grew by two thirds; the same two million added to two hundred
 * million is a rounding error. Measuring against today's balance instead would
 * quietly flatten the first case.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { holdingChange } from '../src/services/cryptoWhales.js';

/** A covered window: held `then`, moved `net`, so it holds then+net now. */
const move = (then, net, over = {}) => ({
  covered: true,
  unitsThen: then,
  netUnits: net,
  pct: then > 0 ? (net / then) * 100 : null,
  transfers: net === 0 ? 0 : 2,
  ...over,
});

describe('a position that grew', () => {
  test('reads as a positive percentage, in green', () => {
    const d = holdingChange(move(3_000_000, 2_000_000));
    assert.equal(d.text, '+66.7%');
    assert.equal(d.tone, 'cw-in');
  });

  test('the percentage is of what was held then, not of what is held now', () => {
    // Two million added to three million is two thirds. Against the five
    // million held now it would read 40% — a different and lesser claim.
    assert.equal(holdingChange(move(3_000_000, 2_000_000)).text, '+66.7%');
    assert.notEqual(holdingChange(move(3_000_000, 2_000_000)).text, '+40.0%');
  });

  test('the tooltip shows both ends so the number can be checked', () => {
    const d = holdingChange(move(8_526_388, 273_022), { symbol: 'LINK' });
    assert.match(d.note, /8,526,388 LINK/);
    assert.match(d.note, /8,799,410 LINK/);
    assert.match(d.note, /30 days/);
  });

  test('a tiny position that doubled is still a doubling', () => {
    assert.equal(holdingChange(move(100, 100)).text, '+100.0%');
  });
});

describe('a position that shrank', () => {
  test('reads as a negative percentage, in red', () => {
    const d = holdingChange(move(1_000_000, -250_000));
    assert.equal(d.text, '−25.0%');
    assert.equal(d.tone, 'cw-out');
  });

  test('it is never called a sale', () => {
    // Tokens leaving a wallet are not a sale. The same rule as the rest of the
    // page: this reports the size of a position and stops there.
    const d = holdingChange(move(1_000_000, -900_000));
    assert.ok(!/sold|sale|sell/i.test(d.text), d.text);
    assert.ok(!/sold|sale|sell/i.test(d.note), d.note);
    assert.match(d.note, /separate question/i);
  });

  test('a position emptied entirely is minus one hundred percent', () => {
    assert.equal(holdingChange(move(500_000, -500_000)).text, '−100.0%');
  });
});

describe('a position that did nothing', () => {
  test('with no movement at all', () => {
    const d = holdingChange(move(1_000_000, 0), { symbol: 'UNI' });
    assert.equal(d.text, 'Unchanged');
    assert.equal(d.tone, '');
    assert.match(d.note, /not one movement/i);
  });

  test('and with movement that netted out to the same size', () => {
    const d = holdingChange({ ...move(1_000_000, 0), transfers: 9 });
    assert.equal(d.text, 'Unchanged');
    assert.match(d.note, /the size it was/i);
  });

  test('dust does not count as changing your mind', () => {
    // Half a percent of a nine-figure position is real money and still not
    // somebody taking a view.
    assert.equal(holdingChange(move(100_000_000, 200_000)).text, 'Unchanged');
    assert.equal(holdingChange(move(100_000_000, -200_000)).text, 'Unchanged');
  });

  test('but a real move just above the floor is shown', () => {
    assert.equal(holdingChange(move(100_000_000, 1_000_000)).text, '+1.0%');
  });
});

describe('the cases where a percentage would be a lie', () => {
  test('a position opened inside the window reads as new, not as infinity', () => {
    const d = holdingChange({ covered: true, unitsThen: 0, netUnits: 4_369_740, fromNothing: true },
      { symbol: 'LINK' });
    assert.equal(d.text, 'New');
    assert.equal(d.tone, 'cw-in');
    assert.match(d.note, /opened in the last 30 days/i);
    assert.ok(!/Infinity|NaN/.test(d.text + d.note));
  });

  test('a wallet too busy to reach back says so instead of guessing', () => {
    const d = holdingChange({ covered: false });
    assert.equal(d.text, '—');
    assert.match(d.note, /reach back/i);
  });

  test('an answer still being worked out shows it is working', () => {
    const d = holdingChange(null);
    assert.equal(d.text, '…');
  });

  test('no output is ever NaN, undefined or Infinity', () => {
    const cases = [
      null, { covered: false }, move(0, 0), move(1000, 0), move(1000, 500),
      move(1000, -1000), { covered: true, unitsThen: 0, netUnits: 5, fromNothing: true },
      { covered: true, unitsThen: 100, netUnits: 5, pct: null },
    ];
    for (const c of cases) {
      const d = holdingChange(c, { symbol: 'X' });
      assert.ok(!/NaN|undefined|Infinity/.test(`${d.text} ${d.note}`), `${d.text} — ${d.note}`);
      assert.equal(typeof d.tone, 'string');
    }
  });
});

describe('the colours carry the direction', () => {
  test('up is green, down is red, and nothing earns neither', () => {
    assert.equal(holdingChange(move(100, 50)).tone, 'cw-in');
    assert.equal(holdingChange(move(100, -50)).tone, 'cw-out');
    assert.equal(holdingChange(move(100, 0)).tone, '');
  });
});
