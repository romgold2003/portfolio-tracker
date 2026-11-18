/**
 * Insights as feedback (November 2026): each finding read as something to
 * keep doing, to work on, or a lesson — facts and habits, never advice on
 * what to buy or sell.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FEEDBACK, feedbackFor } from '../src/core/insights.js';

const card = (id, tone, impact = 0) => ({ id, tone, impact, headline: `${id} ${tone}` });

test('a strength is to keep, a weakness to work on, the rest a lesson; the biggest first', () => {
  const f = feedbackFor([
    card('holding', 'bad', 300), card('after', 'bad', 900), card('twin', 'good'), card('months', 'neutral'),
  ]);
  assert.deepEqual(f.work.map((x) => x.id), ['after', 'holding']);
  assert.deepEqual(f.keep.map((x) => x.id), ['twin']);
  assert.deepEqual(f.lessons.map((x) => x.id), ['months']);
  assert.equal(f.work[0].meaning, FEEDBACK.after.bad[0]);
  assert.equal(f.work[0].habit, FEEDBACK.after.bad[1]);
});

test('a finding still short of data, or with nothing to say for its tone, is left out', () => {
  const f = feedbackFor([{ id: 'holding', tone: 'neutral', impact: 0 }, card('mood', 'bad'), card('unknown', 'good')]);
  assert.deepEqual([f.keep.length, f.work.length, f.lessons.length], [0, 0, 0]);
});

test('every card the engine makes has feedback for at least one tone', () => {
  const src = readFileSync(new URL('../src/core/insights.js', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/^\s+id: '([\w-]+)', group: '(?:habits|deeper)'/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 9);
  for (const id of ids) assert.ok(FEEDBACK[id], `no feedback for ${id}`);
});

test('the words describe the process, never what to buy or sell', () => {
  const words = Object.values(FEEDBACK).flatMap((tones) => Object.values(tones).flat()).filter(Boolean).join(' ');
  assert.doesNotMatch(words, /\b(you should (buy|sell)|buy more|sell now|recommend|guaranteed)\b/i);
});

test('Insights shows the feedback right after the summary', () => {
  const view = readFileSync(new URL('../src/ui/views/insights.js', import.meta.url), 'utf8');
  assert.match(view, /\$\{summaryHtml\(a\)\}\s*\$\{feedbackHtml\(a\)\}/);
  assert.match(view, /it never says what to buy or sell/);
});
