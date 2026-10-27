/**
 * Earnings and revenue on the News page, beside the Fed (October 2026): the
 * companies Romy ticks from Nasdaq's list, alphabetical, and for each what it
 * last reported and when it reports next.
 *
 * The parsers are checked on real answers saved on 27 October 2026: Yahoo for
 * Microsoft (reporting the next day), Tesla (reported on the 21st) and ASML
 * (reports in euros), and a slice of Nasdaq's directory.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readCompany, readRevenueSeries, readNasdaqListed } from '../api/_lib/earnings.js';

const yahoo = JSON.parse(readFileSync(new URL('./fixtures/earnings-yahoo.json', import.meta.url), 'utf8'));
const company = (s) => readCompany(s, yahoo[s].summary, readRevenueSeries(yahoo[s].series));
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

describe('one company, from Yahoo', () => {
  test('the last report: EPS against the estimate, revenue against the year before', () => {
    const t = company('TSLA');
    assert.equal(t.name, 'Tesla, Inc.');
    assert.deepEqual([t.last.quarter, t.last.periodEnd, t.last.reported], ['Q3 FY26', '2026-09-30', '2026-10-21']);
    assert.equal(t.last.eps, 0.48);
    assert.ok(near(t.last.epsSurprise, 6.4, 0.05));
    assert.equal(t.last.revenue, 28046000000);
    assert.equal(t.last.revenueYearAgo, 28095000000);
    assert.ok(near(t.last.revenueYoY, -0.17, 0.01));
  });

  test('the next report: its day, before the open or after the close, and what is expected', () => {
    const m = company('MSFT');
    assert.equal(m.last.quarter, 'Q4 FY26', 'Microsoft names its own fiscal quarter');
    assert.equal(m.next.date, '2026-10-28');
    assert.equal(m.next.session, 'after close');
    assert.equal(m.next.periodEnd, '2026-09-30');
    assert.ok(m.next.epsEst > 4 && m.next.revenueEst > 8e10);
  });

  test('no next report once the last one is the latest Yahoo knows', () => {
    assert.equal(company('TSLA').next, null);
  });

  test("a company's own currency: ASML reports in euros", () => {
    assert.equal(company('ASML').currency, 'EUR');
    assert.equal(company('MSFT').currency, 'USD');
  });

  test('nothing reported yet is no last report, not a zero', () => {
    const c = readCompany('NEW', { earnings: { earningsChart: { quarterly: [] } }, price: { longName: 'New Co' } });
    assert.equal(c.last, null);
    assert.equal(c.name, 'New Co');
  });
});

describe("Nasdaq's list", () => {
  const list = readNasdaqListed(readFileSync(new URL('./fixtures/nasdaqlisted-sample.txt', import.meta.url), 'utf8'));

  test('companies only: no funds, test issues, warrants or units', () => {
    const symbols = list.map((c) => c.s);
    for (const s of ['AAPL', 'GOOGL', 'GOOG', 'MSFT', 'NVDA', 'ASML', 'FLWS']) assert.ok(symbols.includes(s), s);
    for (const s of ['AAAP', 'ZWZZT', 'AACIU', 'ADACW', 'ENRDW']) assert.ok(!symbols.includes(s), s);
  });

  test('alphabetical by name, with the share class where a company lists two', () => {
    const names = list.map((c) => c.n);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    assert.deepEqual(list.filter((c) => c.n === 'Alphabet Inc.').map((c) => [c.s, c.c]), [['GOOG', 'C'], ['GOOGL', 'A']]);
    assert.equal(list.find((c) => c.s === 'MSFT').n, 'Microsoft Corporation');
    // One listing: its class says nothing.
    assert.deepEqual(list.find((c) => c.s === 'FLWS'), { s: 'FLWS', n: '1-800-FLOWERS.COM, Inc.' });
  });
});

describe('when Nasdaq does not answer the server', () => {
  test("the picker still has the list: the copy kept in the repository (Vercel's first day)", async () => {
    const { nasdaqCompanies } = await import('../api/_lib/earnings.js');
    const refused = async () => { throw new Error('fetch failed'); };
    const list = await nasdaqCompanies(refused);
    assert.ok(list.length > 3000, `${list.length} companies`);
    for (const s of ['GOOGL', 'GOOG', 'MSFT', 'AAPL', 'NVDA']) assert.ok(list.some((c) => c.s === s), s);
    const names = list.map((c) => c.n);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  });

  test('and says why when even that fails, rather than only that it did', () => {
    const view = readFileSync(new URL('../src/ui/views/earnings.js', import.meta.url), 'utf8');
    assert.match(view, /unavailable\('Nasdaq\\'s list is unavailable right now'\)/);
    assert.match(view, /\$\{why \? ` — \$\{escapeHtml\(why\)\}` : ''\}/);
  });
});

describe('the panel', () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };

  test('only the companies ticked: recent reports first, then the ones coming up', async () => {
    const { orderCompanies } = await import('../src/ui/views/earnings.js');
    const order = orderCompanies([company('MSFT'), company('ASML'), company('TSLA')], '2026-10-27').map((c) => c.symbol);
    assert.deepEqual(order, ['TSLA', 'MSFT', 'ASML']);
  });

  test('a company reads as figures, in its own currency, and against the estimate this device saw', async () => {
    const { companyHtml } = await import('../src/ui/views/earnings.js');
    const tsla = companyHtml(company('TSLA'), '2026-10-22');
    assert.match(tsla, /TSLA[\s\S]*Tesla, Inc\.[\s\S]*class="earn-new">New/);
    assert.match(tsla, /EPS<\/span> <b>\$0\.48<\/b> <span class="earn-muted">vs \$0\.45 est<\/span> <span class="is-up">\+6\.4%<\/span>/);
    assert.match(tsla, /Revenue<\/span> <b>\$28\.0B<\/b> <span class="is-down">−0\.2% y\/y<\/span>/);
    const withEst = companyHtml(company('TSLA'), '2026-10-27', { rev: 29.3e9 });
    assert.match(withEst, /vs \$29\.3B est<\/span> <span class="is-down">−4\.3%/);
    assert.doesNotMatch(withEst, /earn-new/, 'six days on, no longer new');
    assert.match(companyHtml(company('ASML'), '2026-10-27'), /<b>€11\.7B<\/b>/);
    assert.match(companyHtml(company('MSFT'), '2026-10-27'), /Next<\/span> 28 Oct after close · EPS est \$4\.72 · Revenue est \$90\.7B/);
  });

  test('the picker: Nasdaq alphabetical, searchable by name or ticker, ticked as chosen', async () => {
    const { optionsHtml } = await import('../src/ui/views/earnings.js');
    const list = [{ s: 'GOOGL', n: 'Alphabet Inc.', c: 'A' }, { s: 'AAPL', n: 'Apple Inc.' }, { s: 'MSFT', n: 'Microsoft Corporation' }];
    const all = optionsHtml(list, ['MSFT']);
    assert.deepEqual([...all.matchAll(/data-s="(\w+)"/g)].map((m) => m[1]), ['GOOGL', 'AAPL', 'MSFT']);
    assert.match(all, /data-s="MSFT" checked/);
    assert.match(all, /Alphabet Inc\. <span class="earn-muted">· Class A/);
    assert.deepEqual([...optionsHtml(list, [], 'micro').matchAll(/data-s="(\w+)"/g)].map((m) => m[1]), ['MSFT']);
    assert.deepEqual([...optionsHtml(list, [], 'goo').matchAll(/data-s="(\w+)"/g)].map((m) => m[1]), ['GOOGL']);
  });

  test('the companies chosen are kept with the sign-in', async () => {
    const { state, loadState, journalSnapshot, setEarningsWatch } = await import('../src/core/store.js');
    loadState({ positions: [], cash: 0 });
    setEarningsWatch(['googl', 'MSFT', 'MSFT', 'not a ticker!']);
    assert.deepEqual(state.earningsWatch, ['GOOGL', 'MSFT']);
    loadState(JSON.parse(JSON.stringify(journalSnapshot())));
    assert.deepEqual(state.earningsWatch, ['GOOGL', 'MSFT']);
  });

  test('it sits in the Fed card, where the space beside the odds was', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const card = html.slice(html.indexOf('id="fedCard"'), html.indexOf('id="econCard"'));
    assert.match(card, /id="fedMain"[\s\S]*id="earnPane"[\s\S]*id="earnPickBtn"[^>]*>Companies/);
  });

  test('served by the News function, so the deployment stays within its twelve', () => {
    assert.match(readFileSync(new URL('../api/news/[panel].js', import.meta.url), 'utf8'), /earnings: \(\) => import\('\.\.\/_panels\/earnings\.js'\)/);
    assert.match(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'), /"source": "\/api\/earnings",\s*"destination": "\/api\/news\/earnings"/);
    assert.match(readFileSync(new URL('../scripts/dev-cloud.mjs', import.meta.url), 'utf8'), /'\/api\/earnings': '\.\.\/api\/_panels\/earnings\.js'/);
  });
});
