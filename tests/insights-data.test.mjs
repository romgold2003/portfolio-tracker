/**
 * The market history the analyst reads beside a person's trades (November
 * 2026): Fed decision days from the Fed's own calendar, the jobs report, and
 * CNN's Fear & Greed readings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFomc, releaseDays, fearGreedHistory, KNOWN_CPI, KNOWN_JOBS } from '../api/_panels/insights.js';

test('Fed decisions are the second day of each two-day meeting; notation votes are not', () => {
  const html = `<h4>2025 FOMC Meetings</h4>
    <div class="fomc-meeting__month"><strong>January</strong></div><div class="fomc-meeting__date">28-29</div>
    <div class="fomc-meeting__month"><strong>April/May</strong></div><div class="fomc-meeting__date">30-1</div>
    <div class="fomc-meeting__month"><strong>August</strong></div><div class="fomc-meeting__date">16 (notation vote)</div>
    <div class="fomc-meeting__month"><strong>December</strong></div><div class="fomc-meeting__date">9-10*</div>`;
  assert.deepEqual(parseFomc(html), ['2025-01-29', '2025-05-01', '2025-12-10']);
});

test('the jobs report is the real release day, not the first Friday', () => {
  assert.ok(KNOWN_JOBS.includes('2025-07-03'), 'a Thursday, before the 4 July holiday');
  assert.ok(KNOWN_JOBS.includes('2026-01-09'), 'the second Friday');
  assert.ok(KNOWN_JOBS.includes('2025-11-20') && !KNOWN_JOBS.includes('2025-10-03'), 'moved by the shutdown');
  assert.deepEqual([...new Set(KNOWN_JOBS)].sort(), KNOWN_JOBS);
});

test('new releases are found on Nasdaq, filed under the next day', async () => {
  const fake = async (url) => {
    const date = new URL(url).searchParams.get('date');
    const rows = date === '2026-11-07' ? [{ country: 'United States', eventName: 'Nonfarm Payrolls' }]
      : date === '2026-11-11' ? [{ country: 'United States', eventName: 'CPI' }, { country: 'Japan', eventName: 'Nonfarm Payrolls' }] : [];
    return { ok: true, json: async () => ({ data: { rows } }) };
  };
  assert.deepEqual(await releaseDays(1, fake, new Date('2026-11-13T12:00:00Z')), { cpi: ['2026-11-10'], jobs: ['2026-11-06'] });
});

test('CNN\'s readings become one per day, oldest first', async () => {
  const fake = async () => ({ ok: true, json: async () => ({ fear_and_greed_historical: { data: [
    { x: Date.parse('2026-03-03T15:00:00Z'), y: 21.6 },
    { x: Date.parse('2026-03-02T15:00:00Z'), y: 30.2 },
    { x: Date.parse('2026-03-03T21:00:00Z'), y: 24.1 },
  ] } }) });
  assert.deepEqual(await fearGreedHistory('2026-03-01', fake), [{ date: '2026-03-02', value: 30 }, { date: '2026-03-03', value: 24 }]);
});

test('past CPI days are sorted and unique', () => {
  assert.deepEqual([...new Set(KNOWN_CPI)].sort(), KNOWN_CPI);
});
