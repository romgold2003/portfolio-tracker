/**
 * Sub-accounts: several journals under one sign-in, and all of them combined.
 *
 * Asked for so one person can keep day trading and long-term investing apart,
 * import each account's files into that account only, and still see the whole
 * portfolio — combined the way a broker consolidates linked accounts.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  state, loadState, clearState, journalSnapshot, subAccounts, switchAccount, addSubAccount,
  renameSubAccount, removeSubAccount, isCombined, combinedJournals, ALL_ACCOUNTS,
} from '../src/core/store.js';
import { combineHistories, periodReturnFromHistory } from '../src/core/portfolioHistory.js';

const trade = (id, ticker, qty, entry) => ({
  id, ticker, qty, entry, cur: entry, status: 'Open', dir: 'Long', cls: 'Stocks', open: '2026-03-02',
});
const longTerm = {
  positions: [trade(1, 'VOO', 3, 500)],
  cash: 1000,
  cashFlows: [{ date: '2026-01-05', amount: 2500, description: 'Deposit' }],
  apiKey: 'key',
};
const dayTrading = {
  positions: [trade(1, 'TSLA', 2, 250)],
  cash: 300,
  cashFlows: [{ date: '2026-02-01', amount: 800, description: 'Deposit' }],
};

describe('sub-accounts', () => {
  beforeEach(() => clearState());

  test('a vault from before sub-accounts is one account, and nothing is stored twice', () => {
    loadState(longTerm);
    const { accounts, activeId } = subAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].name, 'Main account');
    assert.equal(activeId, accounts[0].id);
    const saved = journalSnapshot();
    assert.equal(saved.positions[0].ticker, 'VOO');
    assert.equal(saved.accounts.length, 1);
    assert.equal(saved.accounts[0].journal, undefined, 'the home account lives at the top level only');
  });

  test('a new sub-account starts empty, and an import goes only into the one on screen', () => {
    loadState(longTerm);
    const main = subAccounts().activeId;
    const day = addSubAccount('Day trading');
    assert.equal(subAccounts().activeId, day);
    assert.equal(state.positions.length, 0);
    assert.equal(state.cash, 0);

    loadState(dayTrading); // what an import does
    assert.equal(state.positions[0].ticker, 'TSLA');

    switchAccount(main);
    assert.deepEqual(state.positions.map((p) => p.ticker), ['VOO']);
    assert.equal(state.cash, 1000);
    switchAccount(day);
    assert.deepEqual(state.positions.map((p) => p.ticker), ['TSLA']);
  });

  test('edits made on screen stay with their account through a switch', () => {
    loadState(longTerm);
    const main = subAccounts().activeId;
    const day = addSubAccount('Day trading');
    state.cash = 42;
    switchAccount(main);
    switchAccount(day);
    assert.equal(state.cash, 42);
  });

  test('All accounts adds them up, like a consolidated statement', () => {
    loadState(longTerm);
    addSubAccount('Day trading');
    loadState(dayTrading);
    assert.equal(switchAccount(ALL_ACCOUNTS), true);
    assert.equal(isCombined(), true);
    assert.equal(state.cash, 1300);
    assert.deepEqual(state.positions.map((p) => p.ticker).sort(), ['TSLA', 'VOO']);
    assert.equal(new Set(state.positions.map((p) => p.id)).size, 2, 'ids stay unique across accounts');
    assert.deepEqual(state.cashFlows.map((f) => f.amount), [2500, 800]);
    assert.deepEqual(state.statements, []);
    assert.equal(combinedJournals().length, 2);
  });

  test('All needs two accounts', () => {
    loadState(longTerm);
    assert.equal(switchAccount(ALL_ACCOUNTS), false);
  });

  test('the vault round-trips every account, its name and what was on screen', () => {
    loadState(longTerm);
    addSubAccount('Day trading');
    loadState(dayTrading);
    renameSubAccount(subAccounts().activeId, 'Scalping');
    const saved = JSON.parse(JSON.stringify(journalSnapshot()));

    clearState();
    loadState(saved);
    const { accounts, activeId } = subAccounts();
    assert.deepEqual(accounts.map((a) => a.name), ['Main account', 'Scalping']);
    assert.equal(accounts.find((a) => a.id === activeId).name, 'Scalping');
    assert.deepEqual(state.positions.map((p) => p.ticker), ['TSLA']);
    assert.equal(state.apiKey, 'key');
    switchAccount(accounts[0].id);
    assert.deepEqual(state.positions.map((p) => p.ticker), ['VOO']);
  });

  test('removing an account takes its journal; the last account cannot be removed', () => {
    loadState(longTerm);
    const main = subAccounts().activeId;
    const day = addSubAccount('Day trading');
    loadState(dayTrading);
    assert.equal(removeSubAccount(day), true);
    assert.equal(subAccounts().activeId, main);
    assert.deepEqual(state.positions.map((p) => p.ticker), ['VOO']);
    assert.equal(removeSubAccount(main), false);
  });
});

describe('the combined daily value', () => {
  const day = (date, totalAccountValue, externalCashFlow = 0) => ({ date, totalAccountValue, externalCashFlow });

  test('adds values day by day and keeps an account at its last value', () => {
    const rows = combineHistories([
      [day('2026-01-01', 100), day('2026-01-02', 110)],
      [day('2026-01-01', 50), day('2026-01-02', 55), day('2026-01-03', 60)],
    ]);
    assert.deepEqual(rows.map((r) => r.totalAccountValue), [150, 165, 170]);
  });

  test('an account joining with money in it is a transfer in, not profit', () => {
    const rows = combineHistories([
      [day('2026-01-01', 100), day('2026-01-02', 110), day('2026-01-03', 121)],
      [day('2026-01-02', 1000), day('2026-01-03', 1100)],
    ]);
    assert.equal(rows[1].externalCashFlow, 1000);
    // Both grew 10% on the 3rd; the 2nd was 10% for the first and a transfer for the second.
    const measured = periodReturnFromHistory(rows, null, '2026-01-03');
    assert.ok(Math.abs(measured.returnPct - 21) < 1e-9, `got ${measured.returnPct}`);
    assert.ok(Math.abs(measured.pnl - 121) < 1e-9, `got ${measured.pnl}`);
  });

  test('deposits in each account stay deposits in the sum', () => {
    const rows = combineHistories([
      [day('2026-01-01', 100), day('2026-01-02', 300, 200)],
      [day('2026-01-01', 100), day('2026-01-02', 150, 50)],
    ]);
    assert.equal(rows[1].externalCashFlow, 250);
    assert.equal(periodReturnFromHistory(rows, null, '2026-01-02').returnPct, 0);
  });
});

describe('favourite designs', () => {
  test('are kept with the account, whichever sub-account is on screen, and survive the vault', async () => {
    const { setFavoriteDesigns } = await import('../src/core/store.js');
    clearState();
    loadState(longTerm);
    setFavoriteDesigns([{ name: 'Navy', code: 'RB-AQABCAAbEDD_Zsw' }, null, { name: 'x', code: 'not a code!' }]);
    addSubAccount('Day trading');
    loadState(dayTrading); // an import does not touch them
    const saved = JSON.parse(JSON.stringify(journalSnapshot()));
    clearState();
    assert.deepEqual(state.favoriteDesigns, []);
    loadState(saved);
    assert.equal(state.favoriteDesigns.length, 5);
    assert.deepEqual(state.favoriteDesigns[0], { name: 'Navy', code: 'RB-AQABCAAbEDD_Zsw' });
    assert.equal(state.favoriteDesigns[2], null, 'a broken code is not kept');
  });
});
