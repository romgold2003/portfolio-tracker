/**
 * The Friends page from the browser's side (October 2026): what leaves a book
 * under each choice in Profile → Investment details, and how a friend's
 * holdings, a chat and the group windows read. The server's rules are
 * tests/social.test.mjs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { shareSummary } from '../src/core/shareSummary.js';
import { accountTotals } from '../src/core/portfolio.js';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };

const pos = (over) => ({ status: 'Open', dir: 'Long', cls: 'Stocks', qty: 10, cur: 100, entry: 90, ...over });
const book = {
  positions: [
    pos({ ticker: 'NVDA', qty: 20, cur: 200, entry: 140 }), // 4,000; 2,800 in
    pos({ ticker: 'AMD', qty: 10, cur: 100, entry: 90 }), // 1,000; 900 in
    pos({ ticker: 'USO', dir: 'Short', qty: 5, cur: 100, entry: 110 }), // −500
  ],
  cash: 500,
};

describe('what friends are sent', () => {
  test('Percentages: each holding as a share of the account, and nothing in dollars', () => {
    const s = shareSummary(book, 'percent');
    assert.equal(accountTotals(book.positions, book.cash).account, 5000);
    assert.deepEqual(s.holdings, [
      { t: 'NVDA', w: 80, d: 'Long', c: 'Stocks' },
      { t: 'AMD', w: 20, d: 'Long', c: 'Stocks' },
      { t: 'USO', w: -10, d: 'Short', c: 'Stocks' },
    ]);
    assert.equal(s.cash, 10);
    assert.equal(s.mode, 'percent');
    const total = s.holdings.reduce((sum, h) => sum + h.w, 0) + s.cash;
    assert.ok(Math.abs(total - 100) < 1e-9, 'adds up to the account');
    assert.doesNotMatch(JSON.stringify(s), /4000|2800|qty|entry|cur|"v"|inv|total/);
  });

  test('Amounts: the same, with what each is worth and what went in, the cash and the total', () => {
    const s = shareSummary(book, 'amount');
    assert.equal(s.mode, 'amount');
    assert.deepEqual(s.holdings[0], { t: 'NVDA', w: 80, d: 'Long', c: 'Stocks', v: 4000, inv: 2800 });
    assert.deepEqual([s.cashV, s.total], [500, 5000]);
  });

  test('one line per holding across sub-accounts; closed positions left out', () => {
    const s = shareSummary({
      positions: [pos({ ticker: 'NVDA', qty: 5 }), pos({ ticker: 'NVDA', qty: 5 }), pos({ ticker: 'AMD', status: 'Closed' })],
      cash: 0,
    });
    assert.deepEqual(s.holdings, [{ t: 'NVDA', w: 100, d: 'Long', c: 'Stocks' }]);
  });

  test('an empty book sends nothing', () => {
    assert.deepEqual(shareSummary({ positions: [], cash: 0 }), { mode: 'percent', holdings: [], cash: 0 });
  });
});

describe('the page', () => {
  test("a friend's holdings in percent: bars of their share, cash last, when updated", async () => {
    const { holdingsHtml } = await import('../src/ui/views/friends.js');
    const html = holdingsHtml({ shared: true, mode: 'percent', at: new Date().toISOString(), holdings: [{ t: 'NVDA', w: 62.5, d: 'Long' }, { t: 'USO', w: -2.8, d: 'Short' }], cash: 12 });
    const rows = [...html.matchAll(/class="fr-tk">([A-Za-z]+)[\s\S]*?class="fr-w">([^<]+)</g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(rows, [['NVDA', '62.5%'], ['USO', '−2.8%'], ['Cash', '12.0%']]);
    assert.match(html, /mini-dir d-short">Short/);
    assert.match(html, /Updated just now · percentages only, no amounts/);
    assert.doesNotMatch(html, /\$/);
  });

  test('…in amounts: dollars beside each, what went in, and the account', async () => {
    const { holdingsHtml } = await import('../src/ui/views/friends.js');
    const html = holdingsHtml({ shared: true, ...shareSummary(book, 'amount'), at: new Date().toISOString() });
    assert.match(html, /NVDA<span class="fr-inv">invested \$2,800<\/span>[\s\S]*class="fr-v">\$4,000<\/span>\s*<span class="fr-w">80\.0%/);
    assert.match(html, /class="fr-total"><span>Account<\/span><b>\$5,000<\/b>/);
  });

  test('…and None: private, nothing more', async () => {
    const { holdingsHtml } = await import('../src/ui/views/friends.js');
    assert.match(holdingsHtml({ shared: false }, 'dan'), /dan keeps their investments private/);
  });

  test('the three choices in Investment details', async () => {
    const { SHOW_CHOICES } = await import('../src/ui/views/friends.js');
    assert.deepEqual(SHOW_CHOICES.map((c) => [c.mode, c.title]), [['amount', 'Amounts'], ['percent', 'Percentages'], ['none', 'None']]);
  });

  test('a chat: theirs on the left named (in a group), yours on the right, text escaped', async () => {
    const { messagesHtml } = await import('../src/ui/views/friends.js');
    const list = [
      { id: 'a', email: 'dan@example.com', body: 'In at <b>180</b>', at: new Date().toISOString(), mine: false },
      { id: 'b', email: 'romy@example.com', body: 'Nice', at: new Date().toISOString(), mine: true },
    ];
    const html = messagesHtml(list);
    assert.match(html, /<div class="fr-msg">\s*<div class="fr-msg-who">dan<\/div>\s*<div class="fr-msg-body">In at &lt;b&gt;180&lt;\/b&gt;/);
    assert.match(html, /<div class="fr-msg mine">\s*<div class="fr-msg-body">Nice/);
    assert.doesNotMatch(messagesHtml(list, false), /fr-msg-who/, 'one-to-one: no names needed');
    assert.match(messagesHtml([]), /No messages yet/);
  });

  test('picking friends for a group: checkboxes, ticked as chosen', async () => {
    const { friendPickerHtml } = await import('../src/ui/views/friends.js');
    const html = friendPickerHtml([{ id: 'u1', email: 'dan@example.com' }, { id: 'u2', email: 'eve@example.com' }], ['u2']);
    assert.match(html, /value="u1">[\s\S]*dan/);
    assert.match(html, /value="u2" checked>[\s\S]*eve/);
    assert.match(friendPickerHtml([]), /Add a friend first/);
  });

  test('in the menu after Crypto, with its person icon; profile on top, windows over the page', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /show\('crypto'\)[^\n]*\n\s*<button class="nl" onclick="show\('friends'\)"><span class="nl-icon">👤<\/span> Friends<\/button>/);
    assert.match(html, /<div id="friends" class="page">[\s\S]*id="frProfile"[\s\S]*id="frAdd"[\s\S]*id="frList"[\s\S]*id="frDetail"[\s\S]*id="frChats"[\s\S]*id="frModal"/);
    assert.match(readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8'), /if \(page === 'friends'\) renderFriends\(\);/);
    const view = readFileSync(new URL('../src/ui/views/friends.js', import.meta.url), 'utf8');
    // Create group: the name first, then "Add friends" opens the second window.
    assert.match(view, /data-modal="groupName">\+ Create group/);
    assert.match(view, /data-group-next>Add friends ›/);
    assert.match(view, /data-dm="\$\{escapeHtml\(f\.id\)\}"[^>]*>💬/);
  });
});
