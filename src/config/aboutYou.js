/**
 * The questions every account is asked once (November 2026), so Romy can see
 * who uses Riskbook. Every one is optional. The answers are kept on the
 * server apart from the journal (api/_lib/about.js) — the journal stays
 * encrypted and unreadable to anyone but its owner; these are not.
 *
 * Written as a friendly conversation, one question a slide, each answer a big
 * tap with its own emoji: the point is that a new user feels welcome and
 * relaxed, not interrogated.
 *
 * The option ids are what is stored; the server accepts exactly these
 * (tests/about-you.test.mjs keeps the two lists the same). Each option is
 * [id, label, emoji].
 */
export const ABOUT_QUESTIONS = [
  {
    id: 'sex',
    title: 'Sex',
    ask: 'First, how do you identify?',
    hint: 'So we can speak to you the right way.',
    emoji: '👋',
    options: [['male', 'Male', '👨'], ['female', 'Female', '👩'], ['other', 'Other', '🌈'], ['na', 'Prefer not to say', '🤐']],
  },
  {
    id: 'age',
    title: 'Age',
    ask: 'How old are you?',
    hint: 'Just a range — no birthdays needed.',
    emoji: '🎂',
    options: [['u18', 'Under 18', '🧒'], ['18-24', '18–24', '🎓'], ['25-34', '25–34', '💼'], ['35-44', '35–44', '🏡'], ['45-54', '45–54', '🌳'], ['55-64', '55–64', '⛵'], ['65+', '65+', '🌅']],
  },
  {
    id: 'goal',
    title: 'Your main goal',
    ask: 'What brings you to Riskbook?',
    hint: 'Pick the one that matters most. You can do it all here.',
    emoji: '🎯',
    options: [['wealth', 'Grow my wealth long term', '📈'], ['trading', 'Earn from active trading', '⚡'], ['retire', 'Save for retirement', '🏖️'], ['learn', 'Learn to invest', '📚'], ['track', 'Track everything in one place', '🗂️']],
  },
  {
    id: 'experience',
    title: 'How long have you been investing?',
    ask: 'How long have you been investing?',
    hint: 'Beginners are very welcome here.',
    emoji: '🌱',
    options: [['lt1', 'Under 1 year', '🌱'], ['1-3', '1–3 years', '🌿'], ['3-10', '3–10 years', '🌳'], ['10+', '10+ years', '🏔️']],
  },
  {
    id: 'style',
    title: 'Your style',
    ask: 'How do you like to invest?',
    hint: 'There is no wrong answer.',
    emoji: '🧭',
    options: [['long', 'Long-term investor', '🐢'], ['swing', 'Swing trader (days to weeks)', '🌊'], ['day', 'Day trader', '🏃'], ['mix', 'A bit of everything', '🎲']],
  },
  {
    id: 'country',
    title: 'Where do you live?',
    ask: 'Where do you live?',
    hint: 'So we show the markets and brokers that fit you.',
    emoji: '🌍',
    country: true,
  },
  {
    id: 'heard',
    title: 'How did you hear about Riskbook?',
    ask: 'How did you find us?',
    hint: 'It helps us thank the right people 😉',
    emoji: '🔎',
    options: [['friend', 'Friend or family', '👯'], ['instagram', 'Instagram', '📸'], ['tiktok', 'TikTok', '🎵'], ['youtube', 'YouTube', '▶️'], ['google', 'Google', '🔎'], ['university', 'University', '🎓'], ['other', 'Other', '✨']],
  },
  {
    id: 'occupation',
    title: 'What do you do?',
    ask: 'And last — what do you do?',
    hint: 'Almost done!',
    emoji: '💼',
    options: [['student', 'Student', '🎓'], ['employed', 'Employed', '💼'], ['self', 'Self-employed', '🚀'], ['retired', 'Retired', '🌴'], ['other', 'Other', '✨']],
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
