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

    const row = { ...t };
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

/**
 * How much of the market is sitting in dollars, and what that reads as.
 *
 * Green when there is buying power waiting, red when it has already been
 * spent. Neutral earns no colour, like every other reading on this page.
 */
export const STANCE_TONE = { Bullish: 'cw-in', Bearish: 'cw-out', Neutral: '' };

/** "11.6%" — two significant places, because the third is noise on a slow signal. */
export const percent = (n) => (Number.isFinite(n) ? `${n.toFixed(2)}%` : '—');

/**
 * Below this the position is the size it was.
 *
 * Half a percent of a nine-figure position is still a lot of money, but it is
 * not somebody changing their mind — it is the dust an active wallet throws
 * off. Above it, the number is shown and the reader decides.
 */
const UNCHANGED_PCT = 0.5;

/**
 * How much this holder grew or shrank its position over the window.
 *
 * The number is the answer, not a label with the number underneath: up in
 * green, down in red, and "Unchanged" when the position is the size it was.
 *
 * **It is a share of what they held at the start of the window**, which is the
 * only denominator that means anything — a whale that added two million to
 * three million grew by two thirds, and the same two million added to two
 * hundred million is a rounding error. The tooltip spells out both ends so the
 * percentage can be checked rather than trusted.
 *
 * Nothing here says bought or sold. Tokens arriving in a wallet are not a
 * purchase and tokens leaving are not a sale — the same rule the rest of this
 * page runs on — so this reports the size of a position and stops there.
 */
export function holdingChange(move, { symbol = '' } = {}) {
  if (!move) {
    return { text: '…', tone: 'cw-th-wait', note: 'Still being worked out.' };
  }
  if (!move.covered) {
    return {
      text: '—',
      tone: 'cw-th-wait',
      note: 'This wallet moves too often for its transfer history to reach back thirty days.',
    };
  }

  const held = (n) => (Number.isFinite(n)
    ? `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}${symbol ? ` ${symbol}` : ''}`
    : '—');

  /**
   * Opened inside the window, so there is no earlier size to be a share of.
   * Reported as new rather than as an infinite percentage.
   */
  if (move.fromNothing || (move.unitsThen != null && move.unitsThen <= 0)) {
    return {
      text: 'New',
      tone: 'cw-in',
      note: `The whole position was opened in the last 30 days — 0 → ${
        held(move.unitsThen + (move.netUnits ?? 0))}. There is no earlier size to measure against.`,
    };
  }

  if (move.pct == null || Math.abs(move.pct) < UNCHANGED_PCT) {
    return {
      text: 'Unchanged',
      tone: '',
      note: move.transfers
        ? `Tokens moved, but the position is the size it was: ${held(move.unitsThen)} 30 days ago.`
        : `Not one movement in 30 days. Still ${held(move.unitsThen)}.`,
    };
  }

  const up = move.pct > 0;
  return {
    text: `${up ? '+' : '−'}${Math.abs(move.pct).toFixed(1)}%`,
    tone: up ? 'cw-in' : 'cw-out',
    note: `${up ? 'Grew' : 'Shrank'} ${Math.abs(move.pct).toFixed(1)}% of the position in 30 days: `
      + `${held(move.unitsThen)} → ${held(move.unitsThen + move.netUnits)}.`
      + (up ? '' : ' Where it went is a separate question.'),
  };
}
