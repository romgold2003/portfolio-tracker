/**
 * The chart's % view: the account's return since the window began, day by day
 * (October 2026). Romy's condition was that it agree with the statements, since
 * an earlier attempt at a percentage curve "was completely off".
 *
 * Two halves. The first pins the arithmetic on small books built here. The
 * second rebuilds the real account from the real statements and real closes,
 * as the app does, and checks the curve against every time-weighted return IBKR
 * printed: thirteen statements from 28 August to 14 October 2026, and the years
 * 2024 and 2025. It needs the statements on this machine and Yahoo reachable,
 * and no-ops otherwise.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';

import { returnCurve } from '../src/core/returnCurve.js';
import { buildPortfolioHistory, periodReturnFromHistory, asTradedClose } from '../src/core/portfolioHistory.js';
import { parseIbkrStatement } from '../src/features/ibkr.js';
import {
  statementRecord, withStatements, journalFromStatements, allSplits, openingMarksByYear,
} from '../src/features/statementLibrary.js';
import { historySymbol, closeOnOrBefore } from '../src/services/history.js';

const day = (date, value, flow = 0) => ({ date, totalAccountValue: value, externalCashFlow: flow });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

describe('the arithmetic', () => {
  test('a deposit lifts the value and not the return', () => {
    const curve = returnCurve([day('2026-01-01', 1000), day('2026-01-02', 1100), day('2026-01-03', 6100, 5000), day('2026-01-04', 6710)]);
    assert.deepEqual(curve.map((p) => +p.pct.toFixed(6)), [0, 10, 10, 21]);
  });

  test('a withdrawal neither', () => {
    const curve = returnCurve([day('2026-01-01', 1000), day('2026-01-02', 500, -500)]);
    assert.equal(curve[1].pct, 0);
  });

  test('a window is measured from the close before it opens, as the KPI is', () => {
    const rows = [day('2026-03-01', 100), day('2026-03-02', 110), day('2026-03-03', 121), day('2026-03-04', 108.9)];
    const curve = returnCurve(rows, '2026-03-03');
    assert.deepEqual(curve.map((p) => p.date), ['2026-03-02', '2026-03-03', '2026-03-04']);
    assert.ok(near(curve.at(-1).pct, periodReturnFromHistory(rows, '2026-03-03', '2026-03-04').returnPct, 1e-12));
    assert.ok(near(curve.at(-1).pct, -1, 1e-9));
  });

  test('All begins on the first day with money in it', () => {
    const curve = returnCurve([day('2024-01-01', 0), day('2024-01-02', 0), day('2024-01-03', 500, 500), day('2024-01-04', 550)]);
    assert.equal(curve[0].date, '2024-01-03');
    assert.ok(near(curve.at(-1).pct, 10, 1e-9));
  });

  test('nothing to draw from nothing', () => {
    assert.deepEqual(returnCurve([]), []);
    assert.deepEqual(returnCurve([day('2026-01-01', 0)]), []);
  });
});

describe('the buttons', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const actions = readFileSync(new URL('../src/app/actions.js', import.meta.url), 'utf8');
  test('$ and %, side by side on the chart', () => {
    assert.match(html, /<div class="curve-modes"[^>]*>\s*<button class="curve-mode active" data-mode="\$" onclick="setCurveMode\('\$'\)"[^>]*>\$<\/button>\s*<button class="curve-mode" data-mode="%" onclick="setCurveMode\('%'\)"[^>]*>%<\/button>/);
    assert.match(actions, /toggleAmounts, toggleDailyLog, setCurveMode,/);
  });

  test('% is the account since it began: it shows All, and a shorter window goes back to $', () => {
    assert.match(actions, /if \(ui\.curveMode === '%' && ui\.timeframe !== 'All'\) setTimeframe\('All'\)/);
    assert.match(actions, /if \(tf !== 'All'\) ui\.curveMode = '\$';/);
    assert.match(readFileSync(new URL('../src/core/snapshots.js', import.meta.url), 'utf8'), /export function percentSeries\(\) \{\s*const points = returnCurve\(forward\);/);
  });
});

/* ───────────────────────── the real account ───────────────────────── */

const PLACES = ['C:/Users/User/OneDrive - Reichman University/Desktop', 'C:/Users/User/Downloads'];
const locate = (name) => PLACES.map((p) => `${p}/${name}`).find((f) => existsSync(f));

