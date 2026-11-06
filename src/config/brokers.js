/**
 * The brokers the import window knows by name (November 2026), and how to get
 * the file out of each.
 *
 * Every file still goes through the same readers — ibkr.js for Interactive
 * Brokers, genericCsv.js for everyone else — so choosing a broker changes the
 * instructions shown, never how the file is read. A broker missing from here
 * imports exactly as well through "Another broker".
 *
 * The steps follow each broker's own help pages where they publish one, and
 * the guides of other trackers where they do not. Menus get renamed, so each
 * step names what to look for rather than where to click.
 */

/** Steps shared by the Israeli banks: their sites differ in look, not in where the history is. */
const ISRAELI_BANK = [
  'Sign in on the bank’s website on a computer — the app cannot export.',
  'Open Securities (ניירות ערך), then the list of transactions (תנועות בני״ע).',
  'Choose the dates, from your first trade to today.',
  'Press Export to Excel (ייצוא לאקסל).',
];
const ISRAELI_BANK_TIP = 'The Hebrew columns are read as they are. If the site lets you pick only a few months at a time, choose all the files together.';

/** Steps shared by the Israeli trading houses. */
const ISRAELI_HOUSE = [
  'Sign in on the trading website on a computer.',
  'Open the history of actions (היסטוריית פעולות / תנועות).',
  'Choose the dates, from your first trade to today.',
  'Press Export to Excel (ייצוא לאקסל).',
];

export const IBKR_STEPS = [
  'Sign in to the Client Portal at interactivebrokers.com.',
  'Performance & Reports → Statements → Activity.',
  'Period: the year you want (or Custom). Format: CSV.',
  'Press Download.',
];

export const BROKERS = [
  {
    id: 'ibkr', name: 'Interactive Brokers', mark: 'IB', color: '#d81b2b', region: 'world',
    steps: IBKR_STEPS,
    tip: 'One statement per year works best. This year’s sets your positions and cash today; earlier years add your history and returns.',
    perYear: true,
  },
  {
    id: 'robinhood', name: 'Robinhood', mark: 'RH', color: '#00c805', region: 'world',
    returns: 'md',
    steps: [
      'Account (the person icon) → Reports and statements.',
      'Account activity report → Generate new report.',
      'Choose the dates, then generate it.',
      'When it is ready — usually about two hours — press Download CSV.',
    ],
    tip: 'Crypto and futures are not in this report.',
  },
  {
    id: 'schwab', name: 'Charles Schwab', mark: 'CS', color: '#00a0df', region: 'world',
    steps: [
      'Accounts → History.',
      'Choose the account, and Transactions.',
      'Choose the dates, then Search.',
      'Export (top right) → CSV.',
    ],
    tip: 'A very busy account may hit Schwab’s limit per file: export a year at a time.',
    perYear: true,
  },
  {
    id: 'fidelity', name: 'Fidelity', mark: 'F', color: '#4a8c2a', region: 'world',
    steps: [
      'Choose one account (not All accounts).',
      'Activity & Orders → History.',
      'Choose the period, then Go.',
      'Press Download (CSV).',
    ],
    tip: 'Fidelity gives 90 days per download. Download each stretch, then choose all the files together.',
    returns: 'mwr',
  },
  {
    id: 'etrade', name: 'E*TRADE', mark: 'E*', color: '#6b2fbf', region: 'world',
    steps: [
      'Accounts → Transactions.',
      'Custom dates, every transaction type, then Search.',
      'Press the download icon above the list.',
      'Choose CSV.',
    ],
  },
  {
    id: 'vanguard', name: 'Vanguard', mark: 'V', color: '#96151d', region: 'world',
    steps: [
      'My Accounts → Transaction history.',
      'Choose the account and the dates.',
      'Press Download, and choose CSV.',
    ],
    returns: 'mwr',
  },
  {
    id: 'webull', name: 'Webull', mark: 'W', color: '#1a6cff', region: 'world',
    steps: [
      'On a computer: Account → Orders → the ☰ icon → Export Orders.',
      'On the phone: Account → History → Orders Records → the download icon.',
      'The files arrive by email within minutes.',
      'Use the one called Webull_Orders_Records.csv.',
    ],
    tip: 'This file has your orders only. Set your cash on Home after importing.',
  },
  {
    id: 'etoro', name: 'eToro', mark: 'eT', color: '#13c636', region: 'world',
    steps: [
      'Switch the site to English first.',
      'Settings → Account → Account statement → View.',
      'Choose the dates (Custom for a longer period).',
      'Press the Excel (XLS) icon.',
    ],
  },
  {
    id: 't212', name: 'Trading 212', mark: '212', color: '#00a3e0', region: 'world',
    steps: [
      'Open History in the menu.',
      'Press the Export icon.',
      'Choose a year, with Orders, Dividends and Transactions all on.',
      'Download it when it is ready.',
    ],
    tip: 'Trading 212 allows a year at most per file: one file for each year.',
    perYear: true,
    returns: 'mwr',
  },
  {
    id: 'degiro', name: 'DEGIRO', mark: 'DG', color: '#0099dd', region: 'world',
    steps: [
      'Inbox → Transactions.',
      'From your first trade to today.',
      'Export → CSV.',
      'Then Inbox → Account statement → Export → CSV, for deposits and dividends.',
    ],
    tip: 'Choose both files together.',
  },
  {
    id: 'revolut', name: 'Revolut', mark: 'R', color: '#7a7a7a', region: 'world',
    steps: [
      'In the app: Invest → ⋯ More → Documents.',
      'Brokerage account → Account statement.',
      'Choose the period.',
      'Choose Excel or CSV.',
    ],
  },
  {
    id: 'interactive-israel', name: 'Interactive Israel', native: 'אינטראקטיב ישראל', mark: 'IB', color: '#d81b2b', region: 'israel',
    steps: IBKR_STEPS,
    tip: 'Interactive Israel accounts are Interactive Brokers accounts: the same statement. One per year works best.',
    perYear: true,
  },
  { id: 'leumi', name: 'Bank Leumi', native: 'בנק לאומי', mark: 'ל', color: '#2a6ebb', region: 'israel', steps: ISRAELI_BANK, tip: ISRAELI_BANK_TIP },
  { id: 'hapoalim', name: 'Bank Hapoalim', native: 'בנק הפועלים', mark: 'פ', color: '#e2231a', region: 'israel', steps: ISRAELI_BANK, tip: ISRAELI_BANK_TIP },
  { id: 'discount', name: 'Discount Bank', native: 'בנק דיסקונט', mark: 'ד', color: '#2f9e44', region: 'israel', steps: ISRAELI_BANK, tip: ISRAELI_BANK_TIP },
  { id: 'mizrahi', name: 'Mizrahi-Tefahot', native: 'מזרחי טפחות', mark: 'מ', color: '#f08c00', region: 'israel', steps: ISRAELI_BANK, tip: ISRAELI_BANK_TIP },
  { id: 'fibi', name: 'First International', native: 'הבינלאומי', mark: 'ב', color: '#1c3f94', region: 'israel', steps: ISRAELI_BANK, tip: ISRAELI_BANK_TIP },
  { id: 'ibi', name: 'IBI Trade', native: 'IBI טרייד', mark: 'IBI', color: '#0b4ea2', region: 'israel', steps: ISRAELI_HOUSE, tip: ISRAELI_BANK_TIP },
  { id: 'meitav', name: 'Meitav Trade', native: 'מיטב טרייד', mark: 'מ', color: '#5b2a86', region: 'israel', steps: ISRAELI_HOUSE, tip: ISRAELI_BANK_TIP },
  { id: 'excellence', name: 'Excellence Trade', native: 'אקסלנס טרייד', mark: 'X', color: '#c2185b', region: 'israel', steps: ISRAELI_HOUSE, tip: ISRAELI_BANK_TIP },
];

