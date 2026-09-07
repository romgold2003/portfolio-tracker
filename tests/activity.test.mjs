/**
 * The Live Whale Activity classifier.
 *
 * One rule the whole file turns on: **a deposit to an exchange is not a sale.**
 * The chain shows the coins arriving and says nothing about what happened
 * inside, so calling it "Sell / Swap" would be the most confident wrong thing
 * this app could say. Only a swap — both legs in one transaction — earns a buy
 * or a sell, and the tests below check the boundary from both sides.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyActivity, endLabel, ACTIONS, ACTION_TONE, isStable,
} from '../api/_lib/activity.js';

const LABELS = new Map([
  ['0xbin', { venue: 'Binance', name: 'Binance 14' }],
  ['0xcb', { venue: 'Coinbase', name: 'Coinbase 1' }],
  ['0xbin2', { venue: 'Binance', name: 'Binance 7' }],
]);

const t = (over = {}) => ({
  symbol: 'ETH', usd: 82_000_000, blockchain: 'ethereum', hash: '0xh', at: 1_790_000_000,
  kind: 'transfer', from: { address: '0xa' }, to: { address: '0xb' }, ...over,
});

const of = (over, opts = {}) => classifyActivity(t(over), { byAddress: LABELS, ...opts });

describe('naming the two ends', () => {
  test('the label set wins, and gives the venue rather than the wallet number', () => {
    assert.equal(endLabel({ address: '0xbin' }, LABELS), 'Binance');
  });

  test('an indexer name is used when there is no label', () => {
    assert.equal(endLabel({ address: '0xz', owner: 'Uniswap V3: Router' }, LABELS),
      'Uniswap V3: Router');
  });

  test('an unattributed address is a wallet, never a guess', () => {
    assert.equal(endLabel({ address: '0xz' }, LABELS), 'Wallet');
  });

  test('the null address is not a party', () => {
    assert.equal(endLabel({ address: '0x0000000000000000000000000000000000000000' }, LABELS),
      'Null address');
  });

  test('the path reads the way the column is headed', () => {
    assert.equal(of({ to: { address: '0xbin' } }).path, 'Wallet → Binance');
    assert.equal(of({ from: { address: '0xcb' } }).path, 'Coinbase → Wallet');
    assert.equal(of({}).path, 'Wallet → Wallet');
    assert.equal(of({ to: { address: '0xu', owner: 'Uniswap' } }).path, 'Wallet → Uniswap');
  });
});

describe('the asset flow column', () => {
  test('a plain transfer shows the same asset both sides', () => {
    assert.equal(of({}).assetFlow, 'ETH → ETH');
    assert.equal(of({ symbol: 'BTC', blockchain: 'bitcoin' }).assetFlow, 'BTC → BTC');
  });

  test('a swap names what was given up and what came back', () => {
    assert.equal(of({ swap: { from: 'USDT', to: 'BTC' } }).assetFlow, 'USDT → BTC');
  });

  test('both legs of one swap read identically, because they are one trade', () => {
    const swap = { from: 'USDT', to: 'BTC' };
    assert.equal(of({ symbol: 'USDT', swap }).assetFlow, of({ symbol: 'BTC', swap }).assetFlow);
  });
});

describe('what is a buy and what is only a deposit', () => {
  test('an exchange deposit is never a sale, and says so', () => {
    const a = of({ to: { address: '0xbin' } });
    assert.equal(a.action, ACTIONS.DEPOSIT);
    assert.equal(a.confirmed, false);
    assert.match(a.note, /sale not confirmed/i);
    // The word must not appear anywhere the reader will look.
    assert.ok(!/sell|sold/i.test(a.action), `the action said "${a.action}"`);
  });

  test('an exchange withdrawal is not a purchase either', () => {
    const a = of({ from: { address: '0xcb' } });
    assert.equal(a.action, ACTIONS.WITHDRAWAL);
    assert.equal(a.confirmed, false);
    assert.match(a.note, /not confirmed/i);
  });

  test('a swap out of a stablecoin is a confirmed buy', () => {
    const a = of({ symbol: 'BTC', swap: { from: 'USDT', to: 'BTC' } });
    assert.equal(a.action, ACTIONS.BUY);
    assert.equal(a.confirmed, true);
  });

  test('a swap into a stablecoin is a confirmed sell', () => {
    const a = of({ symbol: 'ETH', swap: { from: 'ETH', to: 'USDT' } });
    assert.equal(a.action, ACTIONS.SELL);
    assert.equal(a.confirmed, true);
  });

  test('the coin picker decides the side on a swap between two non-stables', () => {
    const swap = { from: 'ETH', to: 'WBTC' };
    assert.equal(of({ swap }, { subject: 'WBTC' }).action, ACTIONS.BUY);
    assert.equal(of({ swap }, { subject: 'ETH' }).action, ACTIONS.SELL);
  });

  test('with no coin selected and no stablecoin, the row names its own side', () => {
    const swap = { from: 'ETH', to: 'WBTC' };
    assert.equal(of({ symbol: 'WBTC', swap }).action, ACTIONS.BUY);
    assert.equal(of({ symbol: 'ETH', swap }).action, ACTIONS.SELL);
  });

  test('only a swap is ever confirmed', () => {
    const cases = [
      {}, { to: { address: '0xbin' } }, { from: { address: '0xbin' } },
      { to: { address: '0xw', owner: 'Wormhole Bridge' } },
      { to: { address: '0xc', ownerType: 'contract', owner: 'Some Vault' } },
      { kind: 'mint', from: { address: null } },
    ];
    for (const c of cases) assert.equal(of(c).confirmed, false, JSON.stringify(c));
    assert.equal(of({ swap: { from: 'USDT', to: 'ETH' } }).confirmed, true);
  });
});

describe('the movements that are not trades at all', () => {
  test('a wallet paying itself changed no hands', () => {
    const a = of({ from: { address: '0xa' }, to: { address: '0xA' } });
    assert.equal(a.action, ACTIONS.INTERNAL, 'the comparison must not care about case');
  });

  test('one venue tidying its own wallets is housekeeping', () => {
    const a = of({ from: { address: '0xbin' }, to: { address: '0xbin2' } });
    assert.equal(a.action, ACTIONS.INTERNAL);
    assert.match(a.note, /own float/i);
  });

  test('venue to venue is still custodial, and not a deposit', () => {
    const a = of({ from: { address: '0xbin' }, to: { address: '0xcb' } });
    assert.equal(a.action, ACTIONS.INTERNAL);
    assert.match(a.note, /still custodial/i);
  });

  test('a bridge moved the position, not the ownership', () => {
    const a = of({ to: { address: '0xw', owner: 'Stargate Bridge' } });
    assert.equal(a.action, ACTIONS.BRIDGE);
    assert.match(a.note, /chain, not hands/i);
  });

  test('a bridge beats a deposit, whichever end it is on', () => {
    assert.equal(of({ from: { address: '0xw', owner: 'Wormhole' } }).action, ACTIONS.BRIDGE);
  });

  test('a contract with no return leg is Unknown, not a buy', () => {
    const a = of({ to: { address: '0xc', ownerType: 'contract', owner: 'Aave: Pool' } });
    assert.equal(a.action, ACTIONS.UNKNOWN);
    assert.match(a.note, /no matching return leg/i);
  });

  test('a mint is new supply and a burn is destruction — neither is a direction', () => {
    assert.equal(of({ kind: 'mint' }).action, ACTIONS.UNKNOWN);
    assert.equal(of({ kind: 'burn' }).action, ACTIONS.UNKNOWN);
  });

  test('two unattributed addresses is a wallet transfer and asserts nothing', () => {
    const a = of({});
    assert.equal(a.action, ACTIONS.TRANSFER);
    assert.match(a.note, /nothing observable/i);
  });
});

describe('the shape the table depends on', () => {
  test('every action is one of the eight the spec names', () => {
    const allowed = new Set(Object.values(ACTIONS));
    assert.equal(allowed.size, 8);
    const cases = [
      {}, { to: { address: '0xbin' } }, { from: { address: '0xbin' } },
      { from: { address: '0xbin' }, to: { address: '0xcb' } },
      { to: { address: '0xw', owner: 'Hop Protocol' } },
      { swap: { from: 'USDT', to: 'ETH' } }, { swap: { from: 'ETH', to: 'USDC' } },
      { kind: 'mint' }, { to: { address: '0xc', ownerType: 'contract' } },
    ];
    for (const c of cases) assert.ok(allowed.has(of(c).action), of(c).action);
  });

  test('every action has a tone, even when the tone is none', () => {
    for (const a of Object.values(ACTIONS)) {
      assert.equal(typeof ACTION_TONE[a], 'string', `${a} has no tone`);
    }
    // Only a confirmed direction is coloured.
    assert.equal(ACTION_TONE[ACTIONS.TRANSFER], '');
    assert.equal(ACTION_TONE[ACTIONS.INTERNAL], '');
  });

  test('every row carries all five fields the table renders', () => {
    for (const c of [{}, { swap: { from: 'USDT', to: 'ETH' } }, { to: { address: '0xbin' } }]) {
      const a = of(c);
      for (const k of ['path', 'assetFlow', 'action', 'note', 'confirmed']) {
        assert.notEqual(a[k], undefined, `${k} missing`);
      }
    }
  });

  test('a missing label set degrades to wallets rather than throwing', () => {
    const a = classifyActivity(t({ to: { address: '0xbin' } }), {});
    assert.equal(a.path, 'Wallet → Wallet');
    assert.equal(a.action, ACTIONS.TRANSFER);
  });

  test('the stablecoin list covers the ones that actually trade', () => {
    for (const s of ['USDT', 'usdc', 'DAI', 'FDUSD']) assert.ok(isStable(s), s);
    assert.ok(!isStable('ETH'));
  });
});

describe('the null address, read from the address rather than the kind field', () => {
  // Real rows arrived as "Null address → CrossChainTeller" with no kind set,
  // and were being classified on the receiving contract — describing the
  // second half of a mint as though somebody had moved money.
  test('a transfer out of the null address is new supply, whatever the kind says', () => {
    const a = classifyActivity(
      { symbol: 'USYC', kind: 'transfer', from: { address: '0x0000000000000000000000000000000000000000' }, to: { address: '0xc', ownerType: 'contract', owner: 'CrossChainTeller' } },
      { byAddress: LABELS },
    );
    assert.equal(a.action, ACTIONS.UNKNOWN);
    assert.match(a.note, /new supply/i);
    assert.equal(a.path, 'Null address → CrossChainTeller');
  });

  test('a transfer into the null address is destruction, not a sale', () => {
    const a = classifyActivity(
      { symbol: 'ETH', kind: 'transfer', from: { address: '0xw' }, to: { address: '0x000000000000000000000000000000000000dEaD' } },
      { byAddress: LABELS },
    );
    assert.equal(a.action, ACTIONS.UNKNOWN);
    assert.match(a.note, /destroyed/i);
  });

  test('a confirmed swap still outranks it — both legs are still on-chain', () => {
    const a = classifyActivity(
      { symbol: 'ETH', from: { address: '0x0000000000000000000000000000000000000000' }, to: { address: '0xp' }, swap: { from: 'USDT', to: 'ETH' } },
      {},
    );
    assert.equal(a.action, ACTIONS.BUY);
  });
});
