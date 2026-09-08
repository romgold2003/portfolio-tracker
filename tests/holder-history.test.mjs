/**
 * Are those whales still holding — answered today rather than in two days.
 *
 * A balance is a running total of transfers, so it can be walked backwards:
 * what an address holds now, minus what arrived and plus what left over a
 * window, is what it held at the start of that window. Nothing has to have
 * been recorded in advance, which is the point.
 *
 * The rule this file guards: **a page of transfers that does not reach back
 * over the whole window answers nothing about it.** Reporting the part that
 * happened to fit, as though it were the whole, would invent a change.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  movementOf, describeHolding, MATERIAL_PCT, WINDOWS,
  readCache, writeCache, resetTableCache, prune, fetchTransfers,
  noteWanted, wanted, resetWantedCache,
} from '../api/_lib/holderhistory.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 7);
const WHALE = '0xwhale';

beforeEach(() => {
  useDriver(sqliteDriver());
  resetTableCache();
});

/** A transfer `daysAgo`, of `units`, in or out of the whale. */
const move = (daysAgo, units, dir = 'in', over = {}) => ({
  at: (NOW - daysAgo * DAY) / 1000,
  from: dir === 'in' ? '0xsomebody' : WHALE,
  to: dir === 'in' ? WHALE : '0xsomebody',
  units,
  ...over,
});

describe('walking a balance backwards', () => {
  test('what arrived is subtracted and what left is added back', () => {
    // Holds 19M now; 2M came in and 5M went out, so it held 22M thirty days ago.
    const m = movementOf({
      address: WHALE,
      unitsNow: 19_000_000,
      days: 30,
      now: NOW,
      transfers: [move(5, 2_000_000, 'in'), move(20, 5_000_000, 'out'), move(400, 1_000_000, 'in')],
    });
    assert.equal(m.covered, true);
    assert.equal(m.inUnits, 2_000_000);
    assert.equal(m.outUnits, 5_000_000);
    assert.equal(m.netUnits, -3_000_000);
    assert.equal(m.unitsThen, 22_000_000);
  });

  test('the change is a share of what was held then, not of what is held now', () => {
    // Shedding two of three is a different story from shedding two of two hundred.
    const m = movementOf({
      address: WHALE, unitsNow: 1_000_000, days: 30, now: NOW,
      transfers: [move(3, 2_000_000, 'out'), move(90, 1, 'in')],
    });
    assert.equal(m.unitsThen, 3_000_000);
    assert.ok(Math.abs(m.pct - (-2 / 3) * 100) < 1e-9);
  });

  test('a transfer outside the window is not counted', () => {
    const m = movementOf({
      address: WHALE, unitsNow: 100, days: 30, now: NOW,
      transfers: [move(60, 50, 'out'), move(90, 10, 'in')],
    });
    assert.equal(m.netUnits, 0);
    assert.equal(m.unitsThen, 100);
    assert.equal(m.transfers, 0);
  });

  test('a wallet paying itself moved nothing', () => {
    const m = movementOf({
      address: WHALE, unitsNow: 100, days: 30, now: NOW,
      transfers: [{ at: (NOW - DAY) / 1000, from: WHALE, to: WHALE, units: 50 }, move(60, 0, 'in')],
    });
    assert.equal(m.netUnits, 0);
  });

  test('the comparison does not care about case', () => {
    const m = movementOf({
      address: '0xWhAlE', unitsNow: 100, days: 30, now: NOW,
      transfers: [{ at: (NOW - DAY) / 1000, from: '0xa', to: '0xWHALE', units: 10 },
        move(90, 1, 'in')],
    });
    assert.equal(m.inUnits, 10);
  });
});

describe('what the page cannot reach', () => {
  test('a list that stops inside the window answers nothing about it', () => {
    // Fifty movements is months for most holders and a week for a busy one.
    // Reporting the week as though it were the month would invent a change.
    const busy = Array.from({ length: 50 }, (_, i) => move(i * 0.1, 1000, 'out'));
    const m = movementOf({
      address: WHALE, unitsNow: 1_000_000, days: 30, now: NOW,
      transfers: busy, complete: false,
    });
    assert.equal(m.covered, false);
    assert.equal(m.unitsThen, undefined, 'no balance should be asserted');
    assert.equal(m.netUnits, undefined);
  });

  test('a short list that is the whole history does cover the window', () => {
    // Several top LINK addresses have not moved since 2019. Twelve transfers
    // is all there is, and all there is covers everything.
    const m = movementOf({
      address: WHALE, unitsNow: 500, days: 90, now: NOW,
      transfers: [move(400, 500, 'in')], complete: true,
    });
    assert.equal(m.covered, true);
    assert.equal(m.unitsThen, 500);
  });

  test('a list reaching past the cutoff covers it even when there is more', () => {
    const m = movementOf({
      address: WHALE, unitsNow: 500, days: 30, now: NOW,
      transfers: [move(2, 100, 'in'), move(45, 400, 'in')], complete: false,
    });
    assert.equal(m.covered, true, 'it saw past the cutoff, so the window is answered');
    assert.equal(m.unitsThen, 400);
  });
});

