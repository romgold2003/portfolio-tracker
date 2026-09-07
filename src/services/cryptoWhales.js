/**
 * Very large on-chain transfers, read back from the app's own store.
 *
 * The sibling of services/gamble.js and deliberately shaped like it: bands,
 * a filter, rows newest first. What it watches is different — that panel reads
 * bets on Polymarket, this one reads money moving on fourteen chains — but the
 * question is the same one, which is who is doing something big enough to be
 * worth noticing.
 *
 * Everything here is a public ledger read back. The wallets are addresses that
 * anyone can look up, and the names attached to them are the provider's own
 * labels, carried through only when it has one. Where it does not, the row says
 * so. Guessing that an unlabelled address is Binance because the amount is
 * round would be inventing the most important field on the screen.
 *
 * The fetch goes through this app's API rather than straight out, unlike the
 * macro panel: the provider needs a key, and a key in the browser is not a key.
 */

/**
 * The sizes worth separating — now the filter on a whale's position rather
 * than on a single transfer, which is the only place a size band means much:
 * one transfer is an event, a position is a decision.
 *
 * Original note follows.
 *
 *
 * Measured against the record twice, and moved both times.
 *
 * They began at $20M–50M / $50M–100M / $100M+, which turned out to be three
 * empty boxes: across 960 consecutive transfers not one reached twenty million.
 * They then went to $1M–5M and below, which was the opposite mistake — of the
 * fourteen positions the record held, **nine sat in that lowest band**. It was
 * two thirds of the table and the least interesting two thirds, so the sizes
 * worth telling apart were crowded into what was left.
 *
 * They now start at twenty-five million. The two upper bands are empty most of
 * the time and are meant to be — a band that says "something unusual just
 * happened" can only say it by being quiet the rest of the time — but the floor
 * is high against what the record currently holds, so the table will be short
 * until the collector has run for longer. That is the deliberate trade: fewer
 * rows, every one of them worth reading.
 *
 * The **collection** floor is untouched at $250k and must stay there. It is not
 * a display setting — a five-million-dollar position built quietly out of
 * quarter-million pieces only exists if the pieces were kept.
 */
/*
 * The boundaries are half-open and must stay that way: at least the floor,
 * below the ceiling. A transfer of exactly a hundred million belongs in
 * $100M–250M and nowhere else — one landing in two bands would be counted
 * twice by anybody adding the columns up.
 */
export const BANDS = [
  { id: 'all', label: 'All $25M+', min: 25_000_000, max: Infinity },
  { id: 'big', label: '$25M–$100M', min: 25_000_000, max: 100_000_000 },
  { id: 'huge', label: '$100M–$250M', min: 100_000_000, max: 250_000_000 },
  { id: 'mega', label: '$250M+', min: 250_000_000, max: Infinity },
];

/**
 * Falls back by name, not by index — the same trap windowDef fell into.
 *
 * It returned BANDS[3], which was "all" until a fourth band was added and
 * silently became "$100M+": an unknown band would then have shown almost
 * nothing instead of everything. A default that moves because a neighbour was
 * inserted is a bug waiting for the next edit.
 */
export const bandDef = (id) => BANDS.find((b) => b.id === id)
  ?? BANDS.find((b) => b.id === 'all');

/**
 * How far back the Live Whale Activity tape reaches.
 *
 * Three, not five. The window picker this replaced had five and they blurred
 * into each other; a day, a week and a quarter are three genuinely different
 * questions — what is happening now, what happened this week, what has been
 * building. It applies to the tape and to nothing else on the page: the
 * netflow card answers about the whole market over its own fixed periods, and
 * the holder card is a snapshot of right now.
 */
export const ACTIVITY_WINDOWS = [
  { id: '1d', label: 'Last 1D', hours: 24 },
  { id: '7d', label: 'Last 7D', hours: 24 * 7 },
  { id: '3m', label: 'Last 3M', hours: 24 * 92 },
];

/** By name, never by index — a default that moves when a neighbour is inserted. */
export const activityWindowDef = (id) => ACTIVITY_WINDOWS.find((w) => w.id === id)
  ?? ACTIVITY_WINDOWS.find((w) => w.id === '7d');

