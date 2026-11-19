/**
 * What Clavis Free and Clavis Pro include (November 2026): one list, used by
 * the landing page's table, the plan window and the locked pages, so they can
 * never disagree. The server decides who has which plan (api/_lib/billing.js).
 */
export const PRICES = { monthly: 3.5, yearly: 35 };
export const TRIAL_DAYS = 30;

/** [what, in Free, in Pro] */
export const FEATURES = [
  ['Home: your balance, chart and holdings', true, true],
  ['Positions and new trades', true, true],
  ['Import from your broker (CSV or Excel)', true, true],
  ['Friends and chat', true, true],
  ['You vs the S&P 500 this year, as one figure', true, true],
  ['Clavis Insights: your feedback, S&P twin and trader card', false, true],
  ['Monthly results, realised and unrealised', false, true],
  ['Daily returns', false, true],
  ['News: the Fed, earnings, the economy, prediction markets', false, true],
  ['Crypto: whale moves and ETF flows', false, true],
  ['Fear & greed index', false, true],
  ['Several sub-accounts', false, true],
];

/** The pages Free shows locked, with what the lock screen says each one gives. */
export const PRO_PAGES = {
  insights: ['Clavis Insights', 'Your feedback: what to keep doing, what to work on, and how each trade did against the S&P 500.'],
  monthly: ['Monthly', 'Every month realised and unrealised, with the trades behind each one.'],
  news: ['News', 'The Fed’s next decision, earnings, the economic calendar and prediction markets.'],
  crypto: ['Crypto', 'Where the big money moves: whale trades, exchange flows and the ETFs.'],
};

export const money = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