describe('what to call it', () => {
  const at = (pct, transfers = 3) => describeHolding({ covered: true, pct, transfers });

  test('a position the same size is holding, and is not hedged', () => {
    assert.equal(at(0.4).status, 'Holding');
    assert.equal(at(-1).status, 'Holding');
    assert.ok(MATERIAL_PCT >= 2);
  });

  test('no movement at all is untouched', () => {
    const d = at(0, 0);
    assert.equal(d.status, 'Untouched');
    assert.match(d.note, /not one movement/i);
  });

  test('a real increase is adding and a real decrease is reducing', () => {
    assert.equal(at(15).status, 'Adding');
    assert.equal(at(-15).status, 'Reducing');
    assert.equal(at(15).tone, 'cw-in');
    assert.equal(at(-15).tone, 'cw-out');
  });

  test('a smaller position is never called a sale', () => {
    // The same rule as everywhere else on this page: where it went is a
    // separate question, and the chain does not answer it here.
    const d = at(-40);
    assert.ok(!/sold|sale|sell/i.test(d.status), `the status said "${d.status}"`);
    assert.match(d.note, /separate question/i);
  });

  test('an unanswerable window says so instead of guessing', () => {
    const d = describeHolding({ covered: false });
    assert.equal(d.status, 'Not enough history');
    assert.equal(d.tone, '');
  });

  test('the windows are the two the card asks about', () => {
    assert.deepEqual(WINDOWS.map((w) => w.id), ['30d', '90d']);
  });
});

describe('the day cache, so it is worked out once', () => {
  const key = { chain: 'ethereum', token: '0xTOK', now: NOW };

  test('what was written today is read back today', async () => {
    await writeCache({ ...key, holder: '0xAbC', moves: { '30d': { pct: -12 } } });
    const got = await readCache(key);
    assert.equal(got.get('0xabc')['30d'].pct, -12, 'the address key is lowercased');
  });

  test('an answer from yesterday is not an answer for today', async () => {
    await writeCache({ ...key, holder: '0xa', moves: { '30d': { pct: 1 } } });
    const tomorrow = await readCache({ ...key, now: NOW + DAY });
    assert.equal(tomorrow.size, 0);
  });

  test('writing twice replaces rather than duplicates', async () => {
    await writeCache({ ...key, holder: '0xa', moves: { '30d': { pct: 1 } } });
    await writeCache({ ...key, holder: '0xa', moves: { '30d': { pct: 2 } } });
    const got = await readCache(key);
    assert.equal(got.size, 1);
    assert.equal(got.get('0xa')['30d'].pct, 2);
  });

  test('two tokens do not read each other', async () => {
    await writeCache({ ...key, holder: '0xa', moves: { x: 1 } });
    const other = await readCache({ ...key, token: '0xOTHER' });
    assert.equal(other.size, 0);
  });

  test('old days are pruned away', async () => {
    await writeCache({ ...key, holder: '0xa', moves: { x: 1 }, now: NOW - 10 * DAY });
    await writeCache({ ...key, holder: '0xb', moves: { x: 2 }, now: NOW });
    await prune({ now: NOW });
    assert.equal((await readCache(key)).size, 1);
    assert.equal((await readCache({ ...key, now: NOW - 10 * DAY })).size, 0);
  });
});

