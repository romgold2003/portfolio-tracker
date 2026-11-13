/**
 * The market history the analyst reads beside a person's trades (November
 * 2026): Fed decision days from the Fed's own calendar, the jobs report, and
 * CNN's Fear & Greed readings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFomc, jobsDays, fearGreedHistory, KNOWN_CPI } from '../api/_panels/insights.js';

test('Fed decisions are the second day of each two-day meeting; notation votes are not', () => {
  const html = `<h4>2025 FOMC Meetings</h4>
    <div class="fomc-meeting__month"><strong>January</strong></div><div class="fomc-meeting__date">28-29</div>
    <div class="fomc-meeting__month"><strong>April/May</strong></div><div class="fomc-meeting__date">30-1</div>
    <div class="fomc-meeting__month"><strong>August</strong></div><div class="fomc-meeting__date">16 (notation vote)</div>
    <div class="fomc-meeting__month"><strong>December</strong></div><div class="fomc-meeting__date">9-10*</div>`;
  assert.deepEqual(parseFomc(html), ['2025-01-29', '2025-05-01', '2025-12-10']);
});

test('the jobs report is the first Friday of each month', () => {
  assert.deepEqual(jobsDays('2026-01-01', '2026-03-31'), ['2026-01-02', '2026-02-06', '2026-03-06']);
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
