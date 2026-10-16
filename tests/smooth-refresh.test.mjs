/**
 * The app slow, freezing, and a daily percentage "totally wrong, then back to
 * the right number" (October 2026). Three causes, held here:
 *
 *   - Every thirty-second refresh redrew every page, News included — the Fed,
 *     releases, sentiment and options panels re-fetched and redrawn, and
 *     Polymarket read again for the Gamble tab — behind a Home page nobody had
 *     left.
 *   - The Crypto page's live Hyperliquid feed, every trade on forty coins,
 *     stayed open from the first visit until the tab closed.
 *   - Prices were written into the live positions one holding at a time, so
 *     anything drawn mid-refresh showed a book half old and half new.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { refreshOpenPositions } from '../src/services/prices.js';
import { resetExtendedCache } from '../src/services/extendedHours.js';
import { closeOnOrBefore } from '../src/services/history.js';
import { state } from '../src/core/store.js';
import { setCloudEnabled } from '../src/services/cloud.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('a refresh is put on screen whole', () => {
  let realFetch;
  const position = (ticker, cur) => ({
    id: ticker.length, ticker, cls: 'Stocks', dir: 'Long', status: 'Open', entry: 10, cur, qty: 100, prevClose: cur, dailyChg: 0,
  });

  beforeEach(() => {
    realFetch = globalThis.fetch;
    state.positions.length = 0;
    state.apiKey = '';
    state.statements = [];
    setCloudEnabled(true);
    resetExtendedCache();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    state.positions.length = 0;
    setCloudEnabled(false);
  });

  test('nothing on screen changes until every price is in, then all of it does', async () => {
    state.positions.push(position('SOFI', 15.09), position('ORCL', 134.47));
    let release;
    const gate = new Promise((ok) => { release = ok; });
    const live = {
      SOFI: { symbol: 'SOFI', price: 15.39, regularClose: 15.39, previousClose: 15.09, phase: 'regular', at: Math.floor(Date.now() / 1000) },
      ORCL: { symbol: 'ORCL', price: 136, regularClose: 136, previousClose: 134.47, phase: 'regular', at: Math.floor(Date.now() / 1000) },
    };
    let calls = 0;
    // The first request answers at once and every later one waits: where a
    // refresh written one holding at a time showed SOFI new and ORCL old.
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/history')) return { ok: false, status: 404, json: async () => ({}) };
      calls += 1;
      if (calls > 1) await gate;
      const symbols = new URL(u, 'http://x').searchParams.get('symbols')?.split(',') ?? [];
      return { ok: true, status: 200, json: async () => ({ quotes: symbols.map((s) => live[s]).filter(Boolean) }) };
    };
    const running = refreshOpenPositions(new Date('2026-10-16T14:00:00Z'));
    await new Promise((ok) => { setTimeout(ok, 10); });
    // Mid-refresh: what a redraw now would show is the book as it was.
    assert.deepEqual(state.positions.map((p) => [p.cur, p.dailyChg]), [[15.09, 0], [134.47, 0]]);
    release();
    await running;
    const [sofi, orcl] = state.positions;
    assert.equal(sofi.cur, 15.39);
    assert.ok(Math.abs(sofi.dailyChg - ((15.39 - 15.09) / 15.09) * 100) < 1e-9);
    assert.equal(orcl.cur, 136);
  });

  test('the whole book is one quote request, not one per holding', async () => {
    state.positions.push(position('SOFI', 15), position('ORCL', 134), position('AMD', 600), position('NFLX', 70));
    let quoteCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/history')) return { ok: false, status: 404, json: async () => ({}) };
      if (u.includes('/api/quote')) quoteCalls += 1;
      const symbols = new URL(u, 'http://x').searchParams.get('symbols')?.split(',') ?? [];
      const quotes = symbols.map((symbol) => ({ symbol, price: 1, regularClose: 1, previousClose: 1, phase: 'regular', at: Math.floor(Date.now() / 1000) }));
      return { ok: true, status: 200, json: async () => ({ quotes }) };
    };
    await refreshOpenPositions(new Date('2026-10-16T14:00:00Z'));
    assert.equal(quoteCalls, 1);
  });

  test('an edit made while the refresh was out is not undone by it', async () => {
    state.positions.push(position('SOFI', 15));
    let release;
    const gate = new Promise((ok) => { release = ok; });
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/history')) return { ok: false, status: 404, json: async () => ({}) };
      await gate;
      return { ok: true, status: 200, json: async () => ({ quotes: [{ symbol: 'SOFI', price: 15.39, regularClose: 15.39, previousClose: 15.09, phase: 'regular', at: Math.floor(Date.now() / 1000) }] }) };
    };
    const running = refreshOpenPositions(new Date('2026-10-16T14:00:00Z'));
    await new Promise((ok) => { setTimeout(ok, 10); });
    state.positions[0].qty = 500; // a top-up, mid-refresh
    release();
    await running;
    assert.equal(state.positions[0].qty, 500);
    assert.equal(state.positions[0].cur, 15.39);
  });
});

describe('only what is on screen is redrawn', () => {
  test('a refresh redraws the page on screen, and the others when they are opened', () => {
    const render = read('src/ui/render.js');
    const all = render.slice(render.indexOf('export function renderAll'), render.indexOf('export function renderOnPageEnter'));
    assert.match(all, /const page = currentPage\(\);/);
    assert.doesNotMatch(all, /\n\s*renderNews\(\);\n\s*renderPositions|^\s*renderPositions\(\);\n\s*renderMonthly\(\);/m);
    assert.match(render, /if \(page === 'positions'\) renderPositions\(\);/);
  });

  test('the Gamble tab is read only while it is open', () => {
    assert.match(read('src/ui/views/news.js'), /getElementById\('newsGamble'\)\?\.hidden === false\) renderGamble\(\)/);
  });

  test('the live whale feed hangs up off its page and in a background tab', () => {
    const whales = read('src/ui/views/cryptoWhales.js');
    assert.match(whales, /export function pauseHyperliquid\(\)/);
    assert.match(whales, /if \(!hl\.paused\) setTimeout\(connectHyperliquid, 5_000\)/);
    assert.match(whales, /visibilityState === 'hidden'\) pauseHyperliquid\(\)/);
    assert.match(read('src/ui/render.js'), /else pauseHyperliquid\(\);/);
  });
});

describe('the close on or before a day', () => {
  const rows = [{ date: '2026-10-13', close: 1 }, { date: '2026-10-14', close: 2 }, { date: '2026-10-16', close: 3 }];
  test('is the same answer, found by halving', () => {
    assert.equal(closeOnOrBefore(rows, '2026-10-12'), null);
    assert.equal(closeOnOrBefore(rows, '2026-10-13'), 1);
    assert.equal(closeOnOrBefore(rows, '2026-10-15'), 2);
    assert.equal(closeOnOrBefore(rows, '2026-12-01'), 3);
    assert.equal(closeOnOrBefore([], '2026-10-15'), null);
  });
});
