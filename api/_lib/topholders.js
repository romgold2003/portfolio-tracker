/**
 * Who holds the most of one coin right now, and what happened when one left.
 *
 * Two tables with one subject. The upper one is a snapshot: the twenty-five
 * largest holders of whatever coin is selected, ranked by what they are worth
 * today. The lower one is the interesting half — when one of them materially
 * reduced a position, where did the tokens actually go, and can a sale be
 * *confirmed* or only suspected?
 *
 * ── The rule that shapes everything below ────────────────────────────────
 *
 * **Tokens arriving at a centralised exchange are not a sale.** The chain shows
 * them entering; whatever happened inside the exchange is not on any ledger
 * this app can read, and the whale may have deposited to lend, to post margin,
 * to move venues, or to sell nothing at all. Calling that "sold" would be the
 * single most confident wrong thing this app could say, so it says
 * "Transferred to exchange — sale not confirmed" and means it.
 *
 * A swap through a decentralised exchange is different in kind: both legs are
 * on-chain, the asset that came back is named in the same transaction, and the
 * sale can be asserted because it can be shown.
 *
 * ── Leaving the top twenty-five is not an event ──────────────────────────
 *
 * A holder can drop out of the ranking two ways: it sold, or somebody else
 * bought more and pushed it down. Only the first is behaviour. Reporting the
 * second would invent an exit every time a new buyer appeared, which is both
 * wrong and exactly backwards — somebody accumulating is bullish, and it would
 * have surfaced as a whale leaving. Events therefore come from **balances
 * falling**, never from ranks changing.
 */
import { exchangeOf } from './exchanges.js';

/** Nothing lives here. Tokens sent to these are destroyed. */
const BURN = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000042069420694206942069',
  't9yd14nj9j7xab4dbgeix9h8unkkhxuwwb',
]);

/**
 * What an address is, from what the chain and the indexer already say.
 *
 * Ordered most specific first. Every branch rests on something observable — a
 * label, the creator record, the contract flag — and an address that matches
 * none of them is left as an unknown whale rather than being sorted somewhere
 * on a hunch.
 */
const PATTERNS = [
  { kind: 'bridge', re: /bridge|wormhole|stargate|across|portal|hop protocol|synapse|celer|layerzero|omnibridge/i },
  { kind: 'custodian', re: /custody|custodian|fireblocks|bitgo|anchorage|copper\.co|coinbase custody|ceffu/i },
  { kind: 'treasury', re: /safe|multisig|gnosis|timelock|vesting|treasury|foundation|dao\b/i },
  { kind: 'staking', re: /staking|stake pool|deposit contract|validator|lido|rocket ?pool/i },
];

/** The kinds that are not somebody taking a position. */
export const NOT_AN_INVESTOR = new Set(['burn', 'exchange', 'custodian', 'treasury', 'contract', 'bridge', 'staking']);

export function classifyHolder({ address, name, isContract, creator, byAddress } = {}) {
  const a = String(address ?? '').toLowerCase();
  if (a && BURN.has(a)) return 'burn';

  // The label set is the strongest evidence available for a venue.
  const venue = exchangeOf(address, byAddress);
  if (venue) return 'exchange';

  if (creator && a && a === String(creator).toLowerCase()) return 'treasury';

  const label = String(name ?? '');
  if (label) {
    for (const p of PATTERNS) if (p.re.test(label)) return p.kind;
  }

  if (isContract) return 'contract';
  return 'whale';
}

/** How each kind should read on screen. */
export const HOLDER_LABEL = {
  whale: 'Whale',
  exchange: 'Exchange',
  custodian: 'Custodian',
  treasury: 'Treasury',
  contract: 'Contract',
  bridge: 'Bridge',
  staking: 'Staking',
  burn: 'Burn address',
};

/**
 * The top twenty-five, ranked by what they are worth now.
 *
 * `investorsOnly` drops burn holes, exchanges, bridges, staking contracts and
 * treasuries. They are frequently the biggest addresses on any token and none
 * of them is a whale with a view: an exchange's balance is its customers'
 * coins, a staking contract's is everybody's, and a burn address holds what
 * nobody will ever hold again. Ranking them alongside investors would put four
 * non-opinions at the top of a table about opinions.
 *
 * They are still returned, marked, when `investorsOnly` is off — seeing that
 * an exchange holds a fifth of the supply is worth knowing, it is just not a
 * whale ranking.
 */
