/**
 * The accumulation, performance, consensus and stealth layers.
 *
 * Each is a pure function over transfers, so every case here is a book whose
 * right answer is known by construction rather than by running it and writing
 * down what came out.
 *
 * The case the whole file exists for is `stealth`: a wallet that wants thirty
 * million dollars of something and does not want to be seen taking it will take
 * it in pieces, and every piece falls under the transaction tracker's floor.
 * That is not exotic behaviour, it is what anyone competent does, and a tracker
 * that only watches for single large transfers cannot see it at all.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  WINDOWS, windowDef, accumulation, performance, consensus, stealth,
  MIN_OBSERVATIONS, PARTICIPANT_FLOOR_USD, ranked, WHALE_FLOOR_USD,
} from '../api/_lib/whaleflow.js';

const NOW = 1_790_000_000_000;
const secs = (hoursAgo) => Math.floor(NOW / 1000) - hoursAgo * 3600;

/** One recorded transfer, in the shape the store hands back. */
const move = ({
  from = '0xsrc', to = '0xdst', usd = 3_000_000, amount = 1000,
  symbol = 'ETH', chain = 'ethereum', hoursAgo = 1, kind = 'transfer', id,
}) => ({
  id: id ?? `${chain}:${from}:${to}:${usd}:${hoursAgo}`,
  at: secs(hoursAgo),
  blockchain: chain,
  symbol,
  kind,
  amount,
  usd,
  hash: '0xhash',
  from: { address: from, owner: null, ownerType: null },
  to: { address: to, owner: null, ownerType: null },
  parts: 1,
});

/** Ten quiet buys into one wallet: $30M, no piece over $20M. */
const stealthBook = (wallet = '0xWHALE', n = 10, each = 3_000_000) =>
  Array.from({ length: n }, (_, i) => move({
    from: `0xseller${i}`, to: wallet, usd: each, amount: 1000, hoursAgo: 40 - i, id: `s${i}`,
  }));

describe('the windows', () => {
  test('the four kept, shortest first', () => {
    // 6h went: between an hour and a day it told nobody anything the other two
    // did not, and every extra tab is one more thing to read past.
    assert.deepEqual(WINDOWS.map((w) => w.id), ['1h', '24h', '7d', '30d']);
    assert.equal(windowDef('24h').hours, 24);
    assert.equal(windowDef('30d').hours, 720);
  });

  test('an unknown window falls back rather than returning nothing', () => {
    assert.equal(windowDef('nonsense').id, '7d');
    assert.equal(windowDef('6h').id, '7d', 'the removed window falls back cleanly');
  });

  test('a window only counts what falls inside it', () => {
    const rows = [
      move({ to: '0xA', usd: 5_000_000, hoursAgo: 2 }),
      move({ to: '0xA', usd: 7_000_000, hoursAgo: 100, id: 'old' }),
    ];
    const day = accumulation(rows, { hours: 24, now: NOW }).find((w) => w.address === '0xA');
    const week = accumulation(rows, { hours: 168, now: NOW }).find((w) => w.address === '0xA');
    assert.equal(day.netUsd, 5_000_000);
    assert.equal(week.netUsd, 12_000_000);
  });
});

