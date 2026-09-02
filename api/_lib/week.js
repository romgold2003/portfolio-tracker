/**
 * Which Monday-to-Sunday week a day belongs to.
 *
 * Shared because two unrelated things need the same answer: the economic
 * calendar reports a week, and a week-to-date price change is measured from the
 * close before one began.
 */

/**
 * The week containing `iso`, as ISO days.
 *
 * getUTCDay is 0 on Sunday, so the shift is written to put Sunday at the *end*
 * of the week that began six days earlier rather than at the start of the one
 * beginning tomorrow.
 */
export function weekOf(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - shift);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

/**
 * The New York calendar day right now.
 *
 * A price change measured "since Monday" means since the market's Monday. In
 * Israel it is already Tuesday for seven hours before New York agrees, and
 * using the local date there would move the reference a day early every week.
 */
export function newYorkDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
