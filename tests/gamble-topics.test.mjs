/**
 * Which Polymarket markets count as macro.
 *
 * Checked against the live feed after a report that no bets had shown for a
 * while. The feed was working; the big macro bets had simply stopped, with the
 * money on sport. One real miss turned up on the way: country names only matched
 * as whole words, so "Will the Iranian regime fall before 2027?" — a $254,105
 * bet — was dropped as not macro.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { topicOf, selectTrades } from '../src/services/gamble.js';

describe('geopolitics', () => {
  test('the words made from a country count as the country', () => {
    for (const title of [
      'Will the Iranian regime fall before 2027?',
      'Israeli strike on Lebanon by October?',
      'Russian troops enter Kharkiv in 2026?',
      'Ukrainian counteroffensive by year end?',
      'Chinese blockade of Taiwan in 2026?',
      'Taiwanese election result?',
      'Venezuelan president out by 2027?',
      'North Korean missile test in September?',
    ]) {
      assert.equal(topicOf(title)?.id, 'geo', title);
    }
  });

  test('the countries themselves still count', () => {
    assert.equal(topicOf('Will the U.S. invade Iran before 2027?')?.id, 'geo');
    assert.equal(topicOf('Russia x Ukraine ceasefire in 2026?')?.id, 'geo');
  });

  test('sport that happens to share letters does not', () => {
    for (const title of ['Golden State Warriors vs. Lakers', 'Will Chelsea FC win on 2026-08-30?', 'Dota 2: Team Spirit vs Team Liquid (BO3)']) {
      assert.equal(topicOf(title), null, title);
    }
  });
});

test('the Iranian regime bet from the live feed now reaches the $250k–500k band', () => {
  const trade = {
    title: 'Will the Iranian regime fall before 2027?',
    proxyWallet: '0x1234567890abcdef1234567890abcdef12345678',
    size: 500_000,
    price: 0.50821,
    side: 'BUY',
    outcome: 'No',
    timestamp: 1_788_000_000,
  };
  const [row] = selectTrades([trade], { band: 'mid' });
  assert.equal(row?.topic, 'geo');
  assert.equal(row?.usd, 254_105);
});
