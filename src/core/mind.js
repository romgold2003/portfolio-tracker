/**
 * State of mind at entry (November 2026): each trade can carry how the trader
 * felt when they took it, from 1 (emotional, greedy, chasing) to 10 (calm and
 * confident in the plan). It is what a journal knows and a spreadsheet does
 * not — and the payoff is seeing whether the confident trades actually do
 * better than the emotional ones.
 *
 * Pure: no DOM, no storage.
 */
import { realized, costOf, outcomeOf } from './portfolio.js';

/** A score as stored: a whole number from 1 to 10, or null for not rated. */
export function cleanMind(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/** The words for a score. */
export function mindLabel(score) {
  if (score == null) return 'Not rated';
  if (score <= 2) return 'Emotional / greedy';
  if (score <= 4) return 'Impulsive';
  if (score <= 6) return 'Hesitant';
  if (score <= 8) return 'Fairly confident';
  return 'Confident';
}

/** The three groups results are compared across. */
export const MIND_GROUPS = [
  { id: 'emotional', label: 'Emotional (1–4)', min: 1, max: 4 },
  { id: 'hesitant', label: 'Hesitant (5–6)', min: 5, max: 6 },
  { id: 'confident', label: 'Confident (7–10)', min: 7, max: 10 },
];

/**
 * Closed trades by the state of mind they were taken in: how many, how many
 * won, the average return and the total profit of each group. Trades with no
 * score are counted apart, so the comparison is only ever between rated ones.
 */
export function mindStats(positions) {
  const groups = MIND_GROUPS.map((g) => ({ ...g, trades: 0, wins: 0, losses: 0, pnl: 0, returnSum: 0 }));
  let unrated = 0;
  for (const p of positions ?? []) {
    if (p?.status !== 'Closed') continue;
    const score = cleanMind(p.mind);
    if (score == null) { unrated += 1; continue; }
    const g = groups.find((x) => score >= x.min && score <= x.max);
    const pnl = realized(p);
    const staked = Math.abs(costOf(p));
    g.trades += 1;
    if (outcomeOf(pnl) === 'win') g.wins += 1;
    if (outcomeOf(pnl) === 'loss') g.losses += 1;
    g.pnl += pnl;
    if (staked > 0) g.returnSum += (pnl / staked) * 100;
  }
  return {
    unrated,
    groups: groups.map((g) => ({
      id: g.id,
      label: g.label,
      trades: g.trades,
      winRate: g.wins + g.losses ? (g.wins / (g.wins + g.losses)) * 100 : null,
      avgReturn: g.trades ? g.returnSum / g.trades : null,
      pnl: g.pnl,
    })),
  };
}
