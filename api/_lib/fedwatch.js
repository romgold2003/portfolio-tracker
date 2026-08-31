/**
 * What the market thinks the Fed will do next, from fed funds futures.
 *
 * This is the calculation behind the CME FedWatch tool, done here rather than
 * read from there. FedWatch itself is a licensed application with no public
 * feed, but the thing it is computed *from* is a published futures price, and
 * the method is arithmetic rather than a secret.
 *
 * A 30-day fed funds future settles against the average daily effective rate
 * over its contract month. So a month containing a meeting prices a blend: some
 * days at the old rate, the rest at whatever the meeting decides. Knowing the
 * rate going in, the month's length, and which day the decision lands on, the
 * only unknown is the rate coming out — and that is one line of algebra.
 *
 * Turning a rate into odds needs one assumption: that the committee moves in
 * quarter-point steps. An expected rate sitting a third of the way from "hold"
 * to "up 25" is the market pricing a one-in-three chance of the move, because
 * that is the only way an average lands there. This is the same assumption
 * FedWatch makes, and it is why both are probabilities of a *step* rather than
 * forecasts of a number.
 *
 * The numbers here will sit very close to FedWatch's but need not match to the
 * decimal: they anchor on the same futures and may pick a slightly different
 * starting rate.
 */

/**
 * Scheduled FOMC meetings, from the Federal Reserve's own calendar.
 *
 * Each is the day the decision is announced — the second day of a two-day
 * meeting. Dates beyond the current year are tentative until the Committee
 * confirms them, which is the Fed's own wording, not a hedge.
 *
 * https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 */
export const FOMC_MEETINGS = [
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09',
  '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08',
];

/** CME month codes, in calendar order. */
const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];

/** The 30-day fed funds contract for a year and month, as the feed names it. */
export function contractSymbol(year, month) {
  return `ZQ${MONTH_CODES[month - 1]}${String(year).slice(2)}.CBT`;
}

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The next scheduled decision on or after `today`. */
export function nextMeeting(today, meetings = FOMC_MEETINGS) {
  return meetings.find((d) => d >= today) ?? null;
}

/**
 * The rate the committee is expected to leave behind it.
 *
 * The contract month averages `entering` for every day up to and including the
 * announcement, and the new rate for the days after it — the change takes
 * effect the following day, so the day of the meeting is still the old rate.
 *
 * Returns null for a meeting on the last day of its month, where the contract
 * says nothing about the outcome because no day of it is affected.
 */
export function impliedRateAfter({ impliedAverage, entering, year, month, day }) {
  const total = daysInMonth(year, month);
  const after = total - day;
  if (after <= 0) return null;
  return (impliedAverage * total - entering * day) / after;
}

/**
 * Split an expected rate across the quarter-point steps either side of it.
 *
 * A rate landing exactly on a step is that step with certainty; one between two
 * is read as the market weighting them. Anything beyond a full step in either
 * direction is carried outward, so a heavily priced half-point shows as such
 * rather than saturating at 100% of a quarter.
 */
export function stepProbabilities(entering, expected, step = 0.25) {
  const moves = (expected - entering) / step;
  const lower = Math.floor(moves);
  const upper = Math.ceil(moves);

  if (lower === upper) return [{ steps: lower, probability: 1 }];

  const weight = moves - lower;
  return [
    { steps: lower, probability: 1 - weight },
    { steps: upper, probability: weight },
  ].filter((o) => o.probability > 0.0005);
}

/**
 * The three answers anyone actually asks: up, unchanged, or down.
 *
 * Every priced step is summed into its direction, so a market split between a
 * quarter and a half point reads as one confident "increase" rather than two
 * uncertain ones.
 */
export function outcomeOdds(entering, expected, step = 0.25) {
  const odds = { increase: 0, hold: 0, decrease: 0 };
  for (const { steps, probability } of stepProbabilities(entering, expected, step)) {
    if (steps > 0) odds.increase += probability;
    else if (steps < 0) odds.decrease += probability;
    else odds.hold += probability;
  }
  return odds;
}

/**
 * Everything the panel needs, from a set of contract prices.
 *
 * `prices` maps a contract symbol to its price. The entering rate is read from
 * the month before the meeting when that month holds no meeting of its own —
 * an undisturbed month averages the prevailing rate and so states it directly.
 * When the previous month does hold one, its own outcome is solved first and
 * carried forward, which is what makes back-to-back meetings work.
 */
export function readDecision({ today, prices, meetings = FOMC_MEETINGS, step = 0.25 }) {
  const meeting = nextMeeting(today, meetings);
  if (!meeting) return null;

  const [year, month, day] = meeting.split('-').map(Number);
  const rateOf = (y, m) => {
    const price = prices[contractSymbol(y, m)];
    return typeof price === 'number' && price > 0 && price < 100 ? 100 - price : null;
  };

  // Walk back to the most recent month with no meeting in it: that month's
  // average is the prevailing rate, undisturbed, and is the anchor.
  let anchorYear = year;
  let anchorMonth = month;
  const hasMeeting = (y, m) => meetings.some((d) => {
    const [my, mm] = d.split('-').map(Number);
    return my === y && mm === m;
  });

  for (let back = 0; back < 6; back++) {
    anchorMonth -= 1;
    if (anchorMonth === 0) { anchorMonth = 12; anchorYear -= 1; }
    if (!hasMeeting(anchorYear, anchorMonth)) break;
  }

  let entering = rateOf(anchorYear, anchorMonth);
  if (entering == null) return null;

  // Carry the anchor forward through any meetings between it and this one.
  for (const d of meetings) {
    if (d <= `${anchorYear}-${String(anchorMonth).padStart(2, '0')}-31`) continue;
    if (d >= meeting) break;
    const [my, mm, md] = d.split('-').map(Number);
    const avg = rateOf(my, mm);
    if (avg == null) return null;
    const next = impliedRateAfter({ impliedAverage: avg, entering, year: my, month: mm, day: md });
    if (next == null) continue;
    entering = next;
  }

  const impliedAverage = rateOf(year, month);
  if (impliedAverage == null) return null;

  const expected = impliedRateAfter({ impliedAverage, entering, year, month, day });
  if (expected == null) return null;

  return {
    meeting,
    entering: +entering.toFixed(4),
    expected: +expected.toFixed(4),
    changeBps: Math.round((expected - entering) * 10000) / 100,
    odds: outcomeOdds(entering, expected, step),
    steps: stepProbabilities(entering, expected, step),
  };
}

/** Which contracts have to be fetched to answer for the next meeting. */
export function requiredContracts(today, meetings = FOMC_MEETINGS) {
  const meeting = nextMeeting(today, meetings);
  if (!meeting) return [];
  const [year, month] = meeting.split('-').map(Number);

  const wanted = [];
  // The meeting month, and the five before it — enough to reach an undisturbed
  // month and carry it forward however the calendar falls.
  for (let back = 6; back >= 0; back--) {
    let y = year;
    let m = month - back;
    while (m <= 0) { m += 12; y -= 1; }
    wanted.push(contractSymbol(y, m));
  }
  return [...new Set(wanted)];
}
