/**
 * A backtest of the whale page, over generated books rather than fixtures.
 *
 * The other test files check each rule against a case chosen to exercise it.
 * This does the opposite: it generates thousands of transfers at random — sizes
 * across every band, times across a year, exchange and bridge and contract and
 * null-address ends, swaps, self-sends, mints — and asserts the properties that
 * must hold whatever arrives. A rule that only holds on the cases somebody
 * thought of is not a rule.
 *
 * The generator is seeded, so a failure is reproducible exactly rather than
 * being a thing that happened once on somebody's machine.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { classifyActivity, linkSwaps, ACTIONS } from '../api/_lib/activity.js';
import {
  selectTransfers, bandDef, ACTIVITY_WINDOWS, activityWindowDef, money,
} from '../src/services/cryptoWhales.js';
import { signalOf, PERIODS } from '../api/_lib/netflowcard.js';
import { rankHolders, exitEvents } from '../api/_lib/topholders.js';

let seed = 20260907;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

const LABELS = new Map([
  ['0xbin', { venue: 'Binance', name: 'Binance 14' }],
  ['0xbin2', { venue: 'Binance', name: 'Binance 7' }],
  ['0xcb', { venue: 'Coinbase', name: 'Coinbase 1' }],
  ['0xkr', { venue: 'Kraken', name: 'Kraken 3' }],
]);

const NULL0 = '0x0000000000000000000000000000000000000000';
const SYMBOLS = ['BTC', 'ETH', 'USDT', 'USDC', 'LINK', 'WBTC', 'SOL', 'DAI'];
const NOW = Math.floor(Date.now() / 1000);

/** The five kinds of end the classifier has to tell apart. */
const ENDS = [
  () => ({ address: `0x${Math.floor(rand() * 1e9).toString(16)}` }),
  () => ({ address: pick(['0xbin', '0xbin2', '0xcb', '0xkr']) }),
  () => ({ address: '0xw', owner: pick(['Wormhole Bridge', 'Stargate', 'Hop Protocol']) }),
  () => ({ address: '0xc', ownerType: 'contract', owner: pick(['Aave: Pool', 'Morpho', 'UniswapV3Pool']) }),
  () => ({ address: NULL0 }),
];

function makeTransfer(i) {
  // Cubed, so most transfers are small and the big ones are rare — which is the
  // shape the real record has, and the shape that makes the top bands sparse.
  const usd = Math.floor(10_000 + rand() ** 3 * 900_000_000);
  const from = pick(ENDS)();
  return {
    id: i,
    at: NOW - Math.floor(rand() * 366 * 86400),
    blockchain: pick(['ethereum', 'bitcoin', 'tron', 'polygon']),
    symbol: pick(SYMBOLS),
    kind: rand() < 0.05 ? pick(['mint', 'burn']) : 'transfer',
    amount: usd / (rand() * 1000 + 1),
    usd,
    hash: `0x${i.toString(16)}`,
    from,
    // Sometimes an address pays itself, which the tape used to count twice.
    to: rand() < 0.03 ? { ...from } : pick(ENDS)(),
    parts: 1,
  };
}

function makeBook(b, size) {
  const book = Array.from({ length: size }, (_, i) => makeTransfer(b * size + i));
  // Some of them are real swaps: two legs sharing one hash through a pool.
  for (let i = 0; i < book.length - 1; i += 37) {
    const pool = { address: `0xpool${i}`, ownerType: 'contract', owner: 'UniswapV3Pool' };
    book[i] = { ...book[i], hash: `0xswap${b}_${i}`, to: pool, symbol: 'USDT', kind: 'transfer' };
    book[i + 1] = { ...book[i + 1], hash: `0xswap${b}_${i}`, from: pool, symbol: 'ETH', kind: 'transfer' };
  }
  return linkSwaps(book);
}

const BOOKS = 60;
const PER_BOOK = 400;
const books = Array.from({ length: BOOKS }, (_, b) => makeBook(b, PER_BOOK));
const seenActions = new Set();