describe('accumulation', () => {
  test('ten small buys are one $30M position', () => {
    // The entire point. None of these ten would appear in the transaction
    // tracker; together they are a position being built.
    const [whale] = accumulation(stealthBook(), { hours: 168, now: NOW })
      .filter((w) => w.address === '0xWHALE');
    assert.equal(whale.netUsd, 30_000_000);
    assert.equal(whale.receivedUsd, 30_000_000);
    assert.equal(whale.sentUsd, 0);
    assert.equal(whale.transfers, 10);
    assert.equal(whale.largestUsd, 3_000_000, 'no single piece was large');
    assert.equal(whale.conviction, 1, 'it never sent anything back');
  });

  test('buys and sells are both counted, and net is their difference', () => {
    const rows = [
      move({ to: '0xA', usd: 10_000_000, id: 'a' }),
      move({ from: '0xA', to: '0xz', usd: 4_000_000, id: 'b' }),
    ];
    const a = accumulation(rows, { hours: 24, now: NOW }).find((w) => w.address === '0xA');
    assert.equal(a.receivedUsd, 10_000_000);
    assert.equal(a.sentUsd, 4_000_000);
    assert.equal(a.netUsd, 6_000_000);
    assert.equal(a.grossUsd, 14_000_000);
  });

  test('a pass-through nets to zero and scores no conviction', () => {
    // Money in and straight back out is a router. It is most of a raw feed and
    // this is what keeps it off the top of the list without a blocklist.
    const rows = [
      move({ to: '0xPIPE', usd: 50_000_000, id: 'in' }),
      move({ from: '0xPIPE', to: '0xout', usd: 50_000_000, id: 'out' }),
    ];
    const pipe = accumulation(rows, { hours: 24, now: NOW }).find((w) => w.address === '0xPIPE');
    assert.equal(pipe.netUsd, 0);
    assert.equal(pipe.conviction, 0);
  });

  test('mints, burns and contract legs are not a position', () => {
    const rows = [
      move({ to: '0xM', usd: 80_000_000, kind: 'mint', id: 'm' }),
      move({ to: '0xC', usd: 90_000_000, kind: 'contract', id: 'c' }),
      move({ to: '0xB', usd: 70_000_000, kind: 'burn', id: 'b' }),
    ];
    assert.deepEqual(accumulation(rows, { hours: 24, now: NOW }), []);
  });

  test('the burn hole is never a wallet', () => {
    const rows = [move({ to: '0x0000000000000000000000000000000000000000', usd: 9e8 })];
    const out = accumulation(rows, { hours: 24, now: NOW });
    assert.ok(!out.some((w) => /^0x0{40}$/.test(w.address)));
  });

  test('token quantities are carried, so a position can be marked later', () => {
    const rows = [move({ to: '0xA', usd: 3_000_000, amount: 1200, symbol: 'ETH' })];
    const a = accumulation(rows, { hours: 24, now: NOW }).find((w) => w.address === '0xA');
    assert.deepEqual(a.symbols, [{ symbol: 'ETH', netUsd: 3_000_000, netUnits: 1200 }]);
  });

  test('one asset can be asked about on its own', () => {
    const rows = [
      move({ to: '0xA', usd: 5_000_000, symbol: 'ETH', id: 'e' }),
      move({ to: '0xA', usd: 9_000_000, symbol: 'WBTC', id: 'w' }),
    ];
    const eth = accumulation(rows, { hours: 24, now: NOW, symbol: 'ETH' })
      .find((w) => w.address === '0xA');
    assert.equal(eth.netUsd, 5_000_000);
  });
});

