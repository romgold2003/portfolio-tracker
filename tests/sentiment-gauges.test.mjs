/**
 * Fear and greed, stocks and crypto, at the top of every page but New trade.
 *
 * Romy's request (October 2026). The dials began in the corner of News; every
 * page's topbar now carries a slot for them and one module fills them all.
 * New trade is a form with a picture of its own, and is left alone.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { gaugesHtml } from '../src/ui/views/sentimentGauges.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/ui/router.js', import.meta.url), 'utf8');
const render = readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

const PAGES = router.match(/const PAGES = \[([^\]]+)\]/)[1].match(/'(\w+)'/g).map((q) => q.slice(1, -1));

/** A page's topbar: from the page's opening tag to the end of its first topbar. */
function topbar(id) {
  const start = html.indexOf(`<div id="${id}" class="page`);
  assert.ok(start >= 0, `page ${id} is missing`);
  const bar = html.indexOf('class="topbar"', start);
  // Searched from the end of this page's own tag, or it finds itself.
  const next = html.indexOf('class="page', html.indexOf('>', start));
  if (bar < 0 || (next > 0 && bar > next)) return '';
  // The topbar ends where the next top-level block of the page begins.
  const after = html.slice(bar).search(/\n {6}<(?!\/)/);
  return html.slice(bar, after > 0 ? bar + after : undefined);
}

describe('where the dials are', () => {
  for (const id of PAGES) {
    const wanted = id !== 'add';
    test(`${id}: ${wanted ? 'one slot, in the topbar' : 'none — New trade is left alone'}`, () => {
      const slots = (topbar(id).match(/data-gauges/g) ?? []).length;
      assert.equal(slots, wanted ? 1 : 0);
    });
  }

  test('nowhere else on the page', () => {
    const total = (html.match(/data-gauges/g) ?? []).length;
    assert.equal(total, PAGES.length - 1, 'a slot outside a topbar, or one too many');
  });
});

describe('when they are drawn', () => {
  test('on arriving at any page but New trade', () => {
    assert.match(render, /if \(page !== 'add'\) showGauges\(\);/);
  });

  test('and at start-up, since Home opens without a page change', () => {
    assert.match(main, /renderAll\(\);\s*\/\/[^\n]*\n\s*showGauges\(\);/);
  });
});

describe('what they show', () => {
  test('both dials when both readings are in', () => {
    const out = gaugesHtml({
      stocks: { value: 62, label: 'Greed' },
      crypto: { value: 28, label: 'Fear' },
    });
    assert.equal((out.match(/<svg class="gauge"/g) ?? []).length, 2);
    assert.match(out, /Stocks/);
    assert.match(out, /Crypto/);
  });

  test('just the one that answered, when the other did not', () => {
    const out = gaugesHtml({ crypto: { value: 28, label: 'Fear' } });
    assert.equal((out.match(/<svg class="gauge"/g) ?? []).length, 1);
  });

  test('nothing at all when neither did, so the slot stays hidden', () => {
    assert.equal(gaugesHtml(null), '');
    assert.equal(gaugesHtml({}), '');
  });
});