describe('what every classified row must be, whatever arrives', () => {
  test('the action is always one of the eight the table can render', () => {
    const allowed = new Set(Object.values(ACTIONS));
    for (const book of books) {
      for (const t of book) {
        const a = classifyActivity(t, { byAddress: LABELS });
        seenActions.add(a.action);
        assert.ok(allowed.has(a.action), `unknown action ${a.action}`);
      }
    }
  });

  test('nothing is a buy or a sell without both legs on-chain', () => {
    // The rule the whole feature rests on, checked against 24,000 rows rather
    // than against the handful somebody thought to write down.
    for (const book of books) {
      for (const t of book) {
        const a = classifyActivity(t, { byAddress: LABELS });
        if (a.confirmed) assert.ok(t.swap, 'confirmed with one leg');
        if (!t.swap) {
          assert.ok(a.action !== ACTIONS.BUY && a.action !== ACTIONS.SELL,
            `called ${a.action} with one leg`);
        }
      }
    }
  });

  test('an exchange deposit always carries the caveat and never says sold', () => {
    for (const book of books) {
      for (const t of book) {
        const a = classifyActivity(t, { byAddress: LABELS });
        if (a.action !== ACTIONS.DEPOSIT) continue;
        assert.match(a.note, /not confirmed/i);
        assert.ok(!/sold|sell/i.test(a.action));
      }
    }
  });

  test('every field the table renders is present and non-empty', () => {
    for (const book of books) {
      for (const t of book) {
        const a = classifyActivity(t, { byAddress: LABELS });
        for (const k of ['path', 'assetFlow', 'action', 'note', 'fromLabel', 'toLabel']) {
          assert.equal(typeof a[k], 'string', `${k} is not a string`);
          assert.ok(a[k].length > 0, `${k} is empty`);
        }
      }
    }
  });

  test('the asset only changes when a swap says it did', () => {
    for (const book of books) {
      for (const t of book) {
        const a = classifyActivity(t, { byAddress: LABELS });
        if (t.swap) assert.notEqual(a.assetFrom, a.assetTo, 'a swap into the same asset');
        else assert.equal(a.assetFrom, a.assetTo, 'a conversion with no swap');
      }
    }
  });

  test('a wallet paying itself is never a trade', () => {
    for (const book of books) {
      for (const t of book) {
        if (!t.from.address || t.from.address !== t.to.address) continue;
        // The null address is the exception: a self-send there is issuance or
        // destruction, not somebody moving their own coins.
        if (t.swap || t.kind !== 'transfer' || t.from.address === NULL0) continue;
        assert.equal(classifyActivity(t, { byAddress: LABELS }).action, ACTIONS.INTERNAL);
      }
    }
  });

  test('all eight actions were actually exercised', () => {
    assert.equal(seenActions.size, 8, `only saw: ${[...seenActions].sort().join(', ')}`);
  });
});

describe('the size bands partition the tape', () => {
  test('the three bands hold every row the "all" band does, and each row once', () => {
    for (const book of books) {
      const all = selectTransfers(book, { band: 'all', limit: 1e6 });
      const parts = ['big', 'huge', 'mega'].map((id) => ({
        id, rows: selectTransfers(book, { band: id, limit: 1e6 }),
      }));

      assert.equal(parts.reduce((n, p) => n + p.rows.length, 0), all.length,
        'the bands do not add up to the whole');

      const seen = new Set();
      for (const p of parts) {
        const { min, max } = bandDef(p.id);
        for (const r of p.rows) {
          assert.ok(!seen.has(r.id), 'one transfer landed in two bands');
          seen.add(r.id);
          assert.ok(r.usd >= min && r.usd < max, `${r.usd} is outside ${p.id}`);
        }
      }
    }
  });

  test('nothing under the floor ever reaches the tape', () => {
    for (const book of books) {
      for (const r of selectTransfers(book, { band: 'all', limit: 1e6 })) {
        assert.ok(r.usd >= 25_000_000, `${r.usd} is under the floor`);
      }
    }
  });
});

describe('the timeframes nest', () => {
  test('each window is a superset of the shorter one', () => {
    for (const book of books) {
      const sets = ACTIVITY_WINDOWS.map((w) => new Set(
        selectTransfers(book, { band: 'all', window: w.id, limit: 1e6 }).map((r) => r.id),
      ));
      for (let i = 1; i < sets.length; i += 1) {
        for (const id of sets[i - 1]) {
          assert.ok(sets[i].has(id), 'a longer window dropped a row the shorter one kept');
        }
      }
    }
  });

  test('no window ever shows something older than itself', () => {
    for (const book of books) {
      for (const w of ACTIVITY_WINDOWS) {
        const cut = NOW - w.hours * 3600;
        for (const r of selectTransfers(book, { band: 'all', window: w.id, limit: 1e6 })) {
          assert.ok(r.at >= cut, `${w.label} showed a row from outside it`);
        }
      }
    }
  });

  test('the tape is newest first, always', () => {
    for (const book of books) {
      const rows = selectTransfers(book, { band: 'all', limit: 1e6 });
      for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].at >= rows[i].at);
    }
  });
});