/**
 * Where each chain's transactions can be looked at.
 *
 * The link is the proof. A row nobody can check is a claim, and this panel is
 * only worth having because every line of it can be opened on a block explorer
 * and read independently.
 */
const EXPLORERS = {
  bitcoin: { tx: 'https://mempool.space/tx/', address: 'https://mempool.space/address/', label: 'Bitcoin' },
  ethereum: { tx: 'https://etherscan.io/tx/', address: 'https://etherscan.io/address/', label: 'Ethereum' },
  solana: { tx: 'https://solscan.io/tx/', address: 'https://solscan.io/account/', label: 'Solana' },
  ripple: { tx: 'https://xrpscan.com/tx/', address: 'https://xrpscan.com/account/', label: 'XRP Ledger' },
  tron: { tx: 'https://tronscan.org/#/transaction/', address: 'https://tronscan.org/#/address/', label: 'Tron' },
  polygon: { tx: 'https://polygonscan.com/tx/', address: 'https://polygonscan.com/address/', label: 'Polygon' },
  dogecoin: { tx: 'https://dogechain.info/tx/', address: 'https://dogechain.info/address/', label: 'Dogecoin' },
  litecoin: { tx: 'https://blockchair.com/litecoin/transaction/', address: 'https://blockchair.com/litecoin/address/', label: 'Litecoin' },
  bitcoin_cash: { tx: 'https://blockchair.com/bitcoin-cash/transaction/', address: 'https://blockchair.com/bitcoin-cash/address/', label: 'Bitcoin Cash' },
  cardano: { tx: 'https://cardanoscan.io/transaction/', address: 'https://cardanoscan.io/address/', label: 'Cardano' },
  algorand: { tx: 'https://allo.info/tx/', address: 'https://allo.info/account/', label: 'Algorand' },
  hyperliquid: { tx: 'https://app.hyperliquid.xyz/explorer/tx/', address: 'https://app.hyperliquid.xyz/explorer/address/', label: 'Hyperliquid' },
  plasma: { tx: 'https://plasmascan.to/tx/', address: 'https://plasmascan.to/address/', label: 'Plasma' },
  tempo: { tx: 'https://explorer.tempo.xyz/tx/', address: 'https://explorer.tempo.xyz/address/', label: 'Tempo' },
};

