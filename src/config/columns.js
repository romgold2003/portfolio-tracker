/**
 * The columns a holdings list can show (November 2026), the way Interactive
 * Brokers lets a trader build their own: pick any of these for the Home list
 * and the Positions list, put them in any order, and sort by any of them up
 * or down. The symbol is always the first column.
 *
 * What each one shows is worked out in src/ui/views/holdingColumns.js; this is
 * the list, the groups for the picker, the ready-made layouts, and the check
 * a stored layout goes through.
 */
export const COLUMN_GROUPS = [
  ['identity', 'The holding'],
  ['position', 'Position'],
  ['money', 'Profit and loss in $'],
  ['percent', 'Returns in %'],
  ['range', 'Price range'],
];

/**
 * id → [header, group, what it means]. `text: true` sorts A to Z first;
 * every other column sorts largest first.
 */
export const COLUMNS = {
  cls: { label: 'Class', group: 'identity', help: 'Stock, ETF, crypto or commodity', text: true },
  sector: { label: 'Sector', group: 'identity', help: 'Technology, Healthcare and so on', text: true },
  dir: { label: 'Side', group: 'identity', help: 'Long or short', text: true },
  account: { label: 'Account', group: 'identity', help: 'Which of your accounts holds it', text: true },

  qty: { label: 'Quantity', group: 'position', help: 'Shares or units held' },
  avg: { label: 'Avg cost', group: 'position', help: 'Average price paid' },
  cost: { label: 'Cost basis', group: 'position', help: 'What was invested: average cost × quantity' },
  price: { label: 'Last', group: 'position', help: 'The latest price' },
  value: { label: 'Mkt value', group: 'position', help: 'Price × quantity (negative for a short)' },
  weight: { label: 'Weight', group: 'position', help: 'Share of the whole account' },
  held: { label: 'Days held', group: 'position', help: 'Days since it was bought' },
  opened: { label: 'Opened', group: 'position', help: 'The date it was bought' },

  dayUsd: { label: 'Today $', group: 'money', help: 'Change since yesterday\'s close' },
  weekUsd: { label: '1W $', group: 'money', help: 'Change this week, from Friday\'s close' },
  monthUsd: { label: '1M $', group: 'money', help: 'Change over the last month' },
  ytdUsd: { label: 'YTD $', group: 'money', help: 'Change since 1 January' },
  unrealUsd: { label: 'Unrealised', group: 'money', help: 'Market value less cost' },
  realUsd: { label: 'Realised', group: 'money', help: 'Banked from partial sales of this holding' },
  totalUsd: { label: 'Total P&L', group: 'money', help: 'Realised plus unrealised' },

  dayPct: { label: 'Today %', group: 'percent', help: 'Price change today' },
  weekPct: { label: '1W %', group: 'percent', help: 'This week, Monday to now' },
  monthPct: { label: '1M %', group: 'percent', help: 'Over the last month' },
  quarterPct: { label: '3M %', group: 'percent', help: 'Over the last three months' },
  ytdPct: { label: 'YTD %', group: 'percent', help: 'Since 1 January' },
  unrealPct: { label: 'Unrealised %', group: 'percent', help: 'Unrealised P&L over cost' },
  totalPct: { label: 'Total %', group: 'percent', help: 'Total P&L over cost' },
  contrib: { label: 'Contribution', group: 'percent', help: 'Its unrealised P&L as a share of the whole account' },

  high52: { label: '52W high', group: 'range', help: 'Highest close in the last year' },
  low52: { label: '52W low', group: 'range', help: 'Lowest close in the last year' },
  fromHigh: { label: 'From high', group: 'range', help: 'How far below its 52-week high it is' },
};

/** Ready-made layouts. Simple is where everyone starts. */
export const COLUMN_PRESETS = {
  simple: { label: 'Simple', cols: ['price', 'dayPct', 'dayUsd', 'value', 'unrealUsd', 'weight'] },
  performance: { label: 'Performance', cols: ['dayPct', 'weekPct', 'monthPct', 'ytdPct', 'unrealPct', 'totalUsd'] },
  detailed: { label: 'Detailed', cols: ['qty', 'avg', 'price', 'value', 'weight', 'dayUsd', 'unrealUsd', 'unrealPct'] },
  range: { label: 'Range', cols: ['price', 'high52', 'low52', 'fromHigh', 'ytdPct', 'unrealPct'] },
};

export const LIST_PAGES = ['home', 'positions'];
export const MAX_COLUMNS = 12;
export const DEFAULT_SORT = { id: 'unrealUsd', dir: 'desc' };

/** A fresh layout: the Simple preset, largest unrealised P&L first. */
export function defaultLayout() {
  return { cols: [...COLUMN_PRESETS.simple.cols], sort: { ...DEFAULT_SORT } };
}

/**
 * A stored layout made safe: known columns only, each once, at most twelve;
 * a sort on a known column (the symbol counts) in a known direction.
 */
export function cleanLayout(given) {
  const base = defaultLayout();
  if (!given || typeof given !== 'object') return base;
  const cols = Array.isArray(given.cols)
    ? [...new Set(given.cols.filter((id) => typeof id === 'string' && COLUMNS[id]))].slice(0, MAX_COLUMNS)
    : base.cols;
  const id = given.sort?.id;
  const sort = (id === 'symbol' || COLUMNS[id]) && (given.sort.dir === 'asc' || given.sort.dir === 'desc')
    ? { id, dir: given.sort.dir }
    : base.sort;
  return { cols, sort };
}

/** Both pages' layouts, cleaned. */
export function cleanLayouts(given) {
  return Object.fromEntries(LIST_PAGES.map((page) => [page, cleanLayout(given?.[page])]));
}
