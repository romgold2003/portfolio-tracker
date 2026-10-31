/**
 * The Friends page from the browser's side (October 2026): what leaves a book
 * when sharing is on, and how a friend's holdings and a chat read.
 * The server's rules are tests/social.test.mjs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { shareSummary } from '../src/core/shareSummary.js';
import { accountTotals } from '../src/core/portfolio.js';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };

const pos = (over) => ({ status: 'Open', dir: 'Long', cls: 'Stocks', qty: 10, cur: 100, entry: 90, ...over });

describe('what friends are sent', () => {
  test('each holding as a share of the account, in percent, and nothing in dollars', () => {
    const positions = [
      pos({ ticker: 'NVDA', qty: 20, cur: 200 }), // 4,000
      pos({ ticker: 'AMD', qty: 10, cur: 100 }), // 1,000
      pos({ ticker: 'USO', dir: 'Short', qty: 5, cur: 100 }), // −500
    ];
    const cash = 500;
    const s = shareSummary({ positions, cash });
    assert.equal(accountTotals(positions, cash).account, 5000);
    assert.deepEqual(s.holdings, [
      { t: 'NVDA', w: 80, d: 'Long', c: 'Stocks' },
      { t: 'AMD', w: 20, d: 'Long', c: 'Stocks' },
      { t: 'USO', w: -10, d: 'Short', c: 'Stocks' },
    ]);
    assert.equal(s.cash, 10);
    const total = s.holdings.reduce((sum, h) => sum + h.w, 0) + s.cash;
    assert.ok(Math.abs(total - 100) < 1e-9, 'adds up to the account');
    assert.doesNotMatch(JSON.stringify(s), /4000|1000|qty|entry|cur|value/);
  });

  test('one line per holding across sub-accounts; closed positions left out', () => {
    const s = shareSummary({
      positions: [pos({ ticker: 'NVDA', qty: 5 }), pos({ ticker: 'NVDA', qty: 5 }), pos({ ticker: 'AMD', status: 'Closed' })],
      cash: 0,
    });
    assert.deepEqual(s.holdings, [{ t: 'NVDA', w: 100, d: 'Long', c: 'Stocks' }]);
  });

  test('an empty book sends nothing', () => {
    assert.deepEqual(shareSummary({ positions: [], cash: 0 }), { holdings: [], cash: 0 });
  });
});

describe('the page', () => {
  test("a friend's holdings: bars of their share, cash last, and when it was updated", async () => {
    const { holdingsHtml } = await import('../src/ui/views/friends.js');
    const html = holdingsHtml({ shared: true, at: new Date().toISOString(), holdings: [{ t: 'NVDA', w: 62.5, d: 'Long' }, { t: 'USO', w: -2.8, d: 'Short' }], cash: 12 });
    const rows = [...html.matchAll(/class="fr-tk">([A-Za-z]+)[\s\S]*?class="fr-w">([^<]+)</g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(rows, [['NVDA', '62.5%'], ['USO', '−2.8%'], ['Cash', '12.0%']]);
    assert.match(html, /mini-dir d-short">Short/);
    assert.match(html, /Updated just now · percentages only, no amounts/);
    assert.match(holdingsHtml({ shared: false }), /Not shared yet/);
  });

  test('a chat: theirs on the left with a name, yours on the right, text escaped', async () => {
    const { messagesHtml } = await import('../src/ui/views/friends.js');
    const html = messagesHtml([
      { id: 'a', email: 'dan@example.com', body: 'In at <b>180</b>', at: new Date().toISOString(), mine: false },
      { id: 'b', email: 'romy@example.com', body: 'Nice', at: new Date().toISOString(), mine: true },
    ]);
    assert.match(html, /<div class="fr-msg">\s*<div class="fr-msg-who">dan<\/div>\s*<div class="fr-msg-body">In at &lt;b&gt;180&lt;\/b&gt;/);
    assert.match(html, /<div class="fr-msg mine">\s*<div class="fr-msg-body">Nice/);
    assert.match(messagesHtml([]), /No messages yet/);
  });

  test('in the menu after Crypto, with its person icon, and drawn when opened', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /show\('crypto'\)[^\n]*\n\s*<button class="nl" onclick="show\('friends'\)"><span class="nl-icon">👤<\/span> Friends<\/button>/);
    assert.match(html, /<div id="friends" class="page">[\s\S]*id="frAdd"[\s\S]*id="frList"[\s\S]*id="frShareCard"[\s\S]*id="frDetail"[\s\S]*id="frChats"/);
    assert.match(readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8'), /if \(page === 'friends'\) renderFriends\(\);/);
  });
});
