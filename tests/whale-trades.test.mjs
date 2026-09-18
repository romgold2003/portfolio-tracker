/**
 * The new whale panel: spot and leveraged buys and sells of the top-fifty coins.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterRows, summarise, countByBand, groupFills, hyperliquidMarkets, walletLink,
} from '../src/services/whaleTrades.js';
import { tradesOf, withoutBots, tokensFor } from '../api/_lib/dexspot.js';

const row = (symbol, side, usd, at = 1000, extra = {}) => ({
  id: `${symbol}${side}${usd}${at}${extra.address ?? ""}`, symbol, side, usd, at, ...extra,
});

describe('filters', () => {
  const rows = [
    row('BTC', 'buy', 600_000), row('BTC', 'sell', 3_000_000), row('ETH', 'withdraw', 30_000_000),
    row('ETH', 'deposit', 7_000_000), row('SOL', 'buy', 400_000),
  ];

  test('bands are half-open and start at $500k', () => {
    assert.equal(filterRows(rows, { band: 'b1' }).length, 1);
    assert.equal(filterRows(rows, { band: 'b2' }).length, 1);
    assert.equal(filterRows(rows, { band: 'b3' }).length, 1);
    assert.equal(filterRows(rows, { band: 'b4' }).length, 1);
    assert.equal(filterRows(rows, { band: 'all' }).length, 4, 'under $500k is never shown');
  });

  test('a withdrawal counts with buying and a deposit with selling', () => {
    assert.deepEqual(filterRows(rows, { side: 'buy' }).map((r) => r.side).sort(), ['buy', 'withdraw']);
    assert.deepEqual(filterRows(rows, { side: 'sell' }).map((r) => r.side).sort(), ['deposit', 'sell']);
    const s = summarise(filterRows(rows));
    assert.equal(s.buyUsd, 30_600_000);
    assert.equal(s.sellUsd, 10_000_000);
    assert.equal(s.net, 20_600_000);
  });

  test('one coin, and the counts each band button shows', () => {
    assert.deepEqual(filterRows(rows, { coin: 'ETH' }).map((r) => r.symbol), ['ETH', 'ETH']);
    assert.equal(countByBand(rows, { coin: 'BTC' }).get('all'), 2);
  });
});

describe('Hyperliquid orders', () => {
  test('fills of one order become one row, with the taker as the whale', () => {
    const fills = [
      { coin: 'BTC', side: 'B', px: '80000', sz: '5', time: 1_700_000_000_000, hash: '0xabc', users: ['0xwhale', '0xm1'] },
      { coin: 'BTC', side: 'B', px: '80010', sz: '10', time: 1_700_000_000_000, hash: '0xabc', users: ['0xwhale', '0xm2'] },
      { coin: 'ETH', side: 'A', px: '2500', sz: '400', time: 1_700_000_001_000, hash: '0xdef', users: ['0xm3', '0xseller'] },
    ];
    const orders = groupFills(fills);
    assert.equal(orders.length, 2);
    const btc = orders.find((o) => o.symbol === 'BTC');
    assert.deepEqual([btc.side, btc.amount, btc.address], ['buy', 15, '0xwhale']);
    assert.equal(btc.usd, 80000 * 5 + 80010 * 10);
    const eth = orders.find((o) => o.symbol === 'ETH');
    assert.deepEqual([eth.side, eth.address], ['sell', '0xseller']);
  });

  test('per-thousand markets are scaled back to coins', () => {
    const markets = hyperliquidMarkets(['BTC', 'PEPE', 'TON'], [{ name: 'BTC' }, { name: 'kPEPE' }]);
    assert.deepEqual(markets.get('PEPE'), { market: 'kPEPE', scale: 1000 });
    assert.equal(markets.has('TON'), false);
    const [o] = groupFills(
      [{ coin: 'kPEPE', side: 'B', px: '0.01', sz: '100000000', time: 1, hash: '0x1', users: ['0xa', '0xb'] }],
      { scaleOf: () => 1000, symbolOf: () => 'PEPE' },
    );
    assert.deepEqual([o.symbol, o.amount, o.usd], ['PEPE', 100_000_000_000, 1_000_000]);
  });

  test('wallets link to the right explorer', () => {
    assert.match(walletLink({ source: 'hyperliquid', address: '0xa' }), /hypurrscan/);
    assert.match(walletLink({ source: 'dex', network: 'solana', address: 'abc' }), /solscan/);
    assert.equal(walletLink({ source: 'cex', network: 'unknownchain', address: 'x' }), null);
  });
});

describe('spot trades on decentralised exchanges', () => {
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const trade = (from, to, fromAmt, toAmt, usd, who, when, hash) => ({
    attributes: {
      from_token_address: from, to_token_address: to, from_token_amount: fromAmt, to_token_amount: toAmt,
      volume_in_usd: String(usd), tx_from_address: who, block_timestamp: when, tx_hash: hash,
    },
  });

  test('the coin coming in is a buy, going out a sell, whatever the pool calls it', () => {
    const json = {
      data: [
        trade(USDT, WETH, '1098152', '421.21', 1_098_152, '0xa', '2026-09-18T18:32:59Z', '0x1'),
        trade(WETH, USDT, '305', '787971', 787_971, '0xb', '2026-09-18T15:33:23Z', '0x2'),
        trade(USDT, WETH, '300000', '100', 300_000, '0xc', '2026-09-18T15:00:00Z', '0x3'),
      ],
    };
    const rows = tradesOf(json, { symbol: 'ETH', token: WETH, network: 'eth', dex: 'uniswap_v3' });
    assert.deepEqual(rows.map((r) => [r.side, r.amount]), [['buy', 421.21], ['sell', 305]]);
  });

  test('a wallet in and out of the same coin within ten minutes is a bot, both legs', () => {
    const rows = [
      row('ETH', 'buy', 1e6, 1000, { address: '0xBot' }), row('ETH', 'sell', 1e6, 1300, { address: '0xbot' }),
      row('ETH', 'buy', 1e6, 1000, { address: '0xholder' }), row('ETH', 'sell', 1e6, 9000, { address: '0xholder' }),
    ];
    assert.deepEqual(withoutBots(rows).map((r) => r.address), ['0xholder', '0xholder']);
  });

  test('bitcoin is found through its wrapped tokens, other coins through their contracts', () => {
    assert.ok(tokensFor({ symbol: 'BTC' }, {}).some(([n]) => n === 'eth'));
    assert.deepEqual(tokensFor({ symbol: 'LINK' }, { ethereum: '0x514910771af9ca656af840dff83e8264ecf986ca', 'some-chain': '0x1' }),
      [['eth', '0x514910771af9ca656af840dff83e8264ecf986ca']]);
  });
});
