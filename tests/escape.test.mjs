import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topmost } from '../src/ui/escape.js';

// A stand-in for DOM nodes: a z-index and a place in the page.
const win = (name, z, pos) => ({
  name, z, pos,
  // Node.DOCUMENT_POSITION_FOLLOWING (4) when `other` comes after this one.
  compareDocumentPosition: (other) => (other.pos > pos ? 4 : 2),
});
const zOf = (n) => n.z;

test('Esc closes the higher window when two are stacked', () => {
  const designer = win('designer', 100, 1);
  const favourites = win('favourites', 120, 2);
  assert.equal(topmost([designer, favourites], zOf).name, 'favourites');
  assert.equal(topmost([favourites, designer], zOf).name, 'favourites', 'order in the list does not matter');
});

test('years panel over price settings closes first', () => {
  const settings = win('settings', 100, 1);
  const years = win('years', 110, 3);
  assert.equal(topmost([settings, years], zOf).name, 'years');
});

test('on equal z-index the one later in the page is on top', () => {
  const a = win('earlier', 100, 1);
  const b = win('later', 100, 5);
  assert.equal(topmost([a, b], zOf).name, 'later');
  assert.equal(topmost([b, a], zOf).name, 'later');
});

test('a single open window is the one closed, and none means none', () => {
  const only = win('import', 100, 4);
  assert.equal(topmost([only], zOf).name, 'import');
  assert.equal(topmost([], zOf), null);
});
