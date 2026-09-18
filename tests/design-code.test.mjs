/**
 * Designer mode share codes: a design packed into a short code and back.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { encodeDesign, decodeDesign, DESIGN_GROUPS } from '../src/ui/theme.js';

describe('design codes', () => {
  test('a design comes back exactly as it went in', () => {
    const colours = { '--bg': '#fff4e6', '--curve': '#7c3aed', '--amber': '#e8a43a' };
    const code = encodeDesign('light', colours);
    assert.match(code, /^RB-[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeDesign(code), { base: 'light', colours });
  });

  test('is short: only the colours that were changed are in it', () => {
    const five = {
      '--bg': '#101020', '--panel': '#202030', '--text': '#eeeeee', '--curve': '#00ffaa', '--red': '#ff3355',
    };
    const code = encodeDesign('dark', five);
    assert.ok(code.length <= 30, code);
    assert.deepEqual(decodeDesign(encodeDesign('dark', {})), { base: 'dark', colours: {} });
  });

  test('every colour at once still round-trips', () => {
    const all = Object.fromEntries(
      DESIGN_GROUPS.flatMap((g) => g.tokens).map(([t], i) => [t, `#${String(i).padStart(2, '0')}a0ff`]),
    );
    assert.deepEqual(decodeDesign(encodeDesign('dark', all)).colours, all);
  });

  test('pasted with spaces or without the prefix, it still reads', () => {
    const code = encodeDesign('dark', { '--bg': '#123456' });
    assert.equal(decodeDesign(`  ${code.slice(3)}  `).colours['--bg'], '#123456');
  });

  test('anything else is refused, not half-applied', () => {
    const cut = encodeDesign('dark', { '--bg': '#123456' }).slice(0, -2);
    for (const bad of ['', 'hello', 'RB-!!!!', 'RB-AAAAAAAAAA', cut]) {
      assert.equal(decodeDesign(bad), null, bad);
    }
  });
});