export const chainLabel = (chain) => EXPLORERS[chain]?.label
  ?? String(chain ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function explorerTx(chain, hash) {
  const base = EXPLORERS[chain]?.tx;
  return base && hash ? base + encodeURIComponent(hash) : null;
}

export function explorerAddress(chain, address) {
  const base = EXPLORERS[chain]?.address;
  return base && address ? base + encodeURIComponent(address) : null;
}

/**
 * Which way the money went.
 *
 * Only ever from the provider's own labels. Both ends known gives one of the
 * four directions; one end known gives the half that is known; neither gives
 * "unknown", which is a real and common answer — most large transfers are
 * between addresses nobody has attributed, and saying so is the honest version.
 *
 * `unknown` as an owner_type is normalised away upstream, so a truthy
 * ownerType here means the provider actually recognised the address.
 */
export function directionOf(t) {
  const kind = String(t?.kind ?? 'transfer').toLowerCase();
  // A mint has no meaningful sender and a burn no meaningful recipient, so
  // neither is a direction and calling them one would be wrong twice.
  if (kind !== 'transfer') return { id: kind, label: kind.replace(/\b\w/g, (c) => c.toUpperCase()) };

  const side = (end) => {
    if (isVoid(end)) return null;
    const type = String(end?.ownerType ?? '').toLowerCase();
    if (!type) return null;
    if (type === 'exchange') return 'Exchange';
    if (type === 'wallet' || type === 'personal') return 'Wallet';
    return type.replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const from = side(t?.from);
  const to = side(t?.to);
  if (from && to) return { id: 'known', label: `${from} → ${to}` };
  if (from) return { id: 'half', label: `${from} → Unknown` };
  if (to) return { id: 'half', label: `Unknown → ${to}` };
  return { id: 'unknown', label: 'Wallet → Wallet' };
}

/**
 * Addresses that are not parties: the burn holes each chain mints from and
 * burns into. Indexers give them names — Blockscout calls Ethereum's
 * "Null: 0x000...000" — and a row that renders that in bold reads as though an
 * entity called Null sent sixty-six million dollars. Nobody sent it.
 *
 * Suppressed here as well as at write time, so rows already in the store from
 * before that was understood display correctly too.
 */
const NOT_A_PARTY = new Set([
  '0x0000000000000000000000000000000000000000',
  'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
]);

export const isVoid = (end) => !!end?.address && NOT_A_PARTY.has(end.address);

/** What to call an end of a transfer: the entity when known, else the address. */
export function partyName(end) {
  if (isVoid(end)) return '—';
  const owner = String(end?.owner ?? '').trim();
  if (owner) return owner.replace(/\b\w/g, (c) => c.toUpperCase());
  return shortAddress(end?.address) || 'Unknown';
}

export function shortAddress(address) {
  const a = String(address ?? '');
  if (!a) return '';
  return a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * $1.2B, $84.3M, $450k — the scale is the point, the last three digits are not.
 *
 * It used to render everything in millions, so a net of twelve thousand dollars
 * came out as "$0.0M" and a list of them looked like a column of broken rows.
 * Nothing was wrong with the arithmetic; the formatter simply had one unit.
 */
export function money(usd) {
  const n = Number(usd) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = '$';
  if (abs >= 1e9) return `${sign}${dollars}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${dollars}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${dollars}${Math.round(abs / 1e3)}k`;
  return `${sign}${dollars}${Math.round(abs)}`;
}

/** 4,182.55 ETH — enough digits to be a quantity, not so many to be a hash. */
export function tokens(amount, symbol) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  const dp = n >= 1e6 ? 0 : n >= 1000 ? 1 : 2;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })} ${symbol}`;
}

/**
 * Rows for one band, deduped and newest first.
 *
 * The store already drops a transfer it has seen, so this second pass is for
 * the case the store cannot catch: the same movement reported once per network
 * for a bridged asset. Same symbol, same amount, within a minute of itself, on
 * two different chains is one economic event seen twice, and showing it twice
 * would double the only number the panel is read for.
 */
export function selectTransfers(rows, { band = 'all', window = null, limit = 60 } = {}) {
  if (!Array.isArray(rows)) return [];
  const { min, max } = bandDef(band);
  /**
   * The server already cut on time. Cutting again here is not redundancy for
   * its own sake: the previous timeframe's rows are still in hand while the
   * new request is in flight, and without this the tape shows a week of
   * transfers for a moment under a heading that says one day.
   */
  const hours = window ? activityWindowDef(window).hours : null;
  const since = hours ? Math.floor(Date.now() / 1000) - hours * 3600 : null;

  const out = [];
  const seen = new Map();

  for (const t of rows) {
    const usd = Number(t?.usd) || 0;
    if (!(usd >= min) || usd >= max) continue;
    if (since != null && Number(t?.at) < since) continue;

    const bucket = `${t.symbol}|${Math.round(usd / 1000)}|${Math.round(t.at / 60)}`;
    const twin = seen.get(bucket);
    /**
     * Only across chains. Two transfers of the same size in the same minute on
     * the same chain are two transfers, and collapsing them lost real rows:
     * four twenty-six-million WETH moves out of Morpho landed inside one
     * minute and the tape showed one of them. A bridged asset reported once
     * per network is the case this exists for, and that one spans two chains.
     */
    if (twin && twin.blockchain !== t.blockchain) {
      // Keep the first and note the other network on it, rather than dropping
      // the fact that it crossed one.
      if (!twin.alsoOn) twin.alsoOn = [];
      if (!twin.alsoOn.includes(t.blockchain)) twin.alsoOn.push(t.blockchain);
      continue;
    }

    const row = { ...t, direction: directionOf(t) };
    seen.set(bucket, row);
    out.push(row);
  }

  out.sort((a, b) => b.at - a.at);
  return out.slice(0, limit);
}

/* ── the two calls ─────────────────────────────────────────────────────── */

async function get(path, signal) {
  const res = await fetch(`/api/whales?${path}`, { credentials: 'same-origin', signal });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json())?.error || message; } catch { /* not JSON */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** The top fifty and what can be watched. Null on failure, never a guess. */
export async function fetchCoins({ signal } = {}) {
  try {
    return await get('resource=coins', signal);
  } catch {
    return null;
  }
}

export async function fetchTransfers({ symbol, band = 'all', window = null, signal } = {}) {
  const { min, max } = bandDef(band);
  const params = new URLSearchParams({ resource: 'feed', min: String(min) });
  if (Number.isFinite(max)) params.set('max', String(max));
  if (window) params.set('hours', String(activityWindowDef(window).hours));
  if (symbol) params.set('symbol', symbol);
  try {
    return await get(params.toString(), signal);
  } catch (err) {
    return { rows: [], counts: {}, provider: { configured: null, error: err.message } };
  }
}

/**
 * The wallets behind the transfers, ranked by what they actually accumulated.
 *
 * The transfer list answers "what moved". This answers "who has been buying",
 * which is the question a single row can never reach — a wallet taking coins in
 * ten times over a fortnight is a position being built, and each of those ten
 * pieces on its own is unremarkable.
 */
export async function fetchWallets({ symbol, days = 30, signal } = {}) {
  const params = new URLSearchParams({ resource: 'wallets', days: String(days) });
  if (symbol) params.set('symbol', symbol);
  try {
    return await get(params.toString(), signal);
  } catch (err) {
    return { wallets: [], error: err.message };
  }
}

/**
 * How long the wallet has been at it — the span, not the age.
 *
 * The second fact about a row, under how long ago it last moved. A position
 * built over nine days and one built in ninety seconds are different things
 * even when the total is identical, and "in minutes" said neither: it was
 * technically true of every span under an hour and told nobody anything.
 */
export function activeFor(firstAt, lastAt) {
  if (!firstAt || !lastAt) return '';
  const secs = lastAt - firstAt;
  // One moment, not a span. A single burst needs no second line.
  if (secs < 60) return '';
  const days = Math.floor(secs / 86400);
  if (days >= 1) return `over ${days}d`;
  const hours = Math.floor(secs / 3600);
  if (hours >= 1) return `over ${hours}h`;
  return `over ${Math.floor(secs / 60)}m`;
}

/** The windows the accumulation layers work over. */
export const FLOW_WINDOWS = [
  { id: '1w', label: '1W' }, { id: '1m', label: '1M' }, { id: '3m', label: '3M' },
  { id: '1y', label: '1Y' }, { id: 'all', label: 'All' },
];

/**
 * Accumulation, consensus and stealth, in one request.
 *
 * They are four readings of one book — every number comes from transfers the
 * app already recorded — so asking separately would re-aggregate the same rows
 * four times for the same answer.
 */
export async function fetchFlow({ symbol, window = '1m', band = 'all', signal } = {}) {
  const { min, max } = bandDef(band);
  const params = new URLSearchParams({ resource: 'flow', window, min: String(min) });
  if (Number.isFinite(max)) params.set('max', String(max));
  if (symbol) params.set('symbol', symbol);
  try {
    return await get(params.toString(), signal);
  } catch (err) {
    return { wallets: [], consensus: null, stealth: null, error: err.message };
  }
}

/** The five trends, and the colour each earns. Neutral earns none. */
export const TREND_TONE = {
  'Strong Accumulation': 'cw-in',
  Accumulation: 'cw-in',
  Neutral: '',
  Distribution: 'cw-out',
  'Strong Distribution': 'cw-out',
};

/**
 * Holders whose balance has moved, and what kind of holder they are.
 *
 * The one measure here that does not depend on catching a transfer. A whale can
 * sell through an exchange, over the counter, or by shorting a perpetual and
 * never moving a coin — but if it held forty million tokens and now holds
 * twenty-five, the balance says so whichever route it took.
 */
export async function fetchHolders({ symbol, window = '1m', signal } = {}) {
  const params = new URLSearchParams({ resource: 'holders', window });
  if (symbol) params.set('symbol', symbol);
  try {
    return await get(params.toString(), signal);
  } catch (err) {
    return { moves: [], error: err.message };
  }
}

/** One wallet's leveraged positions, asked for when a row is opened. */
export async function fetchLeverage(address, { signal } = {}) {
  try {
    return await get(`resource=leverage&address=${encodeURIComponent(address)}`, signal);
  } catch {
    return null;
  }
}

/** What a holder is, said in a word the panel can show. */
export const HOLDER_KIND = {
  deployer: { label: 'Deployer', tone: 'is-insider', title: 'The address that created the token contract' },
  team: { label: 'Team / treasury', tone: 'is-insider', title: 'A multisig, timelock or vesting contract — how teams hold allocations' },
  contract: { label: 'Contract', tone: '', title: 'A contract, not a person: a pool, a bridge or a staking vault' },
  wallet: { label: 'Wallet', tone: '', title: 'An ordinary address with no attribution' },
};

/**
 * The whole reading for one asset, in one request.
 *
 * The verdict, the exchange flows behind it, the holders, the ranking and the
 * stealth alert are four views of one book. Asked separately they would
 * re-aggregate the same rows and, worse, could answer from four different
 * moments — so the page that shows them together fetches them together.
 */
export async function fetchVerdict({ symbol, window = '1m', band = 'all', signal } = {}) {
  const { min, max } = bandDef(band);
  const params = new URLSearchParams({ resource: 'verdict', window, min: String(min) });
  if (Number.isFinite(max)) params.set('max', String(max));
  if (symbol) params.set('symbol', symbol);
  try {
    return await get(params.toString(), signal);
  } catch (err) {
    return { error: err.message, verdict: null, flows: [], holders: [], ranked: [] };
  }
}

/** Exchange netflow across every window at once, for the comparison strip. */
export async function fetchFlows({ symbol, signal } = {}) {
  const params = new URLSearchParams({ resource: 'flows' });
  if (symbol) params.set('symbol', symbol);
  try {
    return await get(params.toString(), signal);
  } catch (err) {
    return { flows: {}, error: err.message };
  }
}

/** How a verdict should read on screen. Neutral earns no colour. */
export const VERDICT_TONE = {
  'Strong accumulation': 'cw-in',
  Accumulation: 'cw-in',
  Neutral: '',
  Distribution: 'cw-out',
  'Strong distribution': 'cw-out',
};

/**
 * Market-wide exchange netflow. **Deliberately takes no symbol.**
 *
 * Every other fetch here narrows to whatever coin is selected. This one must
 * not: it answers "is capital moving onto exchanges or off them across the
 * market", and passing a symbol would turn it into a different question wearing
 * the same label.
 */
export async function fetchNetflow({ signal } = {}) {
  try {
    return await get('resource=netflow', signal);
  } catch (err) {
    return { periods: [], error: err.message };
  }
}

/** Green for bullish, red for bearish, nothing for neutral. */
export const SIGNAL_TONE = { Bullish: 'cw-in', Bearish: 'cw-out', Neutral: '' };

/**
 * The top holders of one coin, and what happened when one left.
 *
 * **Takes a symbol, unlike the netflow card.** "Who holds the most ETH" is a
 * question about ETH; answering it for the market would mean nothing.
 */
export async function fetchTopHolders({ symbol, signal } = {}) {
  const params = new URLSearchParams({ resource: 'topholders' });
  if (symbol) params.set('symbol', symbol);
  try {
    return await get(params.toString(), signal);
  } catch (err) {
    return { holders: [], events: [], error: err.message };
  }
}

/** A confirmed sale reads differently from a suspected one, and must. */
export const STATUS_TONE = {
  'Sold / swapped': 'cw-out',
  'Transferred to exchange': 'cw-warn',
  'Moved to another chain': '',
  'Sent to a contract': '',
  'Wallet transfer — no sale detected': '',
  'Reduction seen, route unknown': '',
};

/**
 * How each action reads on screen.
 *
 * Only a confirmed swap earns a colour. An exchange deposit gets a warning
 * tone rather than red, because red would be the app calling it a sale — which
 * is exactly what the classifier refuses to do.
 */
export const ACTION_TONE = {
  'Buy / Swap': 'cw-in',
  'Sell / Swap': 'cw-out',
  'Exchange Deposit': 'cw-warn',
  'Exchange Withdrawal': '',
  'Wallet Transfer': '',
  Bridge: '',
  'Internal Transfer': '',
  Unknown: '',
};
