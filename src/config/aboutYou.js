/**
 * The investor-profile questions (November 2026), so Romy can see who uses
 * Riskbook. Every one is optional. The answers are kept on the server apart
 * from the journal (api/_lib/about.js) — the journal stays encrypted and
 * unreadable to anyone but its owner; these are not.
 *
 * Worded and laid out the way a broker's own account questionnaire is: plain,
 * formal, one question a step. Four take several answers (`multi`): goals,
 * approach, how they heard of Riskbook, and employment.
 *
 * The option ids are what is stored; the server accepts exactly these
 * (tests/about-you.test.mjs keeps the two lists the same). A multiple answer
 * is stored as its ids joined by commas.
 */
/**
 * Which round of the questions this is. Every account whose last answered (or
 * skipped) round is lower is asked again at its next sign-in — raise it to ask
 * everyone again, as when the questions change. 2: the swipe redesign; 3: the
 * broker-style form with multiple answers; 4: the name asked first (all
 * November 2026).
 */
export const ABOUT_VERSION = 4;

/**
 * The oldest round that still counts as answered. An account that answered or
 * skipped any round from this one on is not asked again — Romy, November 2026:
 * people who already answered should not see it pop up again. 1 means only
 * accounts never asked at all are asked. Raise it to ask everyone again.
 */
export const ABOUT_ASK_BELOW = 1;

export const ABOUT_QUESTIONS = [
  // Typed, not chosen: first and last name, stored as first_name and last_name.
  { id: 'name', title: 'Name', ask: 'Your name', hint: 'As you would like us to address you.', name: true },
  {
    id: 'sex', title: 'Gender', ask: 'Gender', hint: 'Used only for anonymous statistics.',
    options: [['male', 'Male'], ['female', 'Female'], ['other', 'Other'], ['na', 'Prefer not to say']],
  },
  {
    id: 'age', title: 'Age', ask: 'Age', hint: 'Select your age range.',
    options: [['18-24', '18–24'], ['25-34', '25–34'], ['35-44', '35–44'], ['45-54', '45–54'], ['55-64', '55–64'], ['65+', '65 and over']],
  },
  {
    id: 'goal', title: 'Investment objectives', ask: 'Investment objectives', hint: 'Select all that apply.', multi: true,
    options: [['wealth', 'Long-term growth of wealth'], ['trading', 'Income from active trading'], ['retire', 'Retirement savings'], ['learn', 'Learning to invest'], ['track', 'Tracking all my investments in one place']],
  },
  {
    id: 'experience', title: 'Investment experience', ask: 'Investment experience', hint: 'How long have you been investing?',
    options: [['lt1', 'Less than 1 year'], ['1-3', '1 to 3 years'], ['3-10', '3 to 10 years'], ['10+', 'More than 10 years']],
  },
  {
    id: 'style', title: 'Investment approach', ask: 'Investment approach', hint: 'Select all that apply.', multi: true,
    options: [['long', 'Long-term investing'], ['swing', 'Swing trading (days to weeks)'], ['day', 'Day trading']],
  },
  {
    id: 'country', title: 'Country of residence', ask: 'Country of residence', hint: 'Where do you currently live?', country: true,
  },
  {
    id: 'heard', title: 'How did you hear about Riskbook?', ask: 'How did you hear about Riskbook?', hint: 'Select all that apply.', multi: true,
    options: [['friend', 'Friend or family'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['google', 'Google search'], ['university', 'University'], ['other', 'Other']],
  },
  {
    id: 'occupation', title: 'Employment status', ask: 'Employment status', hint: 'Select all that apply.', multi: true,
    options: [['student', 'Student'], ['employed', 'Employed'], ['self', 'Self-employed'], ['retired', 'Retired'], ['other', 'Other']],
  },
];

/** Every country and territory with an ISO 3166-1 code; names come from the browser, in English. */
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR '
  + 'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP '
  + 'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ '
  + 'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW '
  + 'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ '
  + 'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

/** Shown first among the countries: where most people using Riskbook are. */
export const COMMON_COUNTRIES = ['IL', 'US', 'GB', 'FR', 'DE', 'CA'];

let names = null;
/** A country's English name, from the browser; the code itself if it has none. */
export function countryName(code) {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The flag emoji: two regional-indicator letters. */
export const flagOf = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
