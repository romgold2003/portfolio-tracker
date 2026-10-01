/**
 * Crypto as a page of its own, under News in the menu.
 *
 * Romy's request (October 2026): crypto should be a section like Monthly or
 * New trade, not a tab inside another page. The whale trades, the volume panel
 * and the spot ETF flows live there; News keeps Markets and Gamble. The cards
 * keep their ids, so everything that draws them is unchanged.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/ui/router.js', import.meta.url), 'utf8');
const render = readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
const news = readFileSync(new URL('../src/ui/views/news.js', import.meta.url), 'utf8');
const gamble = readFileSync(new URL('../src/ui/views/gamble.js', import.meta.url), 'utf8');
const whales = readFileSync(new URL('../src/ui/views/cryptoWhales.js', import.meta.url), 'utf8');

/** A page's markup, up to the next page or the end of main. */
const page = (id) => {
  const start = html.indexOf(`<div id="${id}" class="page`);
  assert.ok(start >= 0, `page ${id} is missing`);
  const next = html.indexOf('class="page', start + 20);
  const end = html.indexOf('</main>', start);
  return html.slice(start, next > 0 && next < end ? next : end);
};

describe('the menu', () => {
  test('has Crypto straight after News', () => {
    const items = [...html.matchAll(/onclick="show\('(\w+)'\)"><span class="nl-icon">[^<]*<\/span> ([^<]+)</g)]
      .map((m) => m[2].trim());
    assert.deepEqual(items, ['Home', 'Positions', 'New trade', 'Monthly', 'News', 'Crypto']);
  });

  test('and the router lists the pages in the same order as the buttons', () => {
    // The router matches buttons to pages by position, so the two lists must
    // agree or the wrong button lights up.
    const buttons = [...html.matchAll(/class="nl[^"]*" onclick="show\('(\w+)'\)"/g)].map((m) => m[1]);
    const listed = router.match(/const PAGES = \[([^\]]+)\]/)[1].match(/'(\w+)'/g).map((q) => q.slice(1, -1));
    assert.deepEqual(listed, buttons);
  });

  test('arriving on the page draws it', () => {
    assert.match(render, /if \(page === 'crypto'\) renderCrypto\(\);/);
  });
});

describe('the Crypto page', () => {
  test('holds the whale trades, unusual volume and spot ETF flows', () => {
    const crypto = page('crypto');
    for (const id of ['cryptoWhaleCard', 'spotSection', 'levSection', 'volumeCard', 'etfCard']) {
      assert.match(crypto, new RegExp(`id="${id}"`), id);
    }
  });

  test('opens on Whales, with Volume and ETF flows beside it', () => {
    const inner = [...page('crypto').matchAll(/data-ctab="(\w+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(inner, [['whales', 'Whales'], ['volume', 'Volume'], ['etf', 'ETF flows']]);
    assert.match(page('crypto'), /class="opt-tab active" data-ctab="whales"/);
  });

  test('its views map to their panes', () => {
    assert.match(whales, /whales: 'cryptoWhales', volume: 'cryptoVolume', etf: 'cryptoEtf'/);
  });
});

describe('the News page', () => {
  test('is back to Markets and Gamble', () => {
    const tabs = [...page('news').matchAll(/data-tab="(\w+)">([^<]+)</g)].map((m) => m[2]);
    assert.deepEqual(tabs, ['Markets', 'Gamble']);
    assert.doesNotMatch(html, /id="newsCrypto"/);
  });

  test('keeps rates, data and options, and none of the crypto cards', () => {
    const n = page('news');
    for (const id of ['fedCard', 'econCard', 'optionsCard', 'gambleCard']) assert.match(n, new RegExp(`id="${id}"`), id);
    for (const id of ['cryptoWhaleCard', 'volumeCard', 'etfCard']) assert.doesNotMatch(n, new RegExp(`id="${id}"`), id);
  });

  test('no longer fetches or starts anything that moved away', () => {
    assert.doesNotMatch(news, /etfFlows|renderEtfFlows|startCryptoWhales|installCryptoTabs/);
    assert.doesNotMatch(gamble, /newsCrypto|onCrypto/);
  });
});

describe('every card appears exactly once', () => {
  for (const id of ['cryptoWhaleCard', 'volumeCard', 'etfCard', 'gambleCard', 'optionsCard']) {
    test(id, () => assert.equal(html.split(`id="${id}"`).length - 1, 1));
  }
});

describe('the collector records exposure every run', () => {
  const options = readFileSync(new URL('../api/_panels/options.js', import.meta.url), 'utf8');
  const yml = readFileSync(new URL('../.github/workflows/collect-whales.yml', import.meta.url), 'utf8');

  test('the options endpoint accepts the collector key in place of a session', () => {
    assert.match(options, /collectorKeyMatches\(url\.searchParams\.get\('key'\)\)/);
    assert.match(options, /if \(!collector\) \{\s*const user = await userForToken/);
  });

  test('and never answers the collector from a cache, or nothing would be recorded', () => {
    assert.match(options, /collector\s*\? 'no-store'/);
  });

  test('the workflow reads every market the panel offers', () => {
    const offered = [...options.matchAll(/^  (\w+): \{ label:/gm)].map((m) => m[1]);
    const line = yml.match(/for market in ([A-Z ]+); do/);
    assert.ok(line, 'no exposure loop in the workflow');
    assert.deepEqual(line[1].trim().split(/\s+/), offered);
  });
});
