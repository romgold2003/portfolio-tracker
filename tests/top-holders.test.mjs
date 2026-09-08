/**
 * The Top Holder Whales card.
 *
 * The rule the whole file turns on: **tokens arriving at a centralised exchange
 * are not a sale.** The chain shows them entering and says nothing about what
 * happened inside, so calling that "sold" would be the most confident wrong
 * thing this app could say. A swap through a DEX is different — both legs are
 * on-chain — and only that earns the word.
 *
 * The second rule: leaving the top twenty-five is not an event. A holder pushed
 * down because somebody else bought more has done nothing, and reporting it
 * would invent an exit every time a buyer appeared.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyHolder, rankHolders, describeMove, exitEvents,
  NOT_AN_INVESTOR, HOLDER_LABEL, MATERIAL_PCT,
} from '../api/_lib/topholders.js';

const LABELS = new Map([
  ['0xbin', { venue: 'Binance', name: 'Binance 14' }],
  ['0xcb', { venue: 'Coinbase', name: 'Coinbase 1' }],
]);

const holder = (over = {}) => ({
  holder: '0xwhale', name: null, isContract: false, units: 1000, ...over,
});

describe('what an address is', () => {
  test('a burn address is a burn address whatever it is called', () => {
    for (const a of [
      '0x0000000000000000000000000000000000000000',
      '0x000000000000000000000000000000000000dEaD',
    ]) assert.equal(classifyHolder({ address: a }), 'burn');
  });

  test('the label set outranks everything for a venue', () => {
    assert.equal(classifyHolder({ address: '0xbin', byAddress: LABELS }), 'exchange');
    // Even if it also looks like a contract.
    assert.equal(classifyHolder({ address: '0xbin', isContract: true, byAddress: LABELS }), 'exchange');
  });

  test('the contract creator is the project', () => {
    assert.equal(classifyHolder({ address: '0xAbC', creator: '0xabc' }), 'treasury',
      'the comparison must not care about case');
  });

  test('bridges, custodians, treasuries and staking are told apart by name', () => {
    const c = (name) => classifyHolder({ address: '0xz', name, isContract: true });
    assert.equal(c('Wormhole Bridge'), 'bridge');
    assert.equal(c('Coinbase Custody'), 'custodian');
    assert.equal(c('GnosisSafeProxy'), 'treasury');
    assert.equal(c('Lido: stETH'), 'staking');
    assert.equal(c('Beacon Deposit Contract'), 'staking');
  });

  test('an unlabelled contract is a contract, and an unlabelled wallet is a whale', () => {
    assert.equal(classifyHolder({ address: '0xz', isContract: true }), 'contract');
    assert.equal(classifyHolder({ address: '0xz' }), 'whale');
  });

  test('every kind has something to call it on screen', () => {
    for (const k of [...NOT_AN_INVESTOR, 'whale']) assert.ok(HOLDER_LABEL[k], `${k} has no label`);
  });
});

describe('the top twenty-five', () => {
  const rows = [
    holder({ holder: '0xburn0', units: 9_000_000 }),
    holder({ holder: '0x0000000000000000000000000000000000000000', units: 8_000_000 }),
    holder({ holder: '0xbin', units: 7_000_000 }),
    holder({ holder: '0xlido', name: 'Lido: stETH', isContract: true, units: 6_000_000 }),
    holder({ holder: '0xa', units: 5_000_000 }),
    holder({ holder: '0xb', units: 3_000_000 }),
  ];

  test('the things that are not somebody taking a position are dropped', () => {
    // An exchange's balance is its customers' coins; a staking contract's is
    // everybody's; a burn address holds what nobody will hold again. Ranking
    // them beside investors puts non-opinions at the top of a table of opinions.
    const out = rankHolders(rows, { byAddress: LABELS, price: 10 });
    assert.deepEqual(out.map((h) => h.address), ['0xburn0', '0xa', '0xb']);
    assert.ok(out.every((h) => h.kind === 'whale'));
  });

  test('they are kept and marked when the ranking is not investors-only', () => {
    const out = rankHolders(rows, { byAddress: LABELS, price: 10, investorsOnly: false });
    assert.equal(out.length, 6);
    assert.equal(out.find((h) => h.address === '0xbin').kindLabel, 'Exchange');
  });

  test('ranked by dollars, largest first, numbered from one', () => {
    const out = rankHolders(rows, { byAddress: LABELS, price: 10 });
    assert.deepEqual(out.map((h) => h.rank), [1, 2, 3]);
    assert.ok(out[0].usd > out[1].usd);
    assert.equal(out[0].usd, 90_000_000);
  });

  test('share of supply is a share, or nothing at all', () => {
    const [top] = rankHolders([holder({ units: 250 })], { price: 2, supply: 1000 });
    assert.equal(top.pctSupply, 25);
    // Unknown supply is absent, not zero — those mean different things.
    const [none] = rankHolders([holder({ units: 250 })], { price: 2 });
    assert.equal(none.pctSupply, null);
  });

  test('a venue keeps the name the label set gave it', () => {
    const [top] = rankHolders([holder({ holder: '0xbin' })],
      { byAddress: LABELS, price: 1, investorsOnly: false });
    assert.equal(top.name, 'Binance 14');
  });

  test('the list stops at twenty-five', () => {
    const many = Array.from({ length: 60 }, (_, i) => holder({ holder: `0x${i}`, units: 100 - i }));
    assert.equal(rankHolders(many, { price: 1 }).length, 25);
  });
});

describe('where the tokens went', () => {
  const t = (over = {}) => ({
    symbol: 'ETH', usd: 82_000_000, blockchain: 'ethereum', hash: '0xh', at: 1_790_000_000,
    from: { address: '0xwhale' }, to: { address: '0xdest' }, kind: 'transfer', ...over,
  });

  test('an exchange deposit is never called a sale', () => {
    // The chain shows them entering and nothing more. Whatever the exchange did
    // is on no ledger available here.
    const m = describeMove(t({ to: { address: '0xbin' } }), { byAddress: LABELS });
    assert.equal(m.status, 'Transferred to exchange');
    assert.equal(m.confirmed, false);
    assert.equal(m.destination, 'Binance');
    assert.match(m.note, /sale not confirmed/i);
    assert.ok(!/sold/i.test(m.status), `the status said "${m.status}"`);
  });

  test('a DEX swap is a sale, because both legs are on-chain', () => {
    const m = describeMove(t({ swap: { from: 'ETH', to: 'USDT' } }), { byAddress: LABELS });
    assert.equal(m.status, 'Sold / swapped');
    assert.equal(m.confirmed, true);
    assert.equal(m.soldAsset, 'ETH');
    assert.equal(m.gotAsset, 'USDT');
  });

  test('a bridge moved the position, not the ownership', () => {
    const m = describeMove(t({ to: { address: '0xbr', owner: 'Wormhole Bridge' } }), { byAddress: LABELS });
    assert.equal(m.action, 'Bridged');
    assert.equal(m.confirmed, false);
  });

  test('a plain wallet move asserts nothing', () => {
    const m = describeMove(t(), { byAddress: LABELS });
    assert.equal(m.status, 'Wallet transfer — no sale detected');
    assert.equal(m.confirmed, false);
    assert.equal(m.gotAsset, null);
  });

  test('only a swap is ever confirmed', () => {
    const cases = [
      t({ to: { address: '0xbin' } }),
      t({ to: { address: '0xbr', owner: 'Stargate Bridge' } }),
      t({ kind: 'contract' }),
      t(),
    ];
    for (const c of cases) assert.equal(describeMove(c, { byAddress: LABELS }).confirmed, false);
    assert.equal(describeMove(t({ swap: { from: 'ETH', to: 'USDC' } }), {}).confirmed, true);
  });
});

describe('who gets an exit event', () => {
  const change = (over = {}) => ({
    holder: '0xwhale', name: null, symbol: 'ETH', chain: 'ethereum',
    unitsBefore: 25_000, unitsAfter: 0, unitsDelta: -25_000,
    pct: -100, usdDelta: -82_000_000, at: 1_790_000_000, ...over,
  });

  test('a holder that sold gets an event, with the route', () => {
    const out = exitEvents({
      changes: [change()],
      transfers: [{
        symbol: 'ETH', usd: 82_000_000, blockchain: 'ethereum', hash: '0xabc',
        at: 1_790_000_000, from: { address: '0xwhale' }, to: { address: '0xbin' },
        kind: 'transfer',
      }],
      byAddress: LABELS,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].destination, 'Binance');
    assert.equal(out[0].hash, '0xabc');
    assert.equal(out[0].confirmed, false);
    assert.equal(out[0].unitsMoved, 25_000);
  });

  test('a holder that grew is not an exit', () => {
    // The other way a holder leaves the top twenty-five is somebody else
    // buying more. That holder has done nothing and must not be reported.
    assert.deepEqual(exitEvents({ changes: [change({ usdDelta: 50_000_000, pct: 40 })] }), []);
  });

  test('a trivial reduction is not an event', () => {
    assert.deepEqual(exitEvents({
      changes: [change({ pct: -2, usdDelta: -400_000 })],
    }), []);
    assert.ok(MATERIAL_PCT >= 5);
  });

  test('a fall with no matching transfer is reported without inventing a route', () => {
    const [e] = exitEvents({ changes: [change()], transfers: [] });
    assert.equal(e.status, 'Reduction seen, route unknown');
    assert.equal(e.to, null);
    assert.equal(e.hash, null);
    assert.equal(e.confirmed, false);
  });

  test('the largest outgoing transfer is the one that explains the fall', () => {
    const [e] = exitEvents({
      changes: [change()],
      transfers: [
        { symbol: 'ETH', usd: 1_000_000, hash: '0xsmall', at: 1, from: { address: '0xwhale' }, to: { address: '0xa' }, kind: 'transfer' },
        { symbol: 'ETH', usd: 80_000_000, hash: '0xbig', at: 2, from: { address: '0xwhale' }, to: { address: '0xbin' }, kind: 'transfer' },
      ],
      byAddress: LABELS,
    });
    assert.equal(e.hash, '0xbig');
  });

  test('events are ordered by how much moved', () => {
    const out = exitEvents({
      changes: [
        change({ holder: '0xa', usdDelta: -5_000_000 }),
        change({ holder: '0xb', usdDelta: -90_000_000 }),
      ],
    });
    assert.deepEqual(out.map((e) => e.holder), ['0xb', '0xa']);
  });
});

describe('what a holder is a share of', () => {
  const holder = (over = {}) => ({
    holder: '0xwhale', name: null, isContract: false, units: 1000, ...over,
  });

  test('the denominator is the coins in circulation, not the cap', () => {
    // Chainlink's largest investor holds 19,213,674 of 748 million
    // circulating — 2.57%. Measured against the billion-token cap it read
    // 1.92%, which makes every holder look smaller than they are.
    const [top] = rankHolders([holder({ units: 19_213_674 })],
      { price: 13, supply: 748_099_970 });
    assert.ok(Math.abs(top.pctSupply - 2.57) < 0.01, `got ${top.pctSupply}`);

    const [old] = rankHolders([holder({ units: 19_213_674 })],
      { price: 13, supply: 1_000_000_000 });
    assert.ok(Math.abs(old.pctSupply - 1.92) < 0.01, 'the old, larger denominator');
  });

  test('a burned supply is not counted as if it were still there', () => {
    // Blockscout reports SHIB at 999,982,329,055,168 against a real supply of
    // 589,496,238,721,206 — four hundred trillion burned. Every share came out
    // forty per cent too small.
    const units = 5_894_962_387_212;
    const [real] = rankHolders([holder({ units })], { price: 1, supply: 589_496_238_721_206 });
    const [wrong] = rankHolders([holder({ units })], { price: 1, supply: 999_982_329_055_168 });
    assert.ok(Math.abs(real.pctSupply - 1) < 0.01, `got ${real.pctSupply}`);
    assert.ok(wrong.pctSupply < real.pctSupply * 0.65, 'the burned-supply figure understates it');
  });

  test('an unknown supply is absent, never zero', () => {
    const [none] = rankHolders([holder({ units: 250 })], { price: 2 });
    assert.equal(none.pctSupply, null);
    const [zero] = rankHolders([holder({ units: 250 })], { price: 2, supply: 0 });
    assert.equal(zero.pctSupply, null);
  });

  test('no share can exceed the whole', () => {
    const [all] = rankHolders([holder({ units: 1000 })], { price: 1, supply: 1000 });
    assert.equal(all.pctSupply, 100);
  });
});
