/**
 * What each person chooses to see in Riskbook (November 2026, after the way
 * Binance lets its users choose their home screen).
 *
 * Every page beyond the essentials, and every panel on them, can be switched
 * off in Customize. Switched off means gone — out of the menu, off the page,
 * no grey space left, and its data no longer fetched — until it is switched
 * back on. Three ready-made layouts are a starting point; any switch can then
 * be changed. The choice is kept with the sign-in (core/store.js), so it is the
 * same on every device. Drawing it is ui/views/customize.js.
 *
 * Stored as the list of what is hidden, so anything added to Riskbook later
 * shows up for everyone until they choose to hide it.
 */

/** Everything that can be switched off, by group, in the order Customize lists it. */
export const LAYOUT_GROUPS = [
  {
    key: 'pages',
    title: 'Pages',
    note: 'Home, Positions and New trade are always there.',
    items: [
      { id: 'page.monthly', label: 'Monthly', hint: 'Profit, win rate and trades month by month' },
      { id: 'page.insights', label: 'Insights', hint: 'Patterns in your own trades: habits, timing, what works' },
      { id: 'page.news', label: 'News', hint: 'The Fed, earnings, economic data, options and prediction markets' },
      { id: 'page.crypto', label: 'Crypto', hint: 'Whales, ETF flows and your crypto journal' },
      { id: 'page.friends', label: 'Friends', hint: 'Friends, shared investments and messages' },
    ],
  },
  {
    key: 'everywhere',
    title: 'Every page',
    items: [
      { id: 'gauges', label: 'Fear & Greed', hint: 'The market mood for stocks and crypto, top right' },
    ],
  },
  {
    key: 'home',
    title: 'Home',
    items: [
      { id: 'home.benchmark', label: 'You vs the S&P 500', hint: 'Your year so far against the market' },
      { id: 'home.today', label: 'Today', hint: "Your account's move today, in % and $" },
      { id: 'home.allocation', label: 'Allocation', hint: 'Your money by sector' },
      { id: 'home.graph', label: 'Account graph', hint: 'Value or return over time, with its timeframes' },
      { id: 'home.daily', label: 'Daily returns', hint: 'Every trading day of the year, green and red' },
      { id: 'home.figures', label: 'Key figures', hint: 'Unrealised and realised profit, return, win rate' },
      { id: 'home.holdings', label: 'Open positions', hint: 'Your holdings and how they moved' },
    ],
  },
  {
    key: 'news',
    title: 'News',
    page: 'page.news',
    items: [
      { id: 'news.fed', label: 'Fed decision', hint: 'The odds on the next rate decision' },
      { id: 'news.earnings', label: 'Earnings & revenue', hint: 'Forecasts and results for the companies you follow' },
      { id: 'news.econ', label: 'US economic data', hint: 'This week’s releases: forecast, previous, actual' },
      { id: 'news.options', label: 'Options exposure', hint: 'Gamma and delta (GEX / DEX) for BTC, ETH, SPX, NDX' },
      { id: 'news.gamble', label: 'Prediction markets', hint: 'Large bets on Polymarket' },
    ],
  },
  {
    key: 'crypto',
    title: 'Crypto',
    page: 'page.crypto',
    items: [
      { id: 'crypto.whales', label: 'Whales', hint: 'Large transfers and trades across blockchains' },
      { id: 'crypto.etf', label: 'ETF flows', hint: 'Money in and out of the Bitcoin and Ethereum ETFs' },
      { id: 'crypto.journal', label: 'Crypto journal', hint: 'Trades you log by hand, month by month' },
      { id: 'crypto.stable', label: 'Stablecoin dominance', hint: 'Stablecoins’ share of the crypto market' },
    ],
  },
];

export const LAYOUT_IDS = LAYOUT_GROUPS.flatMap((g) => g.items.map((i) => i.id));

/** Ready-made starting points. Each is the list of what it hides. */
export const PRESETS = [
  {
    key: 'trader',
    title: 'Everything',
    text: 'Every page and panel — the full Riskbook.',
    hidden: [],
  },
  {
    key: 'simple',
    title: 'Simple',
    text: 'Your portfolio and journal only: Home, Positions, New trade and Monthly.',
    hidden: ['page.news', 'page.crypto', 'page.friends', 'gauges', 'home.benchmark'],
  },
  {
    key: 'crypto',
    title: 'Crypto focus',
    text: 'Your portfolio with the crypto pages; the stock-market panels off.',
    hidden: ['page.news', 'home.benchmark'],
  },
];

/** What is hidden, as stored: known ids only, each once, in Customize's order. */
export function cleanLayout(list) {
  const hidden = new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  return LAYOUT_IDS.filter((id) => hidden.has(id));
}

/** The preset this list matches exactly, if any. */
export function presetOf(hidden) {
  const clean = cleanLayout(hidden).join(',');
  return PRESETS.find((p) => cleanLayout(p.hidden).join(',') === clean)?.key ?? null;
}

/**
 * Whether something is on screen, given what is hidden: switched off itself,
 * or its page is — a News panel goes with the News page.
 */
export function shownIn(hidden, id) {
  const off = new Set(hidden ?? []);
  if (off.has(id)) return false;
  const group = LAYOUT_GROUPS.find((g) => g.items.some((i) => i.id === id));
  return !(group?.page && off.has(group.page));
}
