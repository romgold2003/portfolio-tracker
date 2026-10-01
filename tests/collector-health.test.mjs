/**
 * Making sure a collector that stops collecting is noticed.
 *
 * In late September the whale collector failed for four days and nothing said
 * so: the scheduled job stayed green, the card went empty, and the Spot line's
 * "updated 1 minute ago" — the browser's fetch time, not a collection time —
 * told the reader all was well throughout.
 *
 * Three things now stop that, and each is tested here:
 *   - every job records when it last ran and when it last worked, and the
 *     card's source lines read that back, turning amber when it is old;
 *   - a poll that cannot write that record — the database down or paused —
 *     answers 503, and the scheduled job turns red, which emails the owner;
 *   - the spot runner fails red, too, when the server cannot plan or store.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { noteRun, readHealth, STALE_AFTER_S, JOBS } from '../api/_lib/collectorHealth.js';
import { collectedText } from '../src/services/whaleTrades.js';

before(() => {
  useDriver(sqliteDriver());
});

const T0 = Date.UTC(2026, 9, 1, 12);
const T0_S = Math.floor(T0 / 1000);

describe('the record each job keeps', () => {
  test('a job never run is stale, not fine', async () => {
    const h = await readHealth({ now: T0 });
    for (const job of JOBS) {
      assert.equal(h[job].stale, true, `${job}: an empty panel with no history has to say so`);
      assert.equal(h[job].okAt, null);
    }
  });

  test('a success is remembered, and is fresh', async () => {
    await noteRun('spot', { ok: true, detail: 'read 79/83 pools', now: T0 });
    const h = await readHealth({ now: T0 + 60_000 });
    assert.equal(h.spot.okAt, T0_S);
    assert.equal(h.spot.lastOk, true);
    assert.equal(h.spot.stale, false);
    assert.equal(h.spot.detail, 'read 79/83 pools');
  });

  test('a failure is recorded without moving the last good time', async () => {
    await noteRun('spot', { ok: false, detail: '429', now: T0 + 4 * 3600_000 });
    const h = await readHealth({ now: T0 + 4 * 3600_000 });
    assert.equal(h.spot.lastOk, false);
    assert.equal(h.spot.lastAt, T0_S + 4 * 3600);
    assert.equal(h.spot.okAt, T0_S, 'a failed run must not count as collecting');
  });

  test('and goes stale once failures outlast the window', async () => {
    const late = T0 + (STALE_AFTER_S + 60) * 1000;
    await noteRun('spot', { ok: false, detail: '504', now: late });
    assert.equal((await readHealth({ now: late })).spot.stale, true);
  });

  test('writing twice updates the row rather than failing on its key', async () => {
    await noteRun('gmx', { ok: true, now: T0 });
    await noteRun('gmx', { ok: true, now: T0 + 1000 });
    assert.equal((await readHealth({ now: T0 + 1000 })).gmx.okAt, T0_S + 1);
  });
});

describe('what the source line says', () => {
  const NOW = T0_S + 2 * 3600;

  test('fresh: when it was actually collected', () => {
    const line = collectedText('spot', { spot: { okAt: T0_S, stale: false } }, NOW);
    assert.deepEqual(line, { text: 'collected 2h ago', stale: false });
  });

  test('stale: a warning, with how long it has been', () => {
    const line = collectedText('spot', { spot: { okAt: NOW - 3 * 86_400, stale: true } }, NOW);
    assert.equal(line.stale, true);
    assert.match(line.text, /last collected 3d ago — collection is failing/);
  });

  test('never collected says so', () => {
    assert.match(collectedText('gmx', { gmx: { okAt: null, stale: true } }, NOW).text, /not collected yet/);
  });

  test('no record at all claims nothing, rather than guessing', () => {
    assert.equal(collectedText('spot', null, NOW), null);
    assert.equal(collectedText('spot', {}, NOW), null);
  });

  test('the card no longer passes off its own fetch time as a collection time', () => {
    const view = readFileSync(new URL('../src/ui/views/cryptoWhales.js', import.meta.url), 'utf8');
    assert.doesNotMatch(view, /updated \$\{ago\(Math\.floor\(loadedAt/, 'the old "updated 1 minute ago"');
    assert.doesNotMatch(view, /every 10 minutes/, 'a schedule the collector does not keep');
    assert.match(view, /collectedText\('spot'/);
    assert.match(view, /collectedText\('gmx'/);
  });
});

describe('a collector that cannot collect fails in red', () => {
  const whales = readFileSync(new URL('../api/_panels/whales.js', import.meta.url), 'utf8');
  const yml = readFileSync(new URL('../.github/workflows/collect-whales.yml', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/collect-spot.mjs', import.meta.url), 'utf8');

  test('the poll answers 503 when the database will not take its record', () => {
    assert.match(whales, /fail\(res, 503, `The database did not take the collector's record/);
  });

  test('and records every job it ran', () => {
    for (const job of ['transfers', 'holders', 'gmx']) {
      assert.match(whales, new RegExp(`health\\.noteRun\\('${job}'`), job);
    }
    assert.match(whales, /health\.noteRun\('spot'/);
  });

  test('the workflow turns a non-200 into a failed run, not a warning', () => {
    assert.match(yml, /::error::the collector answered \$code[^\n]*\n\s*exit 1/);
  });

  test('the spot runner fails when the server cannot plan or store', () => {
    assert.match(runner, /::error::spot: could not/);
    assert.match(runner, /process\.exit\(1\)/);
  });

  test('and reports its run, so the server can record it', () => {
    assert.match(runner, /report: i === 0 \? \{ read, pools: pools\.length, failed: failures\.length \}/);
  });
});
