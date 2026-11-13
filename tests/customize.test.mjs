/**
 * Customize (November 2026): each person chooses what Riskbook shows, the way
 * Binance lets its users choose their home screen. Switched off means gone —
 * out of the menu or off the page with no grey space, and its data no longer
 * fetched — until switched back on. Kept with the sign-in.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LAYOUT_GROUPS, LAYOUT_IDS, PRESETS, cleanLayout, presetOf, shownIn } from '../src/core/layout.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };

describe('what can be switched off', () => {
  test('pages, the dials, and the panels of Home, News and Crypto — never Home, Positions or New trade', () => {
    assert.deepEqual(LAYOUT_GROUPS.map((g) => g.title), ['Pages', 'Every page', 'Home', 'News', 'Crypto']);
    assert.deepEqual(LAYOUT_GROUPS[0].items.map((i) => i.label), ['Monthly', 'Insights', 'News', 'Crypto', 'Friends']);
    for (const essential of ['page.home', 'page.positions', 'page.add']) assert.ok(!LAYOUT_IDS.includes(essential), essential);
    for (const id of ['gauges', 'news.options', 'news.gamble', 'news.earnings', 'crypto.whales', 'home.allocation']) assert.ok(LAYOUT_IDS.includes(id), id);
    // Every switch says, in plain words, what it is.
    for (const g of LAYOUT_GROUPS) for (const i of g.items) assert.ok(i.label && i.hint, i.id);
  });

  test('a panel goes with its page: News off takes its panels with it', () => {
    assert.equal(shownIn(['page.news'], 'news.options'), false);
    assert.equal(shownIn([], 'news.options'), true);
    assert.equal(shownIn(['news.options'], 'news.fed'), true);
    assert.equal(shownIn(['page.news'], 'home.graph'), true);
  });

  test('stored as what is hidden: known ids only, each once, in a fixed order', () => {
    assert.deepEqual(cleanLayout(['gauges', 'nonsense', 'page.news', 'gauges', 42]), ['page.news', 'gauges']);
    assert.deepEqual(cleanLayout(null), []);
  });
});

describe('ready-made layouts', () => {
  test('Everything, Simple and Crypto focus, each recognised when it is what is set', () => {
    assert.deepEqual(PRESETS.map((p) => p.title), ['Everything', 'Simple', 'Crypto focus']);
    for (const p of PRESETS) assert.equal(presetOf(p.hidden), p.key);
    assert.equal(presetOf(['gauges']), null, 'a hand-made layout is none of them');
  });

  test('Simple keeps the portfolio and journal; Crypto focus keeps crypto and drops the stock panels', () => {
    const simple = PRESETS.find((p) => p.key === 'simple').hidden;
    for (const page of ['page.news', 'page.crypto', 'page.friends']) assert.ok(simple.includes(page), page);
    assert.ok(!simple.includes('page.monthly'));
    const crypto = PRESETS.find((p) => p.key === 'crypto').hidden;
    assert.ok(crypto.includes('page.news') && !crypto.includes('page.crypto'));
  });
});

describe('kept with the sign-in', () => {
  test('saved, reloaded, and read by every page', async () => {
    const { state, loadState, journalSnapshot, setLayoutHidden, isShown, onLayoutChange } = await import('../src/core/store.js');
    loadState({ positions: [], cash: 0 });
    let told = 0;
    const stop = onLayoutChange(() => { told += 1; });
    setLayoutHidden(['page.crypto', 'gauges', 'made up']);
    stop();
    assert.equal(told, 1, 'the screen is told at once');
    assert.deepEqual(state.layoutHidden, ['page.crypto', 'gauges']);
    loadState(JSON.parse(JSON.stringify(journalSnapshot())));
    assert.deepEqual(state.layoutHidden, ['page.crypto', 'gauges']);
    assert.equal(isShown('crypto.whales'), false);
    assert.equal(isShown('news.fed'), true);
    setLayoutHidden([]);
  });
});

describe('the Customize window', () => {
  test('a switch per item, on or off; the matching ready-made layout marked', async () => {
    const { customizeHtml } = await import('../src/ui/views/customize.js');
    const html = customizeHtml(['gauges']);
    assert.match(html, /<h3>Customize Riskbook<\/h3>/);
    assert.match(html, /data-item="gauges" aria-label/, 'switched off: unticked');
    assert.match(html, /data-item="page.news" checked/);
    assert.doesNotMatch(html, /cz-preset on/, 'a hand-made layout');
    assert.match(customizeHtml([]), /cz-preset on" data-preset="trader"/);
    assert.match(html, /Reset to everything/);
  });

  test("a page switched off: its own switches give way to a line saying how to bring it back", async () => {
    const { customizeHtml } = await import('../src/ui/views/customize.js');
    const html = customizeHtml(['page.news']);
    assert.match(html, /Switch on News in Pages to choose what it shows/);
    assert.doesNotMatch(html, /data-item="news\.fed"/);
  });

  test('in the sidebar beside Designer mode, opened and closed like the other windows', () => {
    const html = read('index.html');
    assert.match(html, /openDesigner\(\)[^\n]*\n[^\n]*\n\s*<button class="settings-btn" id="customizeBtn" onclick="openCustomize\(\)"[^>]*>⊞ Customize<\/button>/);
    assert.match(html, /id="customizeModal"[^>]*><div class="modal cz-modal"><\/div><\/div>/);
    const actions = read('src/app/actions.js');
    assert.match(actions, /openCustomize, closeCustomize,/);
    assert.match(actions, /\{ id: 'customizeModal', close: closeCustomize \}/);
  });
});

describe('switched off is gone, and costs nothing', () => {
  test('every switch has something on the page to remove, removed with no space kept', () => {
    const view = read('src/ui/views/customize.js');
    for (const id of LAYOUT_IDS) assert.match(view, new RegExp(`'${id.replace('.', '\\.')}': \\(\\) =>|^  ${id}: \\(\\) =>`, 'm'), id);
    assert.match(read('styles/components.css'), /\.lay-off\{display:none!important\}/);
    assert.ok(read('index.html').includes('id="homeHoldings"'));
  });

  test('a page switched off is not opened, however it is asked for', () => {
    assert.match(read('src/ui/router.js'), /if \(SWITCHABLE\[name\] && !isShown\(SWITCHABLE\[name\]\)\) name = 'home';/);
  });

  test("panels switched off are not fetched: News, the dials, the S&P comparison, Crypto", () => {
    const news = read('src/ui/views/news.js');
    assert.match(news, /on\.fed \? fedDecision\(\) : null/);
    assert.match(news, /on\.opts \? optionsProfile\(currentMarket\(\)\) : null/);
    assert.match(news, /if \(on\.gamble\) startGamble\(\);/);
    assert.match(news, /if \(on\.earnings\) startEarningsRefresh\(\);/);
    assert.match(read('src/ui/views/sentimentGauges.js'), /if \(!isShown\('gauges'\)\) return;/);
    assert.match(read('src/ui/views/home.js'), /if \(!isShown\('home\.benchmark'\)\) return;/);
    const crypto = read('src/ui/views/crypto.js');
    assert.match(crypto, /if \(isShown\('crypto\.whales'\)\) startCryptoWhales\(\);/);
    assert.match(crypto, /if \(!isShown\('crypto\.etf'\)\) return;/);
  });

  test('a change shows at once: the layout applied on every redraw and when a switch flips', () => {
    const render = read('src/ui/render.js');
    assert.match(render, /export function renderAll\(\) \{\s*\/\/[^\n]*\n\s*applyLayout\(\);/);
    assert.match(render, /onLayoutChange\(\(\) => \{\s*applyLayout\(\);\s*renderOnPageEnter\(currentPage\(\)\);/);
  });
});