function unzipFirst(path) {
  const buf = readFileSync(path);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1;
  const central = buf.readUInt32LE(end + 16);
  const method = buf.readUInt16LE(central + 10);
  const size = buf.readUInt32LE(central + 20);
  const local = buf.readUInt32LE(central + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
}

/** Closes and splits as /api/history returns them, cached for the day. */
async function prices(symbols) {
  const cache = `${tmpdir()}/return-curve-prices-${new Date().toISOString().slice(0, 10)}.json`;
  const out = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : {};
  for (const sym of symbols) {
    if (out[sym]) continue;
    const to = Math.floor(Date.now() / 1000);
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${to - 3 * 366 * 86400}&period2=${to}&interval=1d&events=split`,
      { headers: { 'User-Agent': 'portfolio-tracker' } });
    const r = (await res.json())?.chart?.result?.[0];
    const rows = [];
    (r?.timestamp ?? []).forEach((s, i) => {
      const close = r.indicators.quote[0].close[i];
      if (close > 0) rows.push({ date: new Date(s * 1000).toISOString().slice(0, 10), close });
    });
    const splits = Object.values(r?.events?.splits ?? {}).map((s) => ({
      date: new Date(s.date * 1000).toISOString().slice(0, 10), numerator: s.numerator, denominator: s.denominator,
    })).sort((a, b) => a.date.localeCompare(b.date));
    out[sym] = { rows, splits };
  }
  writeFileSync(cache, JSON.stringify(out));
  return out;
}

/** The daily history the home page builds from these statements (home.js, loadBackfill). */
async function walk(parsedList) {
  const records = withStatements([], parsedList.map(statementRecord));
  const journal = journalFromStatements(records, {});
  const { ledger } = journal;
  const applied = allSplits(records);
  const tickers = [...new Set([...Object.keys(ledger.openingHoldings ?? {}), ...Object.keys(ledger.holdings ?? {}),
    ...(ledger.events ?? []).map((e) => e.ticker)].filter(Boolean))];
  const symbolOf = (t) => historySymbol(t, journal.positions?.find((p) => p.ticker === t)?.cls);
  const px = await prices(tickers.map(symbolOf));

  const marks = {};
  for (const [t, p] of Object.entries(ledger.openingMarks ?? {})) if (p > 0) marks[t] = [{ date: ledger.from, price: p }];
  for (const [t, list] of Object.entries(openingMarksByYear(records))) (marks[t] ??= []).push(...list.filter((m) => m.date >= ledger.from));
  for (const e of ledger.events ?? []) if (e.kind === 'trade' && e.price > 0 && e.ticker) (marks[e.ticker] ??= []).push({ date: e.date, price: e.price });
  for (const list of Object.values(marks)) list.sort((a, b) => a.date.localeCompare(b.date));

  return buildPortfolioHistory({
    opening: { date: ledger.from, cash: ledger.openingCash, holdings: ledger.openingHoldings },
    events: ledger.events,
    priceOn: (t, d) => {
      const s = px[symbolOf(t)];
      if (!s?.rows.length) return null;
      return asTradedClose(closeOnOrBefore(s.rows, d), d, s.splits, applied.filter((a) => a.ticker === t));
    },
    lastKnown: marks,
    from: ledger.from,
    to: ledger.to,
  });
}

const latest = locate('MULTI_20260101_20261014.csv');
const online = async () => {
  try { return (await fetch('https://query1.finance.yahoo.com', { method: 'HEAD' })).status > 0; } catch { return false; }
};

describe('against the real statements', async () => {
  const ready = latest && await online();

  test('2026 to date: every statement Romy downloaded, within a tenth of a point of IBKR', { skip: !ready }, async () => {
    const rows = await walk([parseIbkrStatement(readFileSync(latest, 'utf8'))]);
    const curve = new Map(returnCurve(rows, '2026-01-01').map((p) => [p.date, p.pct]));
    const statements = readdirSync(PLACES[1]).filter((f) => /^MULTI_20260101_\d{8}\.csv$/.test(f))
      .map((f) => parseIbkrStatement(readFileSync(`${PLACES[1]}/${f}`, 'utf8')))
      .filter((p) => p.twr != null);
    statements.push(parseIbkrStatement(readFileSync(latest, 'utf8')));
    assert.ok(statements.length >= 2);
    for (const s of statements) {
      const pct = curve.get(s.periodEnd);
      assert.ok(near(pct, s.twr, 0.1), `${s.periodEnd}: curve ${pct?.toFixed(3)}% vs IBKR ${s.twr.toFixed(3)}%`);
    }
    // 14 October 2026: IBKR +28.53%.
    assert.ok(near(curve.get('2026-10-14'), 28.5297, 0.1));
  });

  const zips = [locate('Annuals.2024 (1).zip') ?? locate('Annuals.2024.zip'), locate('Annuals.2025.zip')];
  test('2024, 2025, and the account since it began, each within a tenth or two of IBKR', { skip: !(ready && zips.every(Boolean)) }, async () => {
    const [y2024, y2025] = zips.map((z) => parseIbkrStatement(unzipFirst(z)));
    const rows = await walk([y2024, y2025, parseIbkrStatement(readFileSync(latest, 'utf8'))]);
    const year = (y) => returnCurve(rows.filter((r) => r.date <= `${y}-12-31`), `${y}-01-01`).at(-1).pct;
    assert.ok(near(year(2025), y2025.twr, 0.1), `2025: curve ${year(2025).toFixed(2)}% vs IBKR ${y2025.twr}%`);
    // 2024 opened at nothing, so the curve starts the day money first arrived.
    const first = returnCurve(rows.filter((r) => r.date <= '2024-12-31')).at(-1).pct;
    assert.ok(near(first, y2024.twr, 0.05), `2024: curve ${first.toFixed(2)}% vs IBKR ${y2024.twr}%`);
    // Each year opens on the balance IBKR states. TBH, which has no price
    // history, opened 2026 $135 high before each year's marks were used.
    const on = (d) => rows.find((r) => r.date === d).totalAccountValue;
    assert.ok(near(on('2025-12-31'), y2025.navChange.endNav, 5), `31 Dec 2025: ${on('2025-12-31')} vs ${y2025.navChange.endNav}`);
    // 2026 within the whole history, as the year inside All, matches as well.
    const y2026 = returnCurve(rows, '2026-01-01').at(-1).pct;
    assert.ok(near(y2026, 28.5297, 0.1), `2026 inside All: ${y2026.toFixed(3)}%`);
    // The % view: the three years compounded, as IBKR's own since-inception figure.
    const all = returnCurve(rows).at(-1).pct;
    const ibkr = ((1 + y2024.twr / 100) * (1 + y2025.twr / 100) * 1.285297 - 1) * 100;
    assert.ok(near(all, ibkr, 0.2), `since the account began: ${all.toFixed(2)}% vs IBKR ${ibkr.toFixed(2)}%`);
  });
});