describe('the netflow sign convention, which inverts', () => {
  test('bullish is always an outflow and bearish always an inflow', () => {
    // Getting this backwards would invert the most actionable number on the
    // page while leaving it looking entirely reasonable.
    for (let i = 0; i < 2000; i += 1) {
      const net = (rand() - 0.5) * 2e9;
      const gross = Math.abs(net) + rand() * 2e9;
      const s = signalOf(net, gross);
      assert.ok(['Bullish', 'Bearish', 'Neutral'].includes(s), `bad signal ${s}`);
      if (s === 'Bullish') assert.ok(net < 0, 'bullish on an inflow');
      if (s === 'Bearish') assert.ok(net > 0, 'bearish on an outflow');
    }
  });
});

describe('the holder ranking, over random holder lists', () => {
  const makeHolders = () => Array.from({ length: 60 }, (_, i) => ({
    holder: rand() < 0.25 ? pick(['0xbin', '0xcb', NULL0]) : `0xh${i}`,
    name: rand() < 0.2 ? pick(['Lido: stETH', 'GnosisSafeProxy', 'Wormhole Bridge']) : null,
    isContract: rand() < 0.3,
    units: Math.floor(rand() * 1e7) + 1,
  }));

  test('twenty-five at most, investors only, biggest first, ranks consecutive', () => {
    for (let i = 0; i < 60; i += 1) {
      const ranked = rankHolders(makeHolders(), {
        price: 13.3, totalSupply: 1e9, byAddress: LABELS,
      });
      assert.ok(ranked.length <= 25);
      assert.ok(ranked.every((h) => h.kind === 'whale'), 'a non-investor in the ranking');
      for (let j = 1; j < ranked.length; j += 1) {
        assert.ok(ranked[j - 1].usd >= ranked[j].usd, 'out of order');
        assert.equal(ranked[j].rank, j + 1, 'ranks not consecutive');
      }
      assert.ok(ranked.every((h) => h.pctSupply >= 0 && h.pctSupply <= 100),
        'an impossible share of supply');
    }
  });

  test('an exit event is always a fall, and never a sale it cannot show', () => {
    for (const book of books.slice(0, 20)) {
      const changes = Array.from({ length: 30 }, (_, i) => ({
        holder: `0xh${i}`,
        name: null,
        symbol: 'LINK',
        chain: 'ethereum',
        unitsBefore: 1e6,
        unitsAfter: 9e5,
        unitsDelta: -1e5,
        pct: (rand() - 0.5) * 200,
        usdDelta: (rand() - 0.5) * 2e8,
        at: NOW - Math.floor(rand() * 1e6),
      }));
      for (const e of exitEvents({ changes, transfers: book, byAddress: LABELS, symbol: 'LINK' })) {
        assert.ok(e.usdMoved > 0, 'an exit event that moved nothing');
        assert.ok(!e.confirmed || /swap/i.test(e.status), 'confirmed without a swap');
        assert.ok(e.status !== 'Sold / swapped' || e.gotAsset, 'a sale with nothing received');
      }
    }
  });
});

describe('the pieces that have quietly broken before', () => {
  test('the formatter keeps its dollar sign, its sign and its units', () => {
    // It has lost the dollar sign to a bad heredoc and spoken only in millions.
    for (const n of [0, 1, 999, 1000, 1e6, 25e6, 1e9, 1.234e12, -5e8, -1200]) {
      const s = money(n);
      assert.ok(s.includes('$'), `money(${n}) = ${s}`);
      assert.ok(!/NaN|Infinity|undefined/.test(s), `money(${n}) = ${s}`);
      assert.equal(n < 0, s.startsWith('-'), `money(${n}) = ${s}`);
    }
    assert.equal(money(12_000), '$12k');
    assert.equal(money(84.3e6), '$84.3M');
    assert.equal(money(1.2e9), '$1.20B');
  });

  test('the fallbacks fall back by name, never by index', () => {
    // Both of these have moved underneath an index and silently changed which
    // default the reader got.
    assert.equal(bandDef('nonsense').id, 'all');
    assert.equal(activityWindowDef('nonsense').id, '7d');
  });

  test('the netflow periods are the five the card draws', () => {
    assert.equal(PERIODS.length, 5);
    assert.deepEqual(PERIODS.map((p) => p.id), ['24h', '7d', '1m', '6m', '1y']);
  });
});