describe('reading the indexer', () => {
  const page = (items, more = false) => ({
    ok: true,
    status: 200,
    json: async () => ({ items, next_page_params: more ? { x: 1 } : null }),
  });

  test('raw amounts are scaled by the token decimals', async () => {
    const out = await fetchTransfers({
      host: 'eth.blockscout.com', holder: '0xa', token: '0xTOK',
      fetcher: async () => page([{
        timestamp: '2026-09-01T00:00:00.000000Z',
        from: { hash: '0xa' }, to: { hash: '0xb' },
        total: { value: '1500000000000000000' },
        token: { decimals: '18' },
        transaction_hash: '0xh',
      }]),
    });
    assert.equal(out.transfers[0].units, 1.5);
    assert.equal(out.transfers[0].from, '0xa');
    assert.equal(out.complete, true);
  });

  test('another page means the list is not the whole history', async () => {
    const out = await fetchTransfers({
      host: 'h', holder: '0xa', token: '0xT',
      fetcher: async () => page([{ timestamp: '2026-09-01T00:00:00Z', total: { value: '1' }, token: { decimals: '0' } }], true),
    });
    assert.equal(out.complete, false);
  });

  test('a refusal is an error, not an empty history', async () => {
    // An empty list would read as "this whale has never moved", which is the
    // opposite of "we could not find out".
    await assert.rejects(() => fetchTransfers({
      host: 'h', holder: '0xa', token: '0xT',
      fetcher: async () => ({ ok: false, status: 503 }),
    }), /503/);
  });
});

describe('paging back far enough to answer', () => {
  // The busiest holders burn a page in a week — the largest LINK address spends
  // fifty transfers in nine days — so one page left them permanently
  // unanswerable while the quiet ones were answered from a single request.
  const NOWMS = Date.UTC(2026, 8, 7);
  const stamp = (daysAgo) => new Date(NOWMS - daysAgo * DAY).toISOString();

  /** Pages of transfers, each one older than the last. */
  const pager = (pages) => {
    let i = 0;
    const seen = [];
    const fetcher = async (url) => {
      seen.push(url);
      const page = pages[i++];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: page.items,
          next_page_params: i < pages.length ? { block_number: i } : null,
        }),
      };
    };
    return { fetcher, seen: () => seen };
  };

  const item = (daysAgo) => ({
    timestamp: stamp(daysAgo),
    from: { hash: '0xa' },
    to: { hash: '0xb' },
    total: { value: '1000000000000000000' },
    token: { decimals: '18' },
  });

  test('it keeps asking until the list reaches past the window', async () => {
    const p = pager([
      { items: [item(1), item(3)] },
      { items: [item(10), item(20)] },
      { items: [item(40), item(60)] },
    ]);
    const out = await fetchTransfers({
      host: 'h', holder: '0xb', token: '0xT', fetcher: p.fetcher,
      reachBack: 30, now: NOWMS,
    });
    assert.equal(out.pages, 3, 'it should have needed all three');
    assert.equal(out.transfers.length, 6);
  });

  test('and stops the moment it has reached back far enough', async () => {
    const p = pager([
      { items: [item(1), item(45)] },
      { items: [item(90)] },
    ]);
    const out = await fetchTransfers({
      host: 'h', holder: '0xb', token: '0xT', fetcher: p.fetcher,
      reachBack: 30, now: NOWMS,
    });
    assert.equal(out.pages, 1, 'the first page already passed the cutoff');
  });

  test('a very busy wallet costs a cap, not the whole chain', async () => {
    const busy = Array.from({ length: 9 }, () => ({ items: [item(0.1), item(0.2)] }));
    const out = await fetchTransfers({
      host: 'h', holder: '0xb', token: '0xT', fetcher: pager(busy).fetcher,
      reachBack: 30, maxPages: 4, now: NOWMS,
    });
    assert.equal(out.pages, 4);
    assert.equal(out.complete, false, 'and it admits it did not reach the end');
  });

  test('running out of pages is a complete history, however short', async () => {
    const out = await fetchTransfers({
      host: 'h', holder: '0xb', token: '0xT',
      fetcher: pager([{ items: [item(400)] }]).fetcher,
      reachBack: 30, now: NOWMS,
    });
    assert.equal(out.complete, true);
    assert.equal(out.pages, 1);
  });
});