describe('performance, and its refusal to invent one', () => {
  const prices = new Map([['ETH', 4000]]);

  test('too few observations gets no score and says why', () => {
    const [w] = accumulation([move({ to: '0xA', usd: 3_000_000 })], { hours: 24, now: NOW })
      .filter((x) => x.address === '0xA');
    const p = performance(w, prices, { now: NOW });
    assert.equal(p.score, null);
    assert.match(p.reason, /transfers observed/);
    assert.ok(MIN_OBSERVATIONS > 1);
  });

  test('enough observations over enough time gets a real mark', () => {
    // 10 buys, 1,000 ETH each, recorded at $3M a piece — so $3,000/ETH then.
    // ETH is $4,000 now, so the accumulation is up a third.
    const [w] = accumulation(stealthBook(), { hours: 168, now: NOW })
      .filter((x) => x.address === '0xWHALE');
    const p = performance(w, prices, { now: NOW });
    assert.equal(p.accumulatedUsd, 30_000_000);
    assert.equal(p.worthNowUsd, 40_000_000);
    assert.ok(Math.abs(p.markPct - 33.33) < 0.1, `mark was ${p.markPct}`);
    // Conviction is 1 here, so the score is the mark.
    assert.ok(Math.abs(p.score - p.markPct) < 0.01);
    assert.equal(p.observations, 10);
  });

  test('a wallet that round-tripped is marked down for it', () => {
    const rows = [...stealthBook('0xHALF', 10, 3_000_000),
      move({ from: '0xHALF', to: '0xz', usd: 15_000_000, amount: 5000, hoursAgo: 2, id: 'sell' })];
    const w = accumulation(rows, { hours: 168, now: NOW }).find((x) => x.address === '0xHALF');
    const p = performance(w, prices, { now: NOW });
    assert.ok(p.conviction < 1 && p.conviction > 0, `conviction ${p.conviction}`);
    assert.ok(Math.abs(p.score) < Math.abs(p.markPct), 'a round-trip was not tempered');
  });

  test('an unpriced asset is not marked at zero', () => {
    const rows = stealthBook('0xX', 10, 3_000_000).map((r) => ({ ...r, symbol: 'NOSUCH' }));
    const w = accumulation(rows, { hours: 168, now: NOW }).find((x) => x.address === '0xX');
    const p = performance(w, prices, { now: NOW });
    assert.equal(p.score, null);
    assert.match(p.reason, /no priced accumulation/);
  });

  test('every input to the score is on the object beside it', () => {
    const [w] = accumulation(stealthBook(), { hours: 168, now: NOW })
      .filter((x) => x.address === '0xWHALE');
    const p = performance(w, prices, { now: NOW });
    // A number nobody can take apart is a number nobody should trust.
    for (const k of ['markPct', 'conviction', 'observations', 'spanHours', 'accumulatedUsd', 'worthNowUsd']) {
      assert.ok(p[k] != null, `${k} was not reported`);
    }
  });
});

describe('consensus', () => {
  const wallets = (spec) => spec.map(([address, net], i) => ({
    address,
    netUsd: net,
    receivedUsd: net > 0 ? net : 0,
    sentUsd: net < 0 ? -net : 0,
    grossUsd: Math.abs(net),
    transfers: 5,
    symbols: [{ symbol: 'ETH', netUsd: net, netUnits: 100 * (i + 1) }],
    largestUsd: 2_000_000,
    conviction: 1,
    firstAt: secs(30),
    lastAt: secs(1),
    chains: ['ethereum'],
  }));

  test('many buyers and few sellers is strong accumulation', () => {
    const c = consensus(wallets([['a', 30e6], ['b', 25e6], ['c', 20e6], ['d', -5e6]]));
    assert.equal(c.trend, 'Strong Accumulation');
    assert.equal(c.accumulating, 3);
    assert.equal(c.distributing, 1);
    assert.equal(c.buyUsd, 75e6);
    assert.equal(c.sellUsd, 5e6);
    assert.equal(c.netUsd, 70e6);
    assert.equal(c.holding, 3, 'none of the buyers sent anything back');
  });

  test('the mirror case is strong distribution', () => {
    const c = consensus(wallets([['a', -30e6], ['b', -25e6], ['c', -20e6], ['d', 5e6]]));
    assert.equal(c.trend, 'Strong Distribution');
    assert.ok(c.netUsd < 0);
  });

  test('balanced flow is neutral however much money moved', () => {
    const c = consensus(wallets([['a', 50e6], ['b', -48e6], ['c', 30e6], ['d', -31e6]]));
    assert.equal(c.trend, 'Neutral');
    assert.ok(c.grossUsd > 150e6, 'plenty moved; none of it agreed');
  });

  test('one wallet is not a consensus, however one-sided', () => {
    // $400M in one direction from a single address is a fact about one address.
    const c = consensus(wallets([['a', 400e6]]));
    assert.equal(c.trend, 'Neutral');
    assert.equal(c.thin, true);
  });

  test('three or more on the heavy side is what makes it strong', () => {
    const two = consensus(wallets([['a', 50e6], ['b', 50e6]]));
    assert.equal(two.trend, 'Accumulation', 'two wallets should not read as strong');
    const three = consensus(wallets([['a', 50e6], ['b', 50e6], ['c', 50e6]]));
    assert.equal(three.trend, 'Strong Accumulation');
  });

  test('wallets under the floor are not participants', () => {
    const c = consensus(wallets([['a', 50e6], ['b', 400_000], ['c', -100_000]]));
    assert.equal(c.participants, 1);
    // Half a million: the measured distribution puts almost everything under a
    // million, so a million-dollar floor excluded most of what should count.
    assert.equal(PARTICIPANT_FLOOR_USD, 500_000);
  });

  test('an empty book is neutral, not a crash', () => {
    const c = consensus([]);
    assert.equal(c.trend, 'Neutral');
    assert.equal(c.participants, 0);
    assert.equal(c.netUsd, 0);
  });
});

