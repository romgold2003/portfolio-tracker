/**
 * The tutorial (November 2026): slides of real Riskbook screens with red
 * circles and arrows on the buttons that matter. It opens by itself once, at
 * the first sign-in, and from ❔ Help & tutorial in the menu any time after. It replaced the welcome
 * banner.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { SLIDES, marksSvg, slideHtml } = await import('../src/ui/views/tour.js');
const { SHOTS } = await import('../src/ui/views/tourShots.js');

describe('the slides', () => {
  test('every slide has its picture, and every mark is found on it', () => {
    assert.ok(SLIDES.length >= 6);
    for (const s of SLIDES) {
      assert.ok(SHOTS[s.shot], s.shot);
      assert.ok(existsSync(new URL(`../assets/tour-${s.shot}.webp`, import.meta.url)), s.shot);
      assert.ok(s.title && s.text && s.marks.length, s.title);
      for (const [key, label, what] of s.marks) {
        assert.ok(SHOTS[s.shot].rects[key], `${s.shot}.${key}`);
        assert.ok(label && what, key);
      }
    }
  });

  test('importing from the broker is shown early: the broker, then its steps and the years', () => {
    const at = SLIDES.findIndex((s) => s.shot === 'import');
    assert.ok(at > 0 && at <= 2);
    assert.equal(SLIDES[at + 1].shot, 'guide');
    assert.deepEqual(SLIDES[at + 1].marks.map(([k]) => k), ['steps', 'firstYear', 'whole']);
    assert.ok(SLIDES.some((s) => s.marks.some(([k]) => k === 'withdraw')));
    assert.ok(SLIDES.some((s) => s.marks.some(([k]) => k === 'newTrade')));
  });

  test('a ring and a number for each mark, all inside the picture', () => {
    for (const s of SLIDES) {
      const svg = marksSvg(s.shot, s.marks);
      assert.equal((svg.match(/class="tour-ring"/g) ?? []).length, s.marks.length, s.title);
      assert.equal((svg.match(/class="tour-badge"/g) ?? []).length, s.marks.length, s.title);
      const { w, h } = SHOTS[s.shot];
      const centres = [...svg.matchAll(/cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (const [x, y] of centres) assert.ok(x > 0 && x < w && y > 0 && y < h, s.title);
      // Numbers never sit on top of each other.
      for (let i = 0; i < centres.length; i += 1) {
        for (let j = i + 1; j < centres.length; j += 1) {
          assert.ok(Math.hypot(centres[i][0] - centres[j][0], centres[i][1] - centres[j][1]) >= 34, `${s.title} ${i + 1}/${j + 1}`);
        }
      }
    }
  });

  test('Back on the first slide is off, and the last says Get started', () => {
    assert.match(slideHtml(0), /data-tour-prev disabled/);
    assert.match(slideHtml(0), /1 of \d/);
    assert.match(slideHtml(SLIDES.length - 1), /Get started/);
    assert.doesNotMatch(slideHtml(1), /data-tour-prev disabled/);
  });
});

describe('where it lives', () => {
  const html = read('index.html');
  test('Help & tutorial in the menu only, not a second button at the top', () => {
    assert.match(html, /id="tourBtn" onclick="openTour\(\)"[^>]*>❔ Help &amp; tutorial/);
    assert.equal((html.match(/onclick="openTour\(\)"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /id="helpBtn"/);
    assert.match(html, /id="tour"[^>]*hidden/);
  });

  test('the welcome banner is gone', () => {
    assert.doesNotMatch(html, /welcome-?banner|welcomeBanner/i);
    assert.doesNotMatch(read('src/ui/views/home.js'), /updateWelcomeBanner|dismissWelcome/);
  });

  test('Settings opens on importing from the broker', () => {
    const settings = html.slice(html.indexOf('id="settingsModal"'));
    assert.ok(settings.indexOf('Import from your broker') < settings.indexOf('Live prices'));
    assert.match(html, /id="importBrokerBtn"/);
  });

  test('seen once, kept with the sign-in, so it opens by itself only the first time', () => {
    const store = read('src/core/store.js');
    assert.match(store, /tourSeen: false/);
    assert.match(store, /state\.tourSeen = source\.tourSeen === true/);
    assert.match(store, /tourSeen: state\.tourSeen/);
    const tour = read('src/ui/views/tour.js');
    assert.match(tour, /closeTour[\s\S]*setTourSeen\(\)/);
    // A new account answers "About you" first; that window opens the tutorial after.
    assert.match(tour, /if \(state\.tourSeen \|\| !isUnlocked\(\) \|\| \(aboutDue\(\) && cloudEnabled\(\)\)\) return/);
  });
});
