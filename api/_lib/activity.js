/**
 * What one whale transfer actually was.
 *
 * The Live Whale Activity table asks five questions of every row — how much,
 * from where to where, what asset changed, what kind of movement it was, and
 * when — and four of those five are answered here. The fifth is a timestamp.
 *
 * ── The rule this file exists to enforce ─────────────────────────────────
 *
 * **Nothing is called a buy or a sell unless the chain shows both legs.** A
 * swap through a decentralised exchange shows them: the asset that went in and
 * the asset that came back are in the same transaction, so the trade is a fact
 * and can be named one. A deposit to Binance shows one leg and nothing else.
 * The coins are now somewhere selling is possible, which is not the same as
 * sold, and the whale may have deposited to lend, to post margin, to move
 * venue, or to sell nothing at all.
 *
 * So `Exchange Deposit` is its own action, carries "sale not confirmed", and
 * never becomes `Sell / Swap` however suggestive the size. The eight actions
 * below are exhaustive and `Unknown` is a real answer that gets used — most
 * large transfers on any chain are between addresses nobody has attributed,
 * and saying so is the honest version of not knowing.
 */
import { exchangeOf } from './exchanges.js';

/** The eight, and the only eight. */
export const ACTIONS = {
  BUY: 'Buy / Swap',
  SELL: 'Sell / Swap',
  DEPOSIT: 'Exchange Deposit',
  WITHDRAWAL: 'Exchange Withdrawal',
  TRANSFER: 'Wallet Transfer',
  BRIDGE: 'Bridge',
  INTERNAL: 'Internal Transfer',
  UNKNOWN: 'Unknown',
};

/** Only a swap earns a colour, because only a swap is a confirmed direction. */
export const ACTION_TONE = {
  [ACTIONS.BUY]: 'cw-in',
  [ACTIONS.SELL]: 'cw-out',
  [ACTIONS.DEPOSIT]: 'cw-warn',
  [ACTIONS.WITHDRAWAL]: '',
  [ACTIONS.TRANSFER]: '',
  [ACTIONS.BRIDGE]: '',
  [ACTIONS.INTERNAL]: '',
  [ACTIONS.UNKNOWN]: '',
};

/** Dollars by another name. A swap out of one is a purchase of the other. */
const STABLE = new Set(['USDT', 'USDC', 'DAI', 'USDE', 'USDS', 'PYUSD', 'USD1',
  'RLUSD', 'USDG', 'FDUSD', 'TUSD', 'BUSD', 'USDD', 'LUSD', 'GUSD', 'FRAX']);

export const isStable = (symbol) => STABLE.has(String(symbol ?? '').toUpperCase());

/** Addresses that are not a party: tokens are created from and destroyed at them. */
const NULL_ADDRESS = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  't9yd14nj9j7xab4dbgeix9h8unkkhxuwwb',
]);

const BRIDGE_RE = /bridge|wormhole|stargate|across protocol|portal|hop protocol|synapse|celer|layerzero|omnibridge|orbiter|debridge/i;

/**
 * What to call one end of a transfer.
 *
 * The label set first, because a venue name is the strongest attribution
 * available and the one the reader most wants. Then whatever name the indexer
 * carried — that is where "Uniswap V3: Router" comes from. Then "Wallet",
 * which is not a guess: an address nobody has attributed is somebody's wallet
 * as far as anything here can tell, and calling it Binance because the amount
 * was round would be inventing the most important field on the screen.
 */
export function endLabel(end, byAddress) {
  const address = end?.address ?? null;
  if (address && NULL_ADDRESS.has(String(address).toLowerCase())) return 'Null address';

  const venue = exchangeOf(address, byAddress);
  if (venue) return venue.venue;

  const owner = String(end?.owner ?? '').trim();
  if (owner) return owner;

  return address ? 'Wallet' : 'Unknown';
}

/** True when this end is a centralised venue, by label or by carried type. */
function venueOf(end, byAddress) {
  const venue = exchangeOf(end?.address, byAddress);
  if (venue) return venue.venue;
  if (String(end?.ownerType ?? '') === 'exchange' && end?.owner) return String(end.owner);
  return null;
}

const isBridge = (end) => BRIDGE_RE.test(String(end?.owner ?? ''));
const isContract = (end) => String(end?.ownerType ?? '') === 'contract';

/**
 * Which way a confirmed swap ran, from the point of view of whoever is asking.
 *
 * A swap is symmetric — USDT to ETH is a purchase of ETH and a sale of USDT at
 * the same instant — so "buy" or "sell" only means something once a subject is
 * chosen. Three ways of choosing one, most reliable first:
 *
 *   the coin picker  — the reader asked about ETH, so answer about ETH
 *   the stablecoin   — nobody buys dollars; leaving them is a purchase
 *   this row's asset — every row is one leg, and the leg names its own side
 */
