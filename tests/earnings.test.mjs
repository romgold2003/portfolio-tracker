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

import { readCompany, readRevenueSeries, readListings } from '../api/_lib/earnings.js';

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

  test('the coming quarter is forecast even before its day is set', () => {
    const next = company('TSLA').next;
    assert.equal(next.date, null, 'Tesla had no next day on 27 October');
    assert.equal(next.periodEnd, '2026-12-31');
    assert.ok(next.revenueEst > 2e10 && next.epsEst > 0);
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

describe('the companies to choose from: Nasdaq, the NYSE and NYSE American', () => {
  const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const list = readListings({ nasdaq: fixture('nasdaqlisted-sample.txt'), other: fixture('otherlisted-sample.txt') });
  const symbols = list.map((c) => c.s);

  test('companies only: no funds, test issues, warrants, units, preferred shares or bonds', () => {
    for (const s of ['AAPL', 'GOOGL', 'GOOG', 'MSFT', 'NVDA', 'ASML', 'FLWS']) assert.ok(symbols.includes(s), s);
    for (const s of ['AAAP', 'ZWZZT', 'AACIU', 'ADACW', 'ENRDW']) assert.ok(!symbols.includes(s), s);
    for (const s of ['SPY', 'ABR$D', 'AAC.U', 'AAC.W', 'ELC']) assert.ok(!symbols.includes(s), s);
  });

  test('the NYSE too: Oracle was missing from a list of Nasdaq alone (October 2026)', () => {
    assert.deepEqual(list.find((c) => c.s === 'ORCL'), { s: 'ORCL', n: 'Oracle Corporation', x: 'NYSE' });
    assert.equal(list.find((c) => c.s === 'KO').n, 'Coca-Cola Company (The)');
    assert.equal(list.find((c) => c.s === 'TNL').n, 'Travel Leisure Co.');
    assert.equal(list.find((c) => c.s === 'MSFT').x, 'Nasdaq');
  });

  test('alphabetical by name, with the share class where a company lists two', () => {
    const names = list.map((c) => c.n);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    assert.deepEqual(list.filter((c) => c.n === 'Alphabet Inc.').map((c) => [c.s, c.c]), [['GOOG', 'C'], ['GOOGL', 'A']]);
    assert.deepEqual(list.filter((c) => c.n === 'Berkshire Hathaway Inc.').map((c) => [c.s, c.c]), [['BRK.A', 'A'], ['BRK.B', 'B']]);
    // One listing: its class says nothing.
    assert.deepEqual(list.find((c) => c.s === 'FLWS'), { s: 'FLWS', n: '1-800-FLOWERS.COM, Inc.', x: 'Nasdaq' });
  });

  test('a class share is asked of Yahoo the way Yahoo writes it: BRK.B as BRK-B', async () => {
    const { companyEarnings } = await import('../api/_lib/earnings.js');
    const asked = [];
    const fetcher = async (url) => {
      asked.push(url);
      if (url.includes('fc.yahoo.com')) return new Response('', { status: 404, headers: { 'set-cookie': 'A3=x; Path=/' } });
      if (url.includes('getcrumb')) return new Response('crumb1');
      return new Response(JSON.stringify({ quoteSummary: { result: [{ price: { longName: 'Berkshire Hathaway Inc.' } }] } }));
    };
    const c = await companyEarnings('BRK.B', fetcher);
    assert.equal(c.symbol, 'BRK.B');
    assert.ok(asked.some((u) => u.includes('/quoteSummary/BRK-B?')), asked.join('\n'));
  });
});

describe('when Nasdaq does not answer the server', () => {
  test("the picker still has the list: the copy kept in the repository (Vercel's first day)", async () => {
    const { listedCompanies } = await import('../api/_lib/earnings.js');
    const refused = async () => { throw new Error('fetch failed'); };
    const list = await listedCompanies(refused);
    assert.ok(list.length > 5000, `${list.length} companies`);
    for (const s of ['GOOGL', 'GOOG', 'MSFT', 'AAPL', 'NVDA', 'ORCL', 'BRK.B', 'JPM']) assert.ok(list.some((c) => c.s === s), s);
    const names = list.map((c) => c.n);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  });

  test('and says why when even that fails, rather than only that it did', () => {
    const view = readFileSync(new URL('../src/ui/views/earnings.js', import.meta.url), 'utf8');
    assert.match(view, /unavailable\('The list of companies is unavailable right now'\)/);
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

  // What Romy asked for (27 October 2026): the forecast; the actual beside it
  // for seven days once released; then the next forecast alone.
  const cells = (html) => [...html.matchAll(/<span class="earn-k">(\w+)<\/span>\s*<span class="earn-fc">([^<]*)<\/span>\s*<span class="earn-act">([\s\S]*?)<\/span>\s*(?=<span class="earn-k">|<\/div>)/g)]
    .map((m) => [m[1], m[2], m[3].replace(/<[^>]+>/g, '').trim()]);

  test('before the report: the forecast, and no actual yet', async () => {
    const { companyHtml } = await import('../src/ui/views/earnings.js');
    const msft = companyHtml(company('MSFT'), '2026-10-27');
    assert.match(msft, /Next report<\/span> <b>Wed 28 Oct 2026<\/b> · after close/);
    assert.deepEqual(cells(msft), [['Revenue', '$90.7B', '—'], ['EPS', '$4.72', '—']]);
  });

  test('for seven days after it: the actual beside the forecast kept from before', async () => {
    const { companyHtml } = await import('../src/ui/views/earnings.js');
    const kept = { 'TSLA|2026-09-30': { rev: 29.3e9, eps: 0.5 } };
    const tsla = companyHtml(company('TSLA'), '2026-10-22', kept);
    assert.match(tsla, /class="earn-new">Released<\/span><span class="earn-when">21 Oct · Q3 FY26/);
    // Revenue against the forecast kept; EPS against Yahoo's consensus at the report.
    assert.deepEqual(cells(tsla), [['Revenue', '$29.3B', '$28.0B −4.3%'], ['EPS', '$0.451', '$0.48 +6.4%']]);
    assert.deepEqual(cells(companyHtml(company('TSLA'), '2026-10-28', kept))[0], ['Revenue', '$29.3B', '$28.0B −4.3%'], 'day seven');
  });

  test('then it goes, and only the next forecast shows', async () => {
    const { companyHtml } = await import('../src/ui/views/earnings.js');
    const tsla = companyHtml(company('TSLA'), '2026-10-29');
    assert.doesNotMatch(tsla, /Released|\$28\.0B/);
    assert.match(tsla, /Next report<\/span> <span class="earn-muted">not announced yet/);
    assert.deepEqual(cells(tsla).map(([k, , a]) => [k, a]), [['Revenue', '—'], ['EPS', '—']]);
    assert.ok(cells(tsla).every(([, f]) => f !== '—'), 'the December quarter is forecast');
  });

  test('a company followed only after its report has no revenue forecast to show, and says so plainly', async () => {
    const { companyHtml } = await import('../src/ui/views/earnings.js');
    assert.deepEqual(cells(companyHtml(company('TSLA'), '2026-10-22'))[0], ['Revenue', '—', '$28.0B']);
  });

  test("figures exact enough to check against another site: SoFi's $1.264B and $0.1675", async () => {
    // At one decimal and two they read $1.3B and $0.17, and looked wrong
    // beside the $1.25B and $0.162 another site quoted (27 October 2026).
    const { companyHtml, money } = await import('../src/ui/views/earnings.js');
    const sofi = { symbol: 'SOFI', name: 'SoFi Technologies, Inc.', currency: 'USD', last: null,
      next: { date: '2026-10-27', session: 'before open', periodEnd: '2026-09-30', epsEst: 0.16752, revenueEst: 1264367430 } };
    assert.deepEqual(cells(companyHtml(sofi, '2026-10-26')), [['Revenue', '$1.26B', '—'], ['EPS', '$0.168', '—']]);
    assert.equal(money(90735945570), '$90.7B');
    assert.equal(money(412e6), '$412M');
  });

  test('the day of the next report under the figures, while the last one is still shown too', async () => {
    const { companyHtml } = await import('../src/ui/views/earnings.js');
    const kept = { 'TSLA|2026-09-30': { rev: 29.3e9 } };
    const tsla = { ...company('TSLA'), next: { ...company('TSLA').next, date: '2027-01-27', session: 'after close' } };
    const html = companyHtml(tsla, '2026-10-22', kept);
    assert.match(html, /Released[\s\S]*Next report<\/span> <b>Wed 27 Jan 2027<\/b> · after close/);
    const unconfirmed = { ...tsla, next: { ...tsla.next, estimated: true, session: null } };
    assert.match(companyHtml(unconfirmed, '2026-10-22', kept), /<b>Wed 27 Jan 2027<\/b> <span class="earn-muted">\(expected, not confirmed\)/);
  });

  test('in its own currency: ASML in euros', async () => {
    const { companyHtml } = await import('../src/ui/views/earnings.js');
    const kept = { 'ASML|2026-09-30': { rev: 11e9 } };
    assert.match(companyHtml(company('ASML'), '2026-10-15', kept), /<b>€11\.7B<\/b>/);
  });

  test('forecasts are kept with the sign-in, for the followed companies, and not rewritten on every poll', async () => {
    const { state, loadState, journalSnapshot, setEarningsWatch, rememberForecasts } = await import('../src/core/store.js');
    loadState({ positions: [], cash: 0 });
    setEarningsWatch(['MSFT']);
    rememberForecasts([company('MSFT'), company('TSLA')]);
    const key = 'MSFT|2026-09-30';
    assert.deepEqual(Object.keys(state.earningsForecasts), [key], 'Tesla is not followed');
    const before = state.earningsForecasts;
    rememberForecasts([company('MSFT')]);
    assert.equal(state.earningsForecasts, before, 'nothing moved, nothing written');
    loadState(JSON.parse(JSON.stringify(journalSnapshot())));
    assert.ok(state.earningsForecasts[key].rev > 8e10);
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
    // The exchange beside the ticker, so an NYSE company reads as one.
    const nyse = optionsHtml([{ s: 'ORCL', n: 'Oracle Corporation', x: 'NYSE' }], [], 'oracle');
    assert.match(nyse, /data-s="ORCL"[\s\S]*ORCL <span class="earn-opt-x">NYSE<\/span>/);
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
