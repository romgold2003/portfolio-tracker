/**
 * The app on every screen: phones from 320px, tablets, desktops.
 *
 * Romy's phone showed it "kind of off" (October 2026). Measured in the browser
 * at 320, 375, 390, 768, 1024 and 1440 pixels wide, on every page and every
 * tab, the causes were:
 *
 *   - the menu took nearly half an iPhone screen and hid News and Crypto off
 *     its edge;
 *   - every chart was drawn 900 wide and shrunk to fit, so on a phone its
 *     labels came out at 3 to 8 pixels;
 *   - four tables left an empty zero-width column for a cell hidden on phones,
 *     and because a hidden cell takes no slot, every cell after it moved a
 *     column left and printed on top of its neighbour;
 *   - buttons sized for a mouse, 16 to 28 pixels tall.
 *
 * The browser checks are not repeatable here; these hold the fixes in place.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { chartBox, historyChart } from '../src/ui/views/exposureHistory.js';
import { gexBars } from '../src/ui/views/exposureNow.js';
import { gaugesHtml } from '../src/ui/views/sentimentGauges.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('styles/components.css') + read('styles/layout.css');
const html = read('index.html');

describe('charts are drawn at the width they are shown at', () => {
  test('a chart box is as wide as its host, so a 13px label is 13px', () => {
    assert.equal(chartBox(343).W, 343);
    assert.equal(chartBox(1100).W, 1100);
  });

  test('narrow screens get a shorter plot and a narrower gutter', () => {
    const phone = chartBox(343);
    const desk = chartBox(1100);
    assert.equal(phone.narrow, true);
    assert.ok(phone.H < desk.H);
    assert.ok(phone.PLOT.x0 < desk.PLOT.x0);
  });

  test('the history and the GEX bars carry the width in their viewBox', () => {
    const points = [
      { day: '2026-09-30', t: Date.parse('2026-09-30'), dex: 1, gex: 1 },
      { day: '2026-10-01', t: Date.parse('2026-10-01'), dex: 2, gex: 2 },
    ];
    assert.match(historyChart(points, { key: 'dex', title: 'x', colour: '#000', width: 343 }), /viewBox="0 0 343 220"/);
    assert.match(gexBars([{ strike: 1, gex: 1 }, { strike: 2, gex: -1 }], 343), /viewBox="0 0 343 220"/);
  });

  test('nothing is stretched to fit any more — stretching stretched the text', () => {
    assert.doesNotMatch(read('src/ui/views/exposure.js'), /<svg[^>]*preserveAspectRatio="none"/);
  });

  test('a chart drawn while hidden is drawn again once it is shown', () => {
    assert.match(read('src/ui/views/cryptoWhales.js'), /cryptoView === 'etf'\) redrawFlows\(\)/);
    assert.match(read('src/ui/views/gamble.js'), /wanted === 'market'\) redrawExposure\(\)/);
  });

  test('and again when the screen turns or resizes', () => {
    assert.match(read('src/ui/views/exposure.js'), /addEventListener\?\.\('resize', redrawAtNewWidth\)/);
  });
});

describe('no table leaves a slot for a cell it hides', () => {
  test('there is no zero-width grid column anywhere in the stylesheets', () => {
    // A cell with display:none takes no grid slot, so a 0 column left for it
    // is filled by the next cell and everything after shifts a column left.
    const zero = css.match(/grid-template-columns:[^;}]*(?:^|\s)0(?:\s|;|})/gm) ?? [];
    assert.deepEqual(zero, []);
  });
});

describe('a phone looks like a phone app', () => {
  const phone = css.slice(css.indexOf('/* ── Phones'));

  test('the six sections sit in a bar along the bottom, clear of the home indicator', () => {
    assert.match(phone, /\.nav-links\{position:fixed;left:0;right:0;bottom:0/);
    assert.match(phone, /grid-template-columns:repeat\(6,1fr\)/);
    assert.match(phone, /env\(safe-area-inset-bottom\)/);
    assert.match(html, /viewport-fit=cover/, 'without it the safe-area insets are zero');
  });

  test('the page scrolls: the body is unlocked, since the document is what scrolls', () => {
    // base.css sets body{height:100vh;overflow:hidden} for the desktop's inner
    // pane. Romy's phone could not scroll up or down until this was undone.
    assert.match(read('styles/base.css'), /body\{[^}]*overflow:hidden/);
    assert.match(phone, /body\{height:auto;overflow:visible;overflow-x:clip\}/);
    assert.match(phone, /\.main\{[^}]*overflow-y:visible/);
  });

  test('the tools hide behind a button instead of taking a third of the screen', () => {
    assert.match(html, /id="toolsBtn"[^>]*onclick="toggleTools\(\)"/);
    assert.match(phone, /\.sidebar-bot\{display:none/);
    assert.match(phone, /\.sidebar\.tools-open \.sidebar-bot\{display:flex\}/);
    assert.match(read('src/app/actions.js'), /show, toggleTools,/);
  });

  test('a page change starts at the top of the new page', () => {
    assert.match(read('src/ui/router.js'), /window\.scrollTo\?\.\(0, 0\)/);
  });

  test('the four summary figures go two by two', () => {
    assert.match(css, /\.summary-row\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  });
});

describe('fingers, not a mouse', () => {
  test('touch screens get controls at least 36px tall', () => {
    const touch = css.slice(css.indexOf('@media (pointer:coarse)'));
    for (const cls of ['sort-btn', 'opt-tab', 'cw-coin', 'cash-edit', 'xh-frame']) {
      assert.match(touch.slice(0, 600), new RegExp(`\\.${cls}[,{]`), cls);
    }
    assert.match(touch.slice(0, 600), /min-height:36px/);
  });

  test('the small-print rule comes last, or the rules it overrides win', () => {
    const at = css.indexOf('@media (max-width:900px), (pointer:coarse)');
    assert.ok(at > css.indexOf('.ext-badge{display:inline-block'), 'it must follow the rules it enlarges');
  });
});

describe('the fear and greed dials', () => {
  test('say their mood and market as text under the dial, not inside it', () => {
    const out = gaugesHtml({ stocks: { value: 27, label: 'Fear' } });
    assert.match(out, /<figcaption class="gauge-text"><span class="gauge-mood">Fear<\/span>/);
    assert.match(out, /<span class="gauge-name">Stocks<\/span>/);
    assert.doesNotMatch(read('src/ui/views/gauge.js'), /class="gauge-lbl"|class="gauge-cap"/);
  });
});