describe('stealth accumulation — the case this was built for', () => {
  test('thirty million in ten pieces, none of them large, is detected', () => {
    const w = accumulation(stealthBook(), { hours: 168, now: NOW });
    const s = stealth(w, { displayFloor: 20_000_000 });
    assert.ok(s, 'a quiet $30M build was missed');
    assert.equal(s.netUsd, 30_000_000);
    assert.equal(s.transfers, 10);
    assert.ok(s.largestUsd < 20_000_000, 'it would have shown in the other panel');
    assert.deepEqual(s.symbols, [{ symbol: 'ETH', usd: 30_000_000 }]);
  });

  test('a single huge transfer is not stealth', () => {
    // It is a big move, the transaction tracker already showed it, and calling
    // it stealth would make the alert meaningless.
    const rows = [move({ to: '0xLOUD', usd: 60_000_000, amount: 20_000 })];
    const w = accumulation(rows, { hours: 168, now: NOW });
    assert.equal(stealth(w, { displayFloor: 20_000_000 }), null);
  });

  test('a quiet build with one loud transfer in it is not stealth either', () => {
    const rows = [...stealthBook('0xMIX', 10, 3_000_000),
      move({ to: '0xMIX', usd: 25_000_000, hoursAgo: 3, id: 'loud' })];
    const w = accumulation(rows, { hours: 168, now: NOW });
    assert.equal(stealth(w, { displayFloor: 20_000_000 }), null);
  });

  test('too little in total is not worth an alert', () => {
    const w = accumulation(stealthBook('0xSMALL', 10, 500_000), { hours: 168, now: NOW });
    assert.equal(stealth(w, { displayFloor: 20_000_000, minNetUsd: 25_000_000 }), null);
  });

  test('too few transfers is not stealth, it is just a few buys', () => {
    const w = accumulation(stealthBook('0xFEW', 3, 15_000_000), { hours: 168, now: NOW });
    assert.equal(stealth(w, { displayFloor: 20_000_000, minTransfers: 8 }), null);
  });

  test('several wallets each buying quietly add up to one alert', () => {
    const rows = [
      ...stealthBook('0xA', 5, 4_000_000),
      ...stealthBook('0xB', 5, 4_000_000).map((r) => ({ ...r, id: `b${r.id}` })),
      ...stealthBook('0xC', 5, 4_000_000).map((r) => ({ ...r, id: `c${r.id}` })),
    ];
    const s = stealth(accumulation(rows, { hours: 168, now: NOW }), { displayFloor: 20_000_000 });
    assert.equal(s.wallets, 3);
    assert.equal(s.netUsd, 60_000_000);
    assert.equal(s.transfers, 15);
  });

  test('sellers are not reported as stealth accumulation', () => {
    const rows = stealthBook('0xS', 10, 3_000_000)
      .map((r) => ({ ...r, from: r.to, to: r.from }));
    const s = stealth(accumulation(rows, { hours: 168, now: NOW }), { displayFloor: 20_000_000 });
    assert.equal(s, null);
  });
});