/** Any broker not listed: the general reader finds the columns itself. */
export const OTHER_BROKER = {
  id: 'other', name: 'Another broker', mark: '+', color: '#6b7280', region: 'other',
  steps: [
    'Find Transactions, Account history or Activity.',
    'Choose the dates, from your first trade to today.',
    'Export as CSV or Excel.',
  ],
  tip: 'Riskbook finds the columns by itself, in any language, and asks only about what it cannot tell.',
};

/**
 * How each broker measures an account's return, so Riskbook's % reads like the
 * broker's own app (core/moneyWeighted.js).
 *
 *   time-weighted    each day's return compounded; deposits and withdrawals
 *                    change nothing. Interactive Brokers' statements and
 *                    PortfolioAnalyst, and the industry's standard.
 *   money-weighted   the internal rate of return on the money as it went in
 *                    and out. Fidelity's and Vanguard's "personal rate of
 *                    return", by their own disclosures, and Trading 212's
 *                    "Rate of return" since its 2025 portfolio screen.
 *
 * A broker not marked is time-weighted: the ones that publish nothing either
 * way show a single figure that the two methods agree on whenever no money
 * moved, and time-weighted is the one comparable with the S&P 500 beside it.
 */
export const RETURN_METHODS = {
  twr: { label: 'Time-weighted', short: 'time-weighted' },
  mwr: { label: 'Money-weighted', short: 'money-weighted' },
  // Robinhood's account chart (its support article, checked November 2026).
  md: { label: 'Modified Dietz', short: 'Modified Dietz' },
};

/** The method in force: the one chosen in Settings, else the broker's, else time-weighted. */
export function returnMethodOf(chosen, brokerId) {
  if (chosen === 'twr' || chosen === 'mwr' || chosen === 'md') return chosen;
  return BROKERS.find((b) => b.id === brokerId)?.returns ?? 'twr';
}

export const REGIONS = [
  { id: 'world', title: 'Around the world' },
  { id: 'israel', title: 'Israel' },
];

/** A broker by id, "Another broker" for anything unknown. */
export function brokerById(id) {
  return BROKERS.find((b) => b.id === id) ?? (id === OTHER_BROKER.id ? OTHER_BROKER : null);
}

/** The brokers whose name, Hebrew name or initials contain what was typed. */
export function matchBrokers(query) {
  const q = String(query ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!q) return BROKERS;
  const flat = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return BROKERS.filter((b) => [b.name, b.native, b.id].some((s) => flat(s).includes(q)));
}
