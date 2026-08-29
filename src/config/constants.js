/**
 * Static configuration: symbol maps, risk assumptions, storage keys and timers.
 * Nothing here has side effects, so any module can import it freely.
 */

/** Tickers we can resolve to a CoinGecko id without a network round-trip. */
export const CG_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', ADA: 'cardano',
  DOGE: 'dogecoin', BNB: 'binancecoin', AVAX: 'avalanche-2', DOT: 'polkadot',
  MATIC: 'matic-network', LINK: 'chainlink', LTC: 'litecoin', AAVE: 'aave',
  UNI: 'uniswap', ATOM: 'cosmos', ALGO: 'algorand', VET: 'vechain', FIL: 'filecoin',
  THETA: 'theta-token', TRX: 'tron', EOS: 'eos', XLM: 'stellar',
  HBAR: 'hedera-hashgraph', ICP: 'internet-computer', NEAR: 'near', APT: 'aptos',
  ARB: 'arbitrum', OP: 'optimism', INJ: 'injective-protocol', SUI: 'sui',
  SEI: 'sei-network', TIA: 'celestia', BONK: 'bonk', WIF: 'dogwifcoin',
  PEPE: 'pepe', SHIB: 'shiba-inu', FLOKI: 'floki', MANA: 'decentraland',
  SAND: 'the-sandbox', AXS: 'axie-infinity', ENJ: 'enjincoin', CHZ: 'chiliz',
  GALA: 'gala', IMX: 'immutable-x', LRC: 'loopring', DYDX: 'dydx',
  COMP: 'compound-governance-token', MKR: 'maker', SNX: 'synthetix-network-token',
  CRV: 'curve-dao-token', SUSHI: 'sushi', YFI: 'yearn-finance', RUNE: 'thorchain',
  FTM: 'fantom', ROSE: 'oasis-network', ZIL: 'zilliqa', ZEC: 'zcash', DASH: 'dash',
  XMR: 'monero', BCH: 'bitcoin-cash', ETC: 'ethereum-classic', NEO: 'neo',
  ZRX: '0x', BAT: 'basic-attention-token', GRT: 'the-graph', ANKR: 'ankr',
  HOT: 'holotoken', RVN: 'ravencoin', OCEAN: 'ocean-protocol', FET: 'fetch-ai',
  AGIX: 'singularitynet', RNDR: 'render-token', TAO: 'bittensor',
  WLD: 'worldcoin-wld', CRO: 'crypto-com-chain',
};

/** Rough betas vs. the broad market, used for the size-weighted portfolio beta. */
export const BETA = {
  BTC: 1.8, ETH: 1.6, SOL: 2.2, XRP: 1.5, DEFAULT_CRYPTO: 1.8,
  GLD: 0.1, IAU: 0.1, SLV: 0.3, XAUUSD: 0.1, XAGUSD: 0.3,
  MSFT: 0.9, AAPL: 1.2, IBM: 0.8, SPY: 1.0,
  DEFAULT_STOCK: 1.0, DEFAULT_COMMOD: 0.15,
};

export const ASSET_CLASSES = ['Crypto', 'Stocks', 'Commodities'];

/** Every localStorage key the app owns, in one place. */
export const STORAGE_KEYS = {
  positions: 'pt_pos',
  apiKey: 'pt_apikey',
  snapshots: 'pt_snaps',
  cash: 'pt_cash',
  priceLog: 'pt_plog',
  theme: 'pt_theme',
  benchmarkKey: 'pt_bench_key',
  benchmark: 'pt_bench',
};

export const TIMEFRAME_DAYS = {
  '1W': 7, '1M': 30, '3M': 90, '6M': 182, '1Y': 365, All: 99999,
};

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const API = {
  coingeckoList: 'https://api.coingecko.com/api/v3/coins/list',
  coingeckoPrice: 'https://api.coingecko.com/api/v3/simple/price',
  finnhubQuote: 'https://finnhub.io/api/v1/quote',
  // Free tier allows cross-origin reads, which Stooq and Yahoo do not.
  alphaVantage: 'https://www.alphavantage.co/query',
};

export const TIMERS = {
  /** How often open positions are re-quoted. */
  priceRefreshMs: 30_000,
  /** How often the account-value curve records a point. */
  snapshotMs: 300_000,
};

/**
 * Days of daily closes kept per ticker.
 *
 * Twenty was enough for a rolling seven-day change. Beta needs far more: a
 * slope from a handful of days is noise, so the log now holds roughly two
 * trading years. At one number per ticker per day this stays tiny.
 */
export const PRICE_LOG_DAYS = 500;

/** How far back the year pickers reach, and how far ahead. */
export const YEAR_PICKER = { back: 5, forward: 1 };
