/**
 * The News page in three parts: Markets, Crypto, Gamble.
 *
 * Moved on Romy's request (October 2026). The whale trades, the volume panel
 * and the spot ETF flows are about crypto money, not wagers, so they left
 * Gamble and Markets for a tab of their own; Gamble keeps the Polymarket bets.
 * The cards keep their ids, so everything that draws them is unchanged.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pane = (id) => {
  const start = html.indexOf(`<div id="${id}"`);
  assert.ok(start >= 0, `${id} is missing`);
  // Up to the next top-level pane, or the end of the page.
  const ends = ['<div id="newsMarket"', '<div id="newsCrypto"', '<div id="newsGamble"', '</main>']
    .map((m) => html.indexOf(m, start + 1)).filter((i) => i > start);
  return html.slice(start, Math.min(...ends));
};

describe('the tabs', () => {
  test('read Markets, Crypto, Gamble, in that order', () => {
    const tabs = [...html.matchAll(/data-tab="(\w+)">([^<]+)</g)].map((m) => m[2]);
    assert.deepEqual(tabs, ['Markets', 'Crypto', 'Gamble']);
  });

  test('Crypto opens on whales, with volume and ETF flows beside it', () => {
    const inner = [...pane('newsCrypto').matchAll(/data-ctab="(\w+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(inner, [['whales', 'Whales'], ['volume', 'Volume'], ['etf', 'ETF flows']]);
    assert.match(pane('newsCrypto'), /data-ctab="whales">/);
    assert.match(pane('newsCrypto'), /class="opt-tab active" data-ctab="whales"/);
  });
});

describe('what each part holds', () => {
  test('Crypto: the whale trades, unusual volume and spot ETF flows', () => {
    const crypto = pane('newsCrypto');
    for (const id of ['cryptoWhaleCard', 'spotSection', 'levSection', 'volumeCard', 'etfCard']) {
      assert.match(crypto, new RegExp(`id="${id}"`), id);
    }
  });

  test('Gamble: the Polymarket bets alone', () => {
    const gamble = pane('newsGamble');
    assert.match(gamble, /id="gambleCard"/);
    for (const gone of ['cryptoWhaleCard', 'volumeCard', 'etfCard', 'gambleTabs']) {
      assert.doesNotMatch(gamble, new RegExp(`id="${gone}"`), gone);
    }
  });

  test('Markets: rates, data and options, with the ETF flows gone to Crypto', () => {
    const market = pane('newsMarket');
    for (const id of ['fedCard', 'econCard', 'optionsCard']) assert.match(market, new RegExp(`id="${id}"`), id);
    assert.doesNotMatch(market, /id="etfCard"/);
  });

  test('every card appears exactly once', () => {
    for (const id of ['cryptoWhaleCard', 'volumeCard', 'etfCard', 'gambleCard', 'optionsCard']) {
      assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
    }
  });
});

describe('the switching', () => {
  const gamble = readFileSync(new URL('../src/ui/views/gamble.js', import.meta.url), 'utf8');
  const whales = readFileSync(new URL('../src/ui/views/cryptoWhales.js', import.meta.url), 'utf8');
  const news = readFileSync(new URL('../src/ui/views/news.js', import.meta.url), 'utf8');

  test('the News strip shows and hides all three panes', () => {
    for (const p of ['newsMarket', 'newsCrypto', 'newsGamble']) assert.match(gamble, new RegExp(`el\\('${p}'\\)\\.hidden`), p);
  });

  test('arriving on Crypto draws whichever view it has open', () => {
    assert.match(gamble, /wanted === 'crypto' && typeof onCrypto === 'function'\) onCrypto\(\)/);
    assert.match(news, /installNewsTabs\(\{ onCrypto: \(\) => showCryptoView\(\) \}\)/);
    assert.match(news, /installCryptoTabs\(\)/);
  });

  test('the Crypto views map to their panes', () => {
    assert.match(whales, /whales: 'cryptoWhales', volume: 'cryptoVolume', etf: 'cryptoEtf'/);
  });

  test('nothing still points at the old Gamble crypto panes', () => {
    for (const src of [gamble, whales, news, html]) {
      assert.doesNotMatch(src, /gambleCrypto|gambleVolume|data-gtab|installGambleTabs/);
    }
  });
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