function swapAction(swap, { subject = null, symbol = null } = {}) {
  const from = String(swap.from ?? '').toUpperCase();
  const to = String(swap.to ?? '').toUpperCase();
  const want = String(subject ?? '').toUpperCase();

  if (want && to === want) return ACTIONS.BUY;
  if (want && from === want) return ACTIONS.SELL;

  if (isStable(from) && !isStable(to)) return ACTIONS.BUY;
  if (isStable(to) && !isStable(from)) return ACTIONS.SELL;

  return String(symbol ?? '').toUpperCase() === to ? ACTIONS.BUY : ACTIONS.SELL;
}

/**
 * The four answers, for one transfer.
 *
 * Ordered most specific first, and every branch rests on something observable:
 * a matched pair of legs, an address in the label set, a name the indexer
 * carried. An address matching none of them falls through to Wallet Transfer,
 * which asserts only that it moved.
 *
 * @param {object} t          a stored transfer, optionally carrying `swap`
 * @param {Map}    byAddress  the exchange label set, when it loaded
 * @param {string} subject    the selected coin, which decides buy from sell
 */
export function classifyActivity(t, { byAddress = null, subject = null } = {}) {
  const from = t?.from ?? {};
  const to = t?.to ?? {};
  const symbol = t?.symbol ?? '';
  const kind = String(t?.kind ?? 'transfer').toLowerCase();

  const fromLabel = endLabel(from, byAddress);
  const toLabel = endLabel(to, byAddress);

  /** The asset column. Same symbol both sides means no conversion was seen. */
  const assetFrom = t?.swap?.from ?? symbol;
  const assetTo = t?.swap?.to ?? symbol;
  const base = {
    fromLabel,
    toLabel,
    path: `${fromLabel} → ${toLabel}`,
    assetFrom,
    assetTo,
    assetFlow: `${assetFrom} → ${assetTo}`,
    swapped: !!t?.swap,
  };

  const fromVenue = venueOf(from, byAddress);
  const toVenue = venueOf(to, byAddress);

  // Both legs in one transaction. The only case where a trade can be asserted.
  if (t?.swap) {
    const action = swapAction(t.swap, { subject, symbol });
    return {
      ...base,
      action,
      confirmed: true,
      note: action === ACTIONS.BUY
        ? `Confirmed swap into ${assetTo} — both legs on-chain in one transaction`
        : `Confirmed swap out of ${assetFrom} — both legs on-chain in one transaction`,
    };
  }

  /**
   * Created or destroyed. Neither end is a counterparty, so neither is a
   * direction — and the null address is read directly rather than trusting the
   * kind field, because the chain readers do not all set it. Real rows arrived
   * as `Null address → CrossChainTeller` and were being classified on the
   * receiving contract, which described the second half of a mint as though it
   * were somebody moving money.
   */
  const fromNull = !!from.address && NULL_ADDRESS.has(String(from.address).toLowerCase());
  const toNull = !!to.address && NULL_ADDRESS.has(String(to.address).toLowerCase());
  if (kind === 'mint' || kind === 'burn' || fromNull || toNull) {
    return {
      ...base,
      action: ACTIONS.UNKNOWN,
      confirmed: false,
      note: (kind === 'mint' || fromNull) ? 'New supply issued, not traded'
        : 'Tokens destroyed, not traded',
    };
  }

  // A wallet paying itself, or one venue tidying its own wallets. Neither is a trade.
  const sameAddress = from.address && to.address
    && String(from.address).toLowerCase() === String(to.address).toLowerCase();
  if (sameAddress || (fromVenue && toVenue)) {
    return {
      ...base,
      action: ACTIONS.INTERNAL,
      confirmed: false,
      note: sameAddress ? 'The address paid itself — no change of hands'
        : fromVenue === toVenue ? `${fromVenue} moving its own float between wallets`
          : `Custody moved from ${fromVenue} to ${toVenue}, still custodial`,
    };
  }

  if (isBridge(to) || isBridge(from)) {
    return {
      ...base,
      action: ACTIONS.BRIDGE,
      confirmed: false,
      note: 'The position changed chain, not hands',
    };
  }

  if (toVenue) {
    return {
      ...base,
      action: ACTIONS.DEPOSIT,
      confirmed: false,
      /** The most important sentence in this file. See the note at the top. */
      note: `Sent to ${toVenue} — sale not confirmed`,
    };
  }

  if (fromVenue) {
    return {
      ...base,
      action: ACTIONS.WITHDRAWAL,
      confirmed: false,
      note: `Withdrawn from ${fromVenue} — purchase not confirmed`,
    };
  }

  // Into a contract with no return leg in the record. Could be a trade, a
  // deposit, a loan or a stake, and the contract does not say which.
  if (isContract(to)) {
    return {
      ...base,
      action: ACTIONS.UNKNOWN,
      confirmed: false,
      note: `Sent to ${toLabel} — no matching return leg in the record`,
    };
  }

  return {
    ...base,
    action: ACTIONS.TRANSFER,
    confirmed: false,
    note: 'Moved between wallets — nothing observable happened to it',
  };
}