export function rankHolders(rows, {
  price = null, totalSupply = null, byAddress = null, creator = null,
  limit = 25, investorsOnly = true,
} = {}) {
  const out = [];

  for (const r of rows ?? []) {
    const units = Number(r.units ?? r.value);
    if (!Number.isFinite(units) || units <= 0) continue;

    const kind = classifyHolder({
      address: r.holder ?? r.address,
      name: r.name,
      isContract: r.isContract ?? r.is_contract,
      creator,
      byAddress,
    });
    if (investorsOnly && NOT_AN_INVESTOR.has(kind)) continue;

    const venue = exchangeOf(r.holder ?? r.address, byAddress);
    out.push({
      address: r.holder ?? r.address,
      name: venue?.name ?? r.name ?? null,
      kind,
      kindLabel: HOLDER_LABEL[kind] ?? kind,
      units,
      usd: price ? units * price : null,
      /** Null rather than zero when the supply is unknown: absent, not none. */
      pctSupply: totalSupply > 0 ? Math.round((units / totalSupply) * 10000) / 100 : null,
    });
  }

  return out
    .sort((a, b) => (b.usd ?? b.units) - (a.usd ?? a.units))
    .slice(0, limit)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

/* ── what happened when one left ───────────────────────────────────────── */

/** How much of a position has to go before it is worth reporting. */
export const MATERIAL_PCT = 10;
export const MATERIAL_USD = 1_000_000;

/**
 * Where the tokens went, and whether that settles anything.
 *
 * Four destinations, and only one of them permits the word "sold":
 *
 *   exchange  — the tokens entered a venue. Nothing more can be said.
 *   dex swap  — both legs are on-chain, so the trade is a fact.
 *   bridge    — the position moved chain, not hands.
 *   wallet    — it moved, and nothing is known about why.
 */
export function describeMove(transfer, { byAddress } = {}) {
  const to = transfer.to?.address ?? transfer.to_addr;
  const venue = exchangeOf(to, byAddress);

  if (transfer.swap) {
    return {
      action: 'Swapped',
      status: 'Sold / swapped',
      confirmed: true,
      destination: 'DEX',
      soldAsset: transfer.swap.from,
      gotAsset: transfer.swap.to,
      note: `Both legs on-chain in one transaction — the trade is observable.`,
    };
  }

  if (venue) {
    return {
      action: 'Deposit',
      status: 'Transferred to exchange',
      confirmed: false,
      destination: venue.venue,
      soldAsset: transfer.symbol,
      gotAsset: null,
      /**
       * The most important sentence in this file. Whatever the exchange did
       * with them afterwards is not on any ledger available here.
       */
      note: 'Potential sell-side activity — sale not confirmed',
    };
  }

  const name = String(transfer.to?.owner ?? transfer.to_owner ?? '');
  if (/bridge|wormhole|stargate|across|portal|synapse|celer/i.test(name)) {
    return {
      action: 'Bridged',
      status: 'Moved to another chain',
      confirmed: false,
      destination: name || 'Bridge',
      soldAsset: transfer.symbol,
      gotAsset: null,
      note: 'The position changed chain, not hands.',
    };
  }

  if (transfer.kind === 'contract' || transfer.to?.ownerType === 'contract' || transfer.to_type === 'contract') {
    return {
      action: 'Contract',
      status: 'Sent to a contract',
      confirmed: false,
      destination: name || 'Contract',
      soldAsset: transfer.symbol,
      gotAsset: null,
      note: 'Could be a deposit, a loan or a stake — the contract does not say.',
    };
  }

  return {
    action: 'Transfer',
    status: 'Wallet transfer — no sale detected',
    confirmed: false,
    destination: 'Wallet',
    soldAsset: transfer.symbol,
    gotAsset: null,
    note: 'Nothing observable happened to it beyond the move.',
  };
}

/**
 * Holders that materially reduced, with the movement that explains it.
 *
 * `changes` are balance differences from the holder record; `transfers` are the
 * recorded on-chain movements. The join is the address: a holder whose balance
 * fell is looked up in the transfer record to find what it actually sent, and
 * the largest such transfer is the one that carries the story.
 *
 * A fall with no matching transfer is still reported — the record does not see
 * every chain or every moment — but with nothing asserted about where it went.
 */
export function exitEvents({
  changes = [], transfers = [], byAddress = null, symbol = null, limit = 20,
} = {}) {
  const sent = new Map();
  for (const t of transfers) {
    const from = t.from?.address ?? t.from_addr;
    if (!from) continue;
    if (symbol && t.symbol !== symbol) continue;
    const key = from.toLowerCase();
    const prior = sent.get(key);
    // The largest outgoing move is the one that explains the fall.
    if (!prior || Number(t.usd) > Number(prior.usd)) sent.set(key, t);
  }

  const out = [];
  for (const c of changes) {
    // Only a fall, and only a material one. See the note at the top: a holder
    // pushed down the ranking by somebody else buying has not done anything.
    if (!(c.usdDelta < 0)) continue;
    if (Math.abs(c.pct) < MATERIAL_PCT && Math.abs(c.usdDelta) < MATERIAL_USD) continue;

    const t = sent.get(String(c.holder).toLowerCase());
    const move = t ? describeMove(t, { byAddress }) : {
      action: 'Reduced',
      status: 'Reduction seen, route unknown',
      confirmed: false,
      destination: null,
      soldAsset: c.symbol,
      gotAsset: null,
      note: 'The balance fell but no matching transfer is in the record.',
    };

    out.push({
      holder: c.holder,
      name: c.name,
      symbol: c.symbol,
      unitsBefore: c.unitsBefore,
      unitsAfter: c.unitsAfter,
      unitsMoved: Math.abs(c.unitsDelta),
      usdMoved: Math.abs(c.usdDelta),
      pct: c.pct,
      from: t?.from?.address ?? c.holder,
      to: t?.to?.address ?? null,
      chain: t?.blockchain ?? c.chain,
      hash: t?.hash ?? null,
      at: t?.at ?? c.at,
      ...move,
    });
  }

  return out.sort((a, b) => b.usdMoved - a.usdMoved).slice(0, limit);
}
