/**
 * Leveraged positions, from Hyperliquid's public API.
 *
 * The gap this closes is the largest one left. A whale that wants to be short
 * fifty million dollars of ETH does not sell any: it opens a perpetual, and
 * **nothing moves on chain at all**. Every tracker in this app watches transfers
 * or balances, and both of them see exactly nothing while that position is
 * opened, held and closed. The selling pressure is real and the tape is silent.
 *
 * Hyperliquid answers for any address without a key, which makes it the one
 * venue where this is observable at all — the centralised exchanges publish
 * aggregate open interest and never say whose. So this is not a complete
 * picture of leverage and is not offered as one: it is one venue, and a wallet
 * with nothing here may still be short somewhere that does not tell.
 *
 * Looked up per address, on demand, rather than swept. A position matters when
 * you are already asking about a particular wallet, and fifty lookups a poll to
 * populate a column that is usually empty would be a poor trade.
 */

const ENDPOINT = 'https://api.hyperliquid.xyz/info';

async function ask(body, { signal, fetcher = fetch } = {}) {
  const res = await fetcher(ENDPOINT, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid answered ${res.status}`);
  return res.json();
}

/**
 * What one address is holding on Hyperliquid.
 *
 * Returns an empty list rather than null for an address with no positions,
 * because "looked and found nothing" and "could not look" are different answers
 * and the panel has to be able to tell them apart.
 */
export async function positionsFor(address, { signal, fetcher = fetch } = {}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(address ?? ''))) {
    // Only EVM addresses exist on Hyperliquid; a Bitcoin address is not a
    // failed lookup, it is a question that does not apply.
    return { supported: false, positions: [], accountValue: null };
  }

  const state = await ask({ type: 'clearinghouseState', user: address }, { signal, fetcher });

  const positions = [];
  for (const entry of state?.assetPositions ?? []) {
    const p = entry?.position;
    const size = Number(p?.szi);
    if (!Number.isFinite(size) || size === 0) continue;

    const notional = Math.abs(Number(p?.positionValue) || 0);
    positions.push({
      coin: String(p?.coin ?? ''),
      // Negative size is short. That is the whole point of looking.
      side: size < 0 ? 'short' : 'long',
      size: Math.abs(size),
      notionalUsd: notional,
      entryPx: Number(p?.entryPx) || null,
      unrealisedUsd: Number(p?.unrealizedPnl) || 0,
      leverage: Number(p?.leverage?.value) || null,
      liquidationPx: Number(p?.liquidationPx) || null,
    });
  }

  positions.sort((a, b) => b.notionalUsd - a.notionalUsd);

  return {
    supported: true,
    accountValue: Number(state?.marginSummary?.accountValue) || 0,
    positions,
    /**
     * The net direction across everything, which is the one-line answer.
     * A wallet long one coin and short another is neither, and says so.
     */
    netUsd: positions.reduce((s, p) => s + (p.side === 'short' ? -p.notionalUsd : p.notionalUsd), 0),
  };
}