describe('the ranked table — one row per whale per coin', () => {
  /** Romy's own example, in his numbers. */
  const john = {
    address: '0xjohn', owner: 'John', netUsd: 3e6, transfers: 4, chains: ['ethereum'],
    lastAt: 100, firstAt: 1,
    symbols: [
      { symbol: 'BTC', netUsd: 2e6, netUnits: 25 },
      { symbol: 'SOL', netUsd: 1e6, netUnits: 4000 },
    ],
  };
  const bob = {
    address: '0xbob', owner: 'Bob', netUsd: 5e5, transfers: 2, chains: ['ethereum'],
    lastAt: 100, firstAt: 1,
    symbols: [{ symbol: 'ETH', netUsd: 5e5, netUnits: 200 }],
  };
  const joseph = {
    address: '0xjoseph', owner: 'Joseph', netUsd: 1e7, transfers: 6, chains: ['bitcoin'],
    lastAt: 100, firstAt: 1,
    symbols: [{ symbol: 'BTC', netUsd: 1e7, netUnits: 125 }],
  };

  test('Joseph, then John twice, and Bob nowhere', () => {
    const out = ranked([john, bob, joseph], { floor: 1e6 });
    assert.deepEqual(out.map((r) => [r.owner, r.symbol, r.netUsd]), [
      ['Joseph', 'BTC', 1e7],
      ['John', 'BTC', 2e6],
      ['John', 'SOL', 1e6],
    ]);
    // Bob moved half a million; he is not a whale at any floor here.
    assert.ok(!out.some((r) => r.owner === 'Bob'));
  });

  test('rank is the position in the table, counting from one', () => {
    assert.deepEqual(ranked([john, joseph], { floor: 1e6 }).map((r) => r.rank), [1, 2, 3]);
  });

  test('a whale qualifies on everything it moved, then ranks per coin', () => {
    // John's two positions are each under the $10M floor, but he is not judged
    // per coin — he never reaches it on the total either, so he is out.
    assert.deepEqual(ranked([john, joseph]).map((r) => r.owner), ['Joseph']);
    // Raise his total past the floor and both his coins appear.
    const bigJohn = { ...john, netUsd: 12e6 };
    assert.deepEqual(ranked([bigJohn, joseph]).map((r) => [r.owner, r.symbol]),
      [['Joseph', 'BTC'], ['John', 'BTC'], ['John', 'SOL']]);
  });

  test('a large sale ranks beside a large purchase, not below it', () => {
    const seller = {
      address: '0xsell', owner: 'Seller', netUsd: -4e7, transfers: 9, chains: ['ethereum'],
      lastAt: 100, firstAt: 1, symbols: [{ symbol: 'ETH', netUsd: -4e7, netUnits: -10000 }],
    };
    const out = ranked([joseph, seller]);
    assert.equal(out[0].owner, 'Seller', 'the biggest move was not first');
    assert.ok(out[0].netUsd < 0, 'the sign is kept so the direction still reads');
  });

  test('a dust position inside a real whale is not given a row', () => {
    const mixed = {
      ...joseph,
      symbols: [{ symbol: 'BTC', netUsd: 1e7, netUnits: 125 },
        { symbol: 'SHIB', netUsd: 4_000, netUnits: 1e9 }],
    };
    assert.deepEqual(ranked([mixed]).map((r) => r.symbol), ['BTC']);
  });

  test('the table stops at fifty', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      address: `0x${i}`, owner: null, netUsd: 2e7 + i, transfers: 3, chains: ['ethereum'],
      lastAt: 100, firstAt: 1, symbols: [{ symbol: 'ETH', netUsd: 2e7 + i, netUnits: 5000 }],
    }));
    assert.equal(ranked(many).length, 50);
  });

  test('each row says how many other positions its whale holds', () => {
    const [first, second] = ranked([{ ...john, netUsd: 12e6 }], { floor: 1e6 });
    assert.equal(first.walletPositions, 2);
    assert.equal(second.walletPositions, 2);
    assert.equal(WHALE_FLOOR_USD, 10_000_000);
  });

  test('nothing to rank is an empty table, not a crash', () => {
    assert.deepEqual(ranked([]), []);
    assert.deepEqual(ranked(null), []);
  });
});