describe('a wallet that started the window with nothing', () => {
  // A real address came back at −9.3e-10 tokens: it had received all 4,369,740
  // LINK it holds inside the window, so the true answer is exactly zero and the
  // sign was the last bits of a floating-point subtraction. It then fell
  // through to "Holding" — which is the opposite of what a whale that built its
  // entire position this quarter is doing.
  const built = (over = {}) => movementOf({
    address: WHALE,
    unitsNow: 4_369_740.867303842,
    days: 90,
    now: NOW,
    transfers: [
      { at: (NOW - 10 * DAY) / 1000, from: '0xa', to: WHALE, units: 4_618_340.867303843 },
      { at: (NOW - 20 * DAY) / 1000, from: WHALE, to: '0xb', units: 248_600 },
    ],
    complete: true,
    ...over,
  });

  test('lands on exactly zero rather than a negative sliver', () => {
    const m = built();
    assert.equal(m.covered, true);
    assert.equal(m.unitsThen, 0, `got ${m.unitsThen}`);
  });

  test('is flagged as a position opened inside the window', () => {
    assert.equal(built().fromNothing, true);
  });

  test('reads as a new position, never as holding', () => {
    const d = describeHolding(built());
    assert.equal(d.status, 'New position');
    assert.equal(d.tone, 'cw-in');
    assert.ok(!/holding/i.test(d.status));
  });

  test('a wallet that merely held is still holding', () => {
    const m = movementOf({
      address: WHALE, unitsNow: 1_000_000, days: 90, now: NOW, complete: true,
      transfers: [{ at: (NOW - 5 * DAY) / 1000, from: '0xa', to: WHALE, units: 1000 }],
    });
    assert.equal(m.fromNothing, false);
    assert.equal(describeHolding(m).status, 'Holding');
  });

  test('a balance that is negative by more than rounding is unanswerable', () => {
    // Not rounding — it means movements are missing from the list, and a
    // balance that cannot be true must not be presented as one.
    const m = movementOf({
      address: WHALE, unitsNow: 100, days: 30, now: NOW, complete: true,
      transfers: [{ at: (NOW - DAY) / 1000, from: '0xa', to: WHALE, units: 5_000_000 }],
    });
    assert.equal(m.covered, false);
    assert.equal(m.unitsThen, undefined);
  });
});

describe('answers cached before the rules were right', () => {
  test('a stored negative sliver is corrected on the way out', async () => {
    // Fixing it on read means the correction reaches what is already stored,
    // not only what is computed next — otherwise the card keeps saying
    // "Holding" until the cache turns over the following day.
    await writeCache({
      chain: 'ethereum',
      token: '0xTOK',
      holder: '0xa',
      now: NOW,
      moves: { '90d': { covered: true, unitsThen: -9.313225746154785e-10, pct: null, transfers: 34 } },
    });
    const got = await readCache({ chain: 'ethereum', token: '0xTOK', now: NOW });
    const m = got.get('0xa')['90d'];
    assert.equal(m.unitsThen, 0);
    assert.equal(m.fromNothing, true);
    assert.equal(describeHolding(m).status, 'New position');
  });

  test('a healthy stored answer is left exactly as it was', async () => {
    await writeCache({
      chain: 'ethereum',
      token: '0xTOK',
      holder: '0xb',
      now: NOW,
      moves: { '30d': { covered: true, unitsThen: 1000, pct: -12, transfers: 3 } },
    });
    const m = (await readCache({ chain: 'ethereum', token: '0xTOK', now: NOW })).get('0xb')['30d'];
    assert.equal(m.unitsThen, 1000);
    assert.equal(m.pct, -12);
    assert.equal(describeHolding(m).status, 'Reducing');
  });
});

describe('remembering which coin somebody is looking at', () => {
  // The collector fills one coin per poll, and with thirty readable coins on a
  // ten-minute rotation any given coin comes round about every five hours.
  // Fine for a coin nobody is watching, useless for the card on screen.
  beforeEach(() => resetWantedCache());

  test('a note is remembered and comes back', async () => {
    await noteWanted('LINK', { now: NOW });
    assert.deepEqual(await wanted({ now: NOW }), ['LINK']);
  });

  test('the most recently opened comes first', async () => {
    await noteWanted('UNI', { now: NOW - 3 * 60_000 });
    await noteWanted('LINK', { now: NOW - 60_000 });
    assert.deepEqual(await wanted({ now: NOW }), ['LINK', 'UNI']);
  });

  test('opening the same coin twice leaves one note, not two', async () => {
    await noteWanted('LINK', { now: NOW - 60_000 });
    await noteWanted('LINK', { now: NOW });
    assert.deepEqual(await wanted({ now: NOW }), ['LINK']);
  });

  test('a coin opened once yesterday is not what the next poll should do', async () => {
    await noteWanted('OLD', { now: NOW - 12 * 3_600_000 });
    await noteWanted('NEW', { now: NOW });
    assert.deepEqual(await wanted({ now: NOW }), ['NEW']);
  });

  test('no notes at all is an empty list, not a throw', async () => {
    assert.deepEqual(await wanted({ now: NOW }), []);
  });
});
