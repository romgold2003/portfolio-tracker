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
 * The sizes worth separating.
 *
 * Set from the measured distribution rather than from what sounds impressive.
 * Across 960 consecutive transfers off twenty token feeds, none reached twenty
 * million and one reached a million — so the old $20M–50M / $50M–100M / $100M+
 * bands were three empty boxes. A threshold nothing ever clears does not filter
 * noise, it just means the panel never says anything.
 *
 * The top band stays open at twenty million so that a transfer of that size,
 * when one does come, still stands out as the outlier it is.
 */
export const BANDS = [
  { id: 'big', label: '$1M–5M', min: 1_000_000, max: 5_000_000 },
  { id: 'huge', label: '$5M–20M', min: 5_000_000, max: 20_000_000 },
  { id: 'mega', label: '$20M+', min: 20_000_000, max: Infinity },
  { id: 'all', label: 'All $1M+', min: 1_000_000, max: Infinity },
];

export const bandDef = (id) => BANDS.find((b) => b.id === id) ?? BANDS[3];

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

/** $1.2B, $84.3M — the scale is the point, the last three digits are not. */
export function money(usd) {
  const n = Number(usd) || 0;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  return `$${(n / 1e6).toFixed(1)}M`;
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
export function selectTransfers(rows, { band = 'all', limit = 60 } = {}) {
  if (!Array.isArray(rows)) return [];
  const { min, max } = bandDef(band);

  const out = [];
  const seen = new Map();

  for (const t of rows) {
    const usd = Number(t?.usd) || 0;
    if (!(usd >= min) || usd >= max) continue;

    const bucket = `${t.symbol}|${Math.round(usd / 1000)}|${Math.round(t.at / 60)}`;
    const twin = seen.get(bucket);
    if (twin && twin.blockchain !== t.blockchain) {
      // Keep the first and note the other network on it, rather than dropping
      // the fact that it crossed one.
      if (!twin.alsoOn) twin.alsoOn = [];
      if (!twin.alsoOn.includes(t.blockchain)) twin.alsoOn.push(t.blockchain);
      continue;
    }
    if (twin) continue;

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

export async function fetchTransfers({ symbol, band = 'all', signal } = {}) {
  const { min, max } = bandDef(band);
  const params = new URLSearchParams({ resource: 'feed', min: String(min) });
  if (Number.isFinite(max)) params.set('max', String(max));
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

/** How long a wallet has been at it — the span, not the age. */
export function activeFor(firstAt, lastAt) {
  if (!firstAt || !lastAt) return '';
  const days = Math.round((lastAt - firstAt) / 86400);
  if (days >= 1) return `over ${days}d`;
  const hours = Math.round((lastAt - firstAt) / 3600);
  return hours >= 1 ? `over ${hours}h` : 'in minutes';
}

/** The windows the accumulation layers work over. */
export const FLOW_WINDOWS = [
  { id: '1h', label: '1h' }, { id: '6h', label: '6h' }, { id: '24h', label: '24h' },
  { id: '7d', label: '7d' }, { id: '30d', label: '30d' },
];

/**
 * Accumulation, consensus and stealth, in one request.
 *
 * They are four readings of one book — every number comes from transfers the
 * app already recorded — so asking separately would re-aggregate the same rows
 * four times for the same answer.
 */
export async function fetchFlow({ symbol, window = '7d', signal } = {}) {
  const params = new URLSearchParams({ resource: 'flow', window });
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
