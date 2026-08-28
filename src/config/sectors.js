/**
 * Sector classification for the allocation chart.
 *
 * Two rules shape this file:
 *
 * 1. A sector's colour is fixed and belongs to the sector, never to its rank in
 *    the chart. If colours were handed out in size order, opening one energy
 *    position would repaint every wedge and the chart would stop being
 *    recognisable at a glance.
 *
 * 2. The list is open. Holdings today are technology, crypto, financials, an
 *    index fund and gold, but the taxonomy covers the standard sectors so that
 *    buying into energy or healthcare needs no code change.
 *
 * Colours are mid-tones, readable on both the dark and the light theme.
 */

/** Every sector the app knows, with the colour it keeps. */
export const SECTORS = {
  // The seven below are the ones that actually sit side by side in this book,
  // so they are deliberately far apart in hue. An earlier pass had technology
  // and communication services as two blues, which was unreadable the moment
  // their wedges touched.
  Technology: '#3987e5',
  'Communication services': '#a855f7',
  Crypto: '#d95926',
  Financials: '#199e70',
  Commodities: '#d4a017',
  'Broad market': '#8b8fa8',

  Healthcare: '#e0518f',
  Energy: '#a8541f',
  'Consumer discretionary': '#4dc9b0',
  'Consumer staples': '#7aa63f',
  Industrials: '#c96a6a',
  Materials: '#6b6152',
  Utilities: '#3d9a8b',
  'Real estate': '#b07aa1',
  Other: '#7a7a74',
};

/** Cash is not a sector, but it is a wedge, so it gets a colour of its own. */
export const CASH_COLOUR = '#5f5e5a';

export const SECTOR_NAMES = Object.keys(SECTORS);

/**
 * Known symbols. Only common holdings are listed — anything absent falls back
 * to the asset class, and can be set by hand on the position itself.
 */
const TICKER_SECTORS = {
  // Technology
  AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AMD: 'Technology',
  INTC: 'Technology', ORCL: 'Technology', IBM: 'Technology', CRM: 'Technology',
  ADBE: 'Technology', AVGO: 'Technology', QCOM: 'Technology', TXN: 'Technology',
  MU: 'Technology', PLTR: 'Technology', SMCI: 'Technology', ARM: 'Technology',
  DELL: 'Technology', HPQ: 'Technology', NOW: 'Technology', PANW: 'Technology',
  SNOW: 'Technology', SHOP: 'Technology', UBER: 'Technology', ABNB: 'Technology',
  TSM: 'Technology', ASML: 'Technology', SAP: 'Technology',

  // Communication services
  GOOG: 'Communication services', GOOGL: 'Communication services',
  META: 'Communication services', NFLX: 'Communication services',
  DIS: 'Communication services', SPOT: 'Communication services',
  T: 'Communication services', VZ: 'Communication services',

  // Financials — COIN sits here in some taxonomies, but it trades on crypto
  // and is classed with it below on purpose.
  'BRK.B': 'Financials', 'BRK.A': 'Financials', JPM: 'Financials',
  BAC: 'Financials', GS: 'Financials', MS: 'Financials', WFC: 'Financials',
  C: 'Financials', SOFI: 'Financials', V: 'Financials', MA: 'Financials',
  PYPL: 'Financials', AXP: 'Financials', SCHW: 'Financials', BLK: 'Financials',

  // Crypto and crypto-linked vehicles
  BTC: 'Crypto', ETH: 'Crypto', SOL: 'Crypto', XRP: 'Crypto', ADA: 'Crypto',
  DOGE: 'Crypto', AVAX: 'Crypto', LINK: 'Crypto', DOT: 'Crypto', MATIC: 'Crypto',
  COIN: 'Crypto', MSTR: 'Crypto', HOOD: 'Crypto', MARA: 'Crypto', RIOT: 'Crypto',
  IBIT: 'Crypto', FBTC: 'Crypto', ETHA: 'Crypto', ETHE: 'Crypto', GBTC: 'Crypto',
  BITX: 'Crypto', ETHU: 'Crypto', BSOL: 'Crypto', SOLZ: 'Crypto', BITO: 'Crypto',

  // Healthcare
  JNJ: 'Healthcare', PFE: 'Healthcare', MRK: 'Healthcare', ABBV: 'Healthcare',
  LLY: 'Healthcare', UNH: 'Healthcare', TMO: 'Healthcare', NVO: 'Healthcare',
  AMGN: 'Healthcare', GILD: 'Healthcare', MRNA: 'Healthcare',

  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy', OXY: 'Energy',
  BP: 'Energy', SHEL: 'Energy', XLE: 'Energy', USO: 'Energy',

  // Consumer
  AMZN: 'Consumer discretionary', TSLA: 'Consumer discretionary',
  HD: 'Consumer discretionary', MCD: 'Consumer discretionary',
  NKE: 'Consumer discretionary', SBUX: 'Consumer discretionary',
  LULU: 'Consumer discretionary', F: 'Consumer discretionary',
  GM: 'Consumer discretionary', RIVN: 'Consumer discretionary',
  WMT: 'Consumer staples', COST: 'Consumer staples', PG: 'Consumer staples',
  KO: 'Consumer staples', PEP: 'Consumer staples', PM: 'Consumer staples',

  // Industrials
  BA: 'Industrials', CAT: 'Industrials', GE: 'Industrials', HON: 'Industrials',
  UPS: 'Industrials', LMT: 'Industrials', RTX: 'Industrials', DE: 'Industrials',

  // Materials
  LIN: 'Materials', SHW: 'Materials', FCX: 'Materials', NEM: 'Materials',
  DOW: 'Materials', NUE: 'Materials',

  // Utilities and real estate
  NEE: 'Utilities', DUK: 'Utilities', SO: 'Utilities', AEP: 'Utilities',
  AMT: 'Real estate', PLD: 'Real estate', SPG: 'Real estate', O: 'Real estate',

  // Commodities
  GLD: 'Commodities', IAU: 'Commodities', SLV: 'Commodities', PPLT: 'Commodities',
  XAUUSD: 'Commodities', XAGUSD: 'Commodities', DBC: 'Commodities',

  // Broad market and index funds
  SPY: 'Broad market', VOO: 'Broad market', IVV: 'Broad market',
  QQQ: 'Broad market', VTI: 'Broad market', DIA: 'Broad market',
  IWM: 'Broad market', VT: 'Broad market', VXUS: 'Broad market',
};

/**
 * The sector a position belongs to.
 *
 * An explicit `sector` on the position always wins, so anything the lookup does
 * not know can still be classified by hand. Otherwise the symbol decides, and
 * failing that the asset class gives a sensible floor.
 */
export function sectorOf(position) {
  if (position?.sector && SECTORS[position.sector]) return position.sector;

  const known = TICKER_SECTORS[String(position?.ticker || '').toUpperCase()];
  if (known) return known;

  if (position?.cls === 'Crypto') return 'Crypto';
  if (position?.cls === 'Commodities') return 'Commodities';
  return 'Other';
}

export function sectorColour(name) {
  return SECTORS[name] ?? SECTORS.Other;
}
