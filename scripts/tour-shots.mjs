/**
 * The tutorial's pictures: real screens of Riskbook, taken from a demo account
 * (made-up money, never a real book), and where each button sits on them, so
 * the red circles and arrows in src/ui/views/tour.js land exactly on it.
 *
 * Run it again whenever a screen in the tutorial changes:
 *   1. start the local cloud build:   npm run dev:cloud
 *   2. npm i --no-save puppeteer-core   (or point PUPPETEER at a copy of it)
 *   3. node scripts/tour-shots.mjs
 * It writes assets/tour-*.webp and src/ui/views/tourShots.js.
 */
import { writeFileSync } from 'node:fs';
import { buildDemoJournal, FALLBACK_PRICES } from './demo-journal.mjs';

const { default: puppeteer } = await import(process.env.PUPPETEER ?? 'puppeteer-core');
const BASE = process.env.BASE ?? 'http://localhost:4173';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = 1280;
const H = 800;
const today = new Date().toISOString().slice(0, 10);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  args: ['--hide-scrollbars'],
});
const page = await browser.newPage();
const settle = (ms = 1500) => new Promise((r) => { setTimeout(r, ms); });

// A fresh demo account, signed in, with the tutorial marked seen so it does not cover the shots.
await page.goto(BASE, { waitUntil: 'load' });
const journal = { ...buildDemoJournal({ prices: FALLBACK_PRICES, today }), tourSeen: true };
await page.evaluate(async (j) => {
  const profiles = await import('/src/core/profiles.js');
  await profiles.createProfile(`tour-${Date.now()}@riskbook.test`, crypto.randomUUID(), j);
}, journal);
await page.reload({ waitUntil: 'load' });
await settle(3000);

/** In the page: the box of each target, as [x, y, width, height] in the shot's pixels. */
async function boxes(targets) {
  return page.evaluate((t) => {
    const byText = (sel, text) => [...document.querySelectorAll(sel)]
      .find((n) => n.offsetParent && n.textContent.replace(/\s+/g, ' ').trim().startsWith(text));
    const out = {};
    for (const [name, how] of Object.entries(t)) {
      const node = how.text ? byText(how.sel, how.text) : document.querySelector(how.sel);
      const r = node?.getBoundingClientRect();
      if (r && r.width) out[name] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
    }
    return out;
  }, targets);
}

const SHOTS = [
  {
    name: 'home',
    setup: () => { window.closeSettings?.(); window.show('home'); },
    targets: {
      account: { sel: '#acctValue' },
      today: { sel: '#portfolioDailyPct', parent: true },
      graph: { sel: '#home .curve-wrap' },
      timeframes: { sel: '#tfRow' },
      dollarPct: { sel: '#home .curve-modes' },
      allocation: { sel: '#allocCard' },
      daily: { sel: '#dailyLogBtn' },
      withdraw: { sel: '.topbar-btn-warn' },
      newTrade: { sel: '.topbar-newtrade' },
      help: { sel: '#tourBtn' },
      settings: { sel: '#settingsBtn' },
      customize: { sel: '#customizeBtn' },
      navPositions: { sel: '.nl', text: '◈' },
      navMonthly: { sel: '.nl', text: '▦' },
      navNews: { sel: '.nl', text: '◎' },
      navCrypto: { sel: '.nl', text: '₿' },
      navFriends: { sel: '.nl', text: '👤' },
    },
  },
  {
    name: 'settings',
    setup: () => { window.show('home'); window.openSettings(); },
    targets: { importButton: { sel: '#importBrokerBtn' }, settings: { sel: '#settingsBtn' } },
  },
  {
    name: 'import',
    // On its own, not over the settings window, so the picture is clear.
    setup: () => { window.closeSettings?.(); window.openYearsPanel(); },
    targets: { years: { sel: '#yearsGrid' }, firstYear: { sel: '#yearsGrid > *' }, whole: { sel: '.years-whole' } },
  },
  {
    name: 'positions',
    setup: async () => {
      window.closeYearsPanel?.();
      window.closeSettings?.();
      window.show('positions');
      // The card at the top of the list, opened as a click opens it.
      await new Promise((r) => { setTimeout(r, 600); });
      document.querySelector('#positions .pos-head')?.click();
    },
    targets: {
      card: { sel: '.pos-card.expanded .pos-head' },
      close: { sel: 'button', text: 'Close' },
      dca: { sel: 'button', text: '+ DCA' },
      edit: { sel: 'button', text: '✎ Edit' },
      sort: { sel: '#psort-dUp' },
    },
  },
  {
    name: 'monthly',
    setup: () => { window.show('monthly'); },
    targets: { chart: { sel: '#monthChart' }, months: { sel: '#monthTable' } },
  },
  {
    name: 'news',
    setup: () => { window.show('news'); },
    targets: {
      fed: { sel: '#fedCard' },
      earnings: { sel: '#earnPane' },
      econ: { sel: '#econCard' },
      tabs: { sel: '#newsTabs' },
      navNews: { sel: '.nl', text: '◎' },
      navCrypto: { sel: '.nl', text: '₿' },
      navFriends: { sel: '.nl', text: '👤' },
    },
  },
];

const result = {};
for (const shot of SHOTS) {
  await page.evaluate(`(${shot.setup.toString()})()`);
  // A made-up address where the demo account's own would show.
  await page.evaluate(() => { const e = document.getElementById('accountEmail'); if (e) e.textContent = 'you@example.com'; });
  await settle(shot.name === 'news' ? 6000 : 2200);
  // The today box is the parent of its figure.
  const t = Object.fromEntries(Object.entries(shot.targets).map(([k, v]) => [k, v.parent ? { sel: `${v.sel}` } : v]));
  const rects = await boxes(t);
  if (shot.targets.today?.parent) {
    rects.today = await page.evaluate(() => {
      const r = document.getElementById('portfolioDailyPct')?.parentElement?.getBoundingClientRect();
      return r ? [r.x, r.y, r.width, r.height].map(Math.round) : null;
    });
  }
  await page.screenshot({ path: `assets/tour-${shot.name}.webp`, type: 'webp', quality: 82 });
  result[shot.name] = { w: W, h: H, rects };
  console.log(shot.name, Object.keys(rects).join(', '));
}
await browser.close();

writeFileSync('src/ui/views/tourShots.js', `/**
 * Where each button sits on the tutorial's pictures (assets/tour-*.webp), as
 * [x, y, width, height] in their pixels. Written by scripts/tour-shots.mjs from
 * the same screens it photographs; run it again when a screen changes.
 */
export const SHOTS = ${JSON.stringify(result, null, 2)};
`);
console.log('written');
