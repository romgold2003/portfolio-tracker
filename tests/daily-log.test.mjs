/**
 * The daily log beside the home chart: every trading day's return, by year.
 *
 * Read off the same history as the chart. Checked on Romy's real statement to
 * 14 October 2026: 197 trading days compounding to +28.84% against IBKR's own
 * time-weighted +28.53%.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dailyReturns, yearsOf, yearView } from '../src/core/dailyLog.js';
import { parseIbkrStatement } from '../src/features/ibkr.js';

const row = (date, value, externalCashFlow = 0) => ({ date, totalAccountValue: value, externalCashFlow });

describe('a day\'s return', () => {
  test('is the move from the previous trading day\'s close', () => {
    const days = dailyReturns([row('2026-10-12', 1000), row('2026-10-13', 1010), row('2026-10-14', 999.9)]);
    assert.deepEqual(days.map((d) => d.date), ['2026-10-13', '2026-10-14']);
    assert.ok(Math.abs(days[0].pct - 1) < 1e-9);
    assert.ok(Math.abs(days[1].pnl - -10.1) < 1e-9);
  });

  test('a deposit is not a gain', () => {
    const [d] = dailyReturns([row('2026-10-12', 1000), row('2026-10-13', 2010, 1000)]);
    assert.ok(Math.abs(d.pnl - 10) < 1e-9);
    // Counted as arriving halfway through the day, as IBKR does: 10 / (1000 + 500).
    assert.ok(Math.abs(d.pct - 10 / 15) < 1e-9);
    assert.equal(d.flow, 1000);
  });

  test('weekends and holidays are not days, and money landing on one counts on the next', () => {
    const days = dailyReturns([
      row('2026-10-09', 1000), // Friday
      row('2026-10-10', 1000, 500), // Saturday: a deposit settles
      row('2026-10-11', 1500),
      row('2026-10-12', 1515), // Monday
    ]);
    assert.deepEqual(days.map((d) => d.date), ['2026-10-12']);
    assert.ok(Math.abs(days[0].pnl - 15) < 1e-9);
  });

  test('the first trading day of the year is measured from the opening balance on 1 January', () => {
    const [d] = dailyReturns([row('2026-01-01', 1000), row('2026-01-02', 1020)]);
    assert.equal(d.date, '2026-01-02');
    assert.ok(Math.abs(d.pct - 2) < 1e-9);
  });

  test('a day joins once its session has closed, so today waits for four o\'clock', () => {
    const rows = [row('2026-10-14', 1000), row('2026-10-15', 1010), row('2026-10-16', 1020)];
    assert.deepEqual(dailyReturns(rows, { through: '2026-10-15' }).map((d) => d.date), ['2026-10-15']);
  });
});

describe('a year in the window', () => {
  const rows = [
    row('2025-12-31', 1000),
    row('2026-01-02', 1100), row('2026-01-05', 1210),
    row('2026-02-02', 1089), row('2026-02-03', 1100),
  ];
  const days = dailyReturns(rows);

  test('lists the years newest first', () => {
    assert.deepEqual(yearsOf(days), [2026]);
  });

  test('months newest first, days newest first, returns compounded', () => {
    const v = yearView(days, 2026);
    assert.deepEqual(v.months.map((m) => m.label), ['February', 'January']);
    assert.deepEqual(v.months[1].days.map((d) => d.date), ['2026-01-05', '2026-01-02']);
    assert.ok(Math.abs(v.months[1].pct - 21) < 1e-9, 'two +10% days are +21%');
    assert.ok(Math.abs(v.pct - 10) < 1e-9);
    assert.equal(v.up, 3);
    assert.equal(v.down, 1);
    assert.equal(v.worst.date, '2026-02-02');
  });
});

describe('the window', () => {
  test('green for up, red for down, the amounts hidden when the eye says so', async () => {
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    const { dailyLogHtml } = await import('../src/ui/views/dailyLog.js');
    const html = dailyLogHtml(dailyReturns([row('2026-10-12', 1000), row('2026-10-13', 1010), row('2026-10-14', 1000)]), 2026);
    assert.match(html, /class="dl-day is-up"[\s\S]*?\+1\.00%[\s\S]*?\+\$10\.00/);
    assert.match(html, /class="dl-day is-down"[\s\S]*?−0\.99%/);
    assert.match(html, /data-year="2026"/);
  });

  test('sits under the timeframe buttons and is redrawn with the home page', () => {
    const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const side = page.slice(page.indexOf('class="tf-side"'));
    assert.ok(side.indexOf('id="tfRow"') < side.indexOf('id="dailyLogBtn"'));
    assert.match(readFileSync(new URL('../src/ui/views/home.js', import.meta.url), 'utf8'), /renderDailyLog\(\);/);
    assert.match(readFileSync(new URL('../src/app/actions.js', import.meta.url), 'utf8'), /toggleAmounts, toggleDailyLog,/);
  });
});

describe('a split written in French', () => {
  test('"Division 1 pour 3" is ETHA\'s 1-for-3, as "Split 1 for 3" would be', () => {
    const csv = [
      "Opérations sur titres,Header,Catégorie d'actifs,Devise,Compte,Date du rapport,Date/Heure,Description,Quantité,Produit,Valeur,P/L réalisé,Code",
      'Opérations sur titres,Data,Actions,USD,U1,2026-10-06,"2026-10-05, 20:25:00","ETHA(US46438R1059) Division 1 pour 3 (ETHA, ISHARES ETHEREUM TRUST ETF, US46438R2040)",22,0,0,0,',
      'Opérations sur titres,Data,Actions,USD,U1,2026-10-06,"2026-10-05, 20:25:00","ETHA(US46438R1059) Division 1 pour 3 (ETHA.OLD, ISHARES ETHEREUM TRUST ETF, US46438R1059)",-66,0,0,0,',
      // Copied from the statement: an import needs something held.
      "Positions ouvertes,Header,DataDiscriminator,Catégorie d'actifs,Devise,Symbole,Quantité,Mult,Coût,Coût d'acquisition,Cours de clôture,Valeur,P/L non réalisé,Code",
      'Positions ouvertes,Data,Summary,Actions,USD,ETHA,22,1,45.018511818,990.40726,54.89,1207.58,217.17274,',
    ].join('\n');
    const { splits } = parseIbkrStatement(csv);
    assert.deepEqual(splits, [{ ticker: 'ETHA', date: '2026-10-05', at: '2026-10-05 20:25:00', ratio: 1 / 3 }]);
  });
});
