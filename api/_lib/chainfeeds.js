/**
 * The chains this app can actually watch, and how it watches each one.
 *
 * Written after the first version shipped depending on a single keyed provider
 * and therefore showed nothing at all until somebody bought a key. That is not
 * a tracker, it is a placeholder, so this is the keyless half: five public
 * endpoints that need no credential and return real transfers today.
 *
 * Every chain answers a different shape and none of them agree on anything —
 * one gives amounts in wei with a USD rate attached, one in sun with no rate,
 * one in drops, one in satoshis spread across outputs. Each adapter's whole job
 * is to turn its own source into the one row shape in `normalise` below, so
 * that the store, the bands and the panel never learn which chain a row came
 * from.
 *
 * What each source can and cannot do is recorded honestly in COVERAGE_NOTE,
 * because two of them are samples rather than sweeps and a panel that implied
 * otherwise would be claiming completeness it does not have.
 */

/**
 * What is worth *recording*, which is not the same as what is worth showing.
 *
 * These were the same number and that was the mistake. At a twenty-million
 * floor a wallet buying three million dollars ten times over a fortnight is
 * invisible — every piece is discarded, so the position it was building can
 * never be added up. The single transfer was the only thing that could ever
 * qualify, which meant the panel could only ever answer "who moved a lot at
 * once", never "who has been accumulating".
 *
 * So collection drops to a million and display keeps its own floor. It costs
 * nothing: these rows arrive in the same responses already being fetched and
 * were simply being thrown away.
 */
export const FLOOR_USD = 1_000_000;

/** What the transfer list shows. The bands in the UI start here. */
export const DISPLAY_FLOOR_USD = 20_000_000;

/**
 * Nothing on any chain is one transfer of twenty-five billion dollars.
 *
 * A ceiling rather than a filter. The first live scan produced a row reading
 * $27,870,034,145,600,000,000 — twenty-seven quintillion — from a token called
 * AIPF whose indexer-supplied exchange rate was fiction. Every number above
 * this is a decimals mismatch or an invented rate, never news, and one of them
 * on screen discredits every honest row beside it.
 */
const CEILING_USD = 25_000_000_000;

/**
 * A token is worth what CoinGecko says it is worth, or it is not shown.
 *
 * This is the rule that keeps scam tokens off the panel. Anyone can deploy a
 * contract, mint a quadrillion units and have an indexer quote a price for it,
 * and at a twenty-million-dollar floor that garbage outranks every real
 * transfer. CoinGecko's list is not a perfect filter but it is an independent
 * one, and an asset nobody has listed is not one whales are moving.
 *
 * Where the chain also supplies a rate it is used only to disagree: a gap of
 * more than five times between two independent quotes means at least one of
 * them is wrong, and a row valued on a number that might be the wrong one is
 * dropped rather than shown.
 */
/**
 * Wrappers are the asset they wrap, and are priced as it.
 *
 * Not a guess: WETH is redeemable one-for-one for ETH by the contract itself,
 * and WBTC against custodied BTC. They matter because they are where the large
 * on-chain moves actually happen — twenty-four of two hundred Ethereum
 * transfers in one sample were WETH — and CoinGecko does not always rank a
 * wrapper inside the depth this app fetches, which was leaving the single most
 * valuable feed on the chain unpriced and therefore invisible.
 */
const WRAPPED = { WETH: 'ETH', WBTC: 'BTC', WSTETH: 'ETH', STETH: 'ETH', CBBTC: 'BTC' };

export function priceFor(symbol, prices, chainRate) {
  const listed = prices?.get(symbol) ?? prices?.get(WRAPPED[symbol]);
  if (!listed) return null;
  if (Number.isFinite(chainRate) && chainRate > 0) {
    const ratio = chainRate / listed;
    if (ratio > 5 || ratio < 0.2) return null;
  }
  return listed;
}

const ZERO_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', // Tron's burn address
]);

/**
 * One transfer, however it arrived.
 *
 * `kind` is the field that stops this misleading people. A hundred million
 * dollars moving between two contracts inside one atomic transaction is not a
 * whale deciding something, and the very first real scan of Ethereum returned
 * exactly that: six legs of one Morpho flash loan, three in and three out,
 * every one of them over twenty million. They are real and they are on-chain
 * and they are not what anyone means by a whale transfer, so they are labelled
 * `contract` and can be told apart at a glance.
 */
export function normalise({
  chain, symbol, amount, usd, hash, at, from, to, parts = 1, kind,
}) {
  if (!hash || !chain || !symbol) return null;
  if (!Number.isFinite(usd) || usd < FLOOR_USD || usd > CEILING_USD) return null;
  if (!Number.isFinite(at) || at <= 0) return null;

  const side = (v) => ({
    address: v?.address ? String(v.address) : null,
    // Only ever the source's own label. An address nobody has attributed stays
    // unattributed; guessing would invent the most important field on screen.
    owner: v?.owner ? String(v.owner).trim() : null,
    ownerType: v?.ownerType ? String(v.ownerType).toLowerCase() : null,
    contract: !!v?.contract,
  });

  const f = side(from);
  const t = side(to);

  let type = kind;
  if (!type) {
    if (f.address && ZERO_ADDRESSES.has(f.address)) type = 'mint';
    else if (t.address && ZERO_ADDRESSES.has(t.address)) type = 'burn';
    else if (f.contract || t.contract) type = 'contract';
    else type = 'transfer';
  }

  /**
   * The zero address is not a counterparty and must not be dressed as one.
   *
   * Blockscout labels it "Null: 0x000...000", which the row then rendered in
   * bold as a recognised entity — so a mint read as though a party called Null
   * had sent sixty-six million dollars. Nobody sent it; it was created. The
   * label is dropped and the `mint` badge is left to say what happened.
   */
  for (const end of [f, t]) {
    if (end.address && ZERO_ADDRESSES.has(end.address)) {
      end.owner = null;
      end.ownerType = null;
    }
  }

  return {
    /**
     * One movement, not one log line.
     *
     * The value is deliberately *not* part of this. A swap emits the same asset
     * in and out of the same transaction at slightly different sizes, and
     * including the amount kept both — showing one economic event twice, with
     * the larger leg making it look bigger than it was. Different assets in one
     * transaction still separate, which is right: a loan collateralised in WBTC
     * and drawn in USDC really is two movements.
     */
    id: `${chain}:${hash}:${symbol}`,
    at: Math.floor(at),
    blockchain: chain,
    symbol: String(symbol).toUpperCase(),
    kind: type,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    usd,
    hash: String(hash),
    from: f,
    to: t,
    parts,
  };
}

const json = async (url, options) => {
  const res = await fetch(url, {
    ...options,
    signal: options?.signal,
    headers: { Accept: 'application/json', 'User-Agent': 'riskbook', ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
};

/* ── Blockscout: Ethereum and Polygon ──────────────────────────────────── */

/**
 * The best of the five, and the reason the panel works without a key.
 *
 * Blockscout returns the token's own USD exchange rate alongside the transfer,
 * so the dollar value is the source's rather than something reconstructed here,
 * and it carries public tags and contract names — which is where the entity
 * attribution comes from. Measured on a 400-transfer sweep, 187 of them arrived
 * with a name or a tag on at least one end.
 */
function blockscoutParty(end) {
  const tags = [
    ...(end?.public_tags ?? []),
    ...(end?.metadata?.tags ?? []).map((t) => t?.name ?? t?.slug),
  ].filter(Boolean);
  const name = end?.name || end?.ens_domain_name || tags[0] || null;
  return {
    address: end?.hash ?? null,
    owner: name,
    // Blockscout does not classify what a name *is*, so this does not pretend
    // to. A contract with a name is an entity; that is all that is claimed.
    ownerType: name ? (end?.is_contract ? 'contract' : 'entity') : null,
    contract: !!end?.is_contract,
  };
}

/**
 * Two sweeps, because the chain-wide one alone does not find what this panel is
 * for — and measuring that was the whole point of testing it.
 *
 * Two hundred consecutive Ethereum transfers, sampled live, held nothing above
 * four hundred thousand dollars. The tape is overwhelmingly small payments, so
 * scanning it in recency order finds a twenty-million-dollar transfer roughly
 * once in fifty thousand rows. That is not a feed, it is a lottery.
 *
 * A token's own transfer feed is a different distribution. Fifty consecutive
 * WBTC transfers covered three minutes and held five above twenty million,
 * because a token whose unit is worth eighty thousand dollars simply does not
 * carry much dust. So the contracts of the largest assets are swept
 * individually, and the chain-wide feed is kept alongside them to catch
 * whatever moves in an asset nobody thought to list.
 *
 * The contracts come from the caller, which got them from CoinGecko's own
 * platform map — so this follows the top fifty as it changes rather than a list
 * typed here.
 */
async function blockscout({ chain, host, pages = 2, prices, contracts = [], signal }) {
  const out = [];

  const scan = async (items) => {
    for (const t of items ?? []) {
      const decimals = Number(t?.total?.decimals ?? t?.token?.decimals ?? 0);
      const amount = Number(t?.total?.value) / 10 ** decimals;
      const symbol = String(t?.token?.symbol ?? '').toUpperCase();
      const price = priceFor(symbol, prices, Number(t?.token?.exchange_rate));
      if (!price) continue;
      const row = normalise({
        chain,
        symbol,
        amount,
        usd: amount * price,
        hash: t?.transaction_hash,
        at: Math.floor(new Date(t?.timestamp).getTime() / 1000),
        from: blockscoutParty(t?.from),
        to: blockscoutParty(t?.to),
      });
      if (row) out.push(row);
    }
  };

  // The chain-wide tape, walked a few pages deep.
  let url = `https://${host}/api/v2/token-transfers?type=ERC-20`;
  for (let page = 0; page < pages; page++) {
    const body = await json(url, { signal });
    await scan(body?.items);
    const next = body?.next_page_params;
    if (!next) break;
    url = `https://${host}/api/v2/token-transfers?type=ERC-20&${new URLSearchParams(next)}`;
  }

  /**
   * Then each large asset's own feed. Settled, so one dead contract costs one
   * asset; and bounded, because every contract is a request and the poll has a
   * minute to finish in.
   */
  /**
   * Four at a time, not all at once.
   *
   * Firing thirty contract requests in one burst got the third poll of the
   * yield test refused outright — a public indexer with no key is a courtesy,
   * and spending it in one breath loses the whole chain for that minute rather
   * than one contract. Four keeps the sweep inside a few seconds and inside
   * what the host will answer.
   */
  /**
   * All at once rather than in batches.
   *
   * Measured against the live host: one contract feed takes about ten seconds
   * and ten of them in parallel take about fourteen. It is slow per request and
   * entirely happy with concurrency, so the earlier batches-of-four were paying
   * that ten seconds five times over and timing the whole chain out. A contract
   * that will not answer is not worth failing the chain over, so these are
   * settled, not raced.
   */
  await Promise.allSettled(contracts.slice(0, 10).map(async (address) => {
    const body = await json(`https://${host}/api/v2/tokens/${address}/transfers`, { signal });
    await scan(body?.items);
  }));

  return out;
}

/* ── Tronscan: the biggest stablecoin venue there is ───────────────────── */

/**
 * More USDT moves on Tron than anywhere else, which is the only reason this
 * chain is worth a second adapter.
 *
 * No exchange rate comes back, so the value is the CoinGecko price for the
 * symbol. A token this app has no price for is dropped rather than valued at
 * zero and shown as a small transfer.
 */
async function tronscan({ prices, pages = 2, signal }) {
  const out = [];
  for (let page = 0; page < pages; page++) {
    const body = await json(
      'https://apilist.tronscanapi.com/api/token_trc20/transfers'
      + `?limit=50&start=${page * 50}&sort=-timestamp`,
      { signal },
    );
    const rows = body?.token_transfers ?? [];
    if (!rows.length) break;

    for (const t of rows) {
      if (t?.finalResult && t.finalResult !== 'SUCCESS') continue;
      const symbol = String(t?.tokenInfo?.tokenAbbr ?? '').toUpperCase();
      const price = prices?.get(symbol);
      if (!price) continue;
      const amount = Number(t?.quant) / 10 ** Number(t?.tokenInfo?.tokenDecimal ?? 0);
      const tag = (v) => (v && typeof v === 'object'
        ? (v.from_address_tag || v.to_address_tag || v.name || null) : null);

      const row = normalise({
        chain: 'tron',
        symbol,
        amount,
        usd: amount * price,
        hash: t?.transaction_id,
        at: Math.floor(Number(t?.block_ts) / 1000),
        from: {
          address: t?.from_address,
          owner: tag(t?.from_address_tag),
          ownerType: tag(t?.from_address_tag) ? 'entity' : null,
          contract: !!t?.fromAddressIsContract,
        },
        to: {
          address: t?.to_address,
          owner: tag(t?.to_address_tag),
          ownerType: tag(t?.to_address_tag) ? 'entity' : null,
          contract: !!t?.toAddressIsContract,
        },
      });
      if (row) out.push(row);
    }
  }
  return out;
}

/* ── XRP Ledger ────────────────────────────────────────────────────────── */

/**
 * XRPL closes a ledger every three or four seconds, and a poll can only read
 * the handful it asks for — so this is a sample of the tape rather than a sweep
 * of it. That is acceptable only because the store accumulates: what is missed
 * this minute is missed for good, but what is caught is kept forever.
 *
 * Only `Amount` given as a bare string is native XRP; an object is an issued
 * token, whose value depends on a trustline this has no price for.
 *
 * **`Amount` is not what moved.** On a partial payment it is the *maximum* the
 * sender was willing to send, and the ledger delivers whatever it can up to
 * that; the amount that actually moved is `delivered_amount` in the metadata.
 * Reading `Amount` produced eight rows of $1.41 billion in the first live test
 * — one billion XRP apiece, each from an address to itself — none of which
 * happened. So the delivered amount is used when the metadata carries one, and
 * a transaction that did not succeed is not a transfer at all.
 */
async function xrpl({ prices, ledgers = 2, signal }) {
  const price = prices?.get('XRP');
  if (!price) return [];
  const out = [];
  let index = 'validated';

  for (let i = 0; i < ledgers; i++) {
    const body = await json('https://s1.ripple.com:51234/', { signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'ledger',
        params: [{ ledger_index: index, transactions: true, expand: true }],
      }),
    });
    const ledger = body?.result?.ledger;
    if (!ledger) break;
    const closedAt = Number(body?.result?.ledger?.close_time);
    // XRPL counts seconds from 1 January 2000, not from the epoch.
    const at = Number.isFinite(closedAt) ? closedAt + 946_684_800 : null;

    for (const raw of ledger.transactions ?? []) {
      const tx = raw?.tx_json ?? raw;
      if (tx?.TransactionType !== 'Payment') continue;

      const meta = raw?.meta ?? raw?.metaData ?? null;
      if (meta?.TransactionResult && meta.TransactionResult !== 'tesSUCCESS') continue;

      // What was delivered, falling back to what was offered only when the
      // ledger did not say. Drops, and only ever native XRP.
      const moved = meta?.delivered_amount ?? tx.Amount;
      if (typeof moved !== 'string') continue;

      // An address paying itself is a sequence or fee mechanic, not a transfer.
      if (tx.Account && tx.Account === tx.Destination) continue;

      const amount = Number(moved) / 1e6;
      const row = normalise({
        chain: 'ripple',
        symbol: 'XRP',
        amount,
        usd: amount * price,
        hash: raw?.hash ?? tx?.hash,
        at,
        from: { address: tx.Account },
        to: { address: tx.Destination },
      });
      if (row) out.push(row);
    }

    const previous = Number(ledger.ledger_index ?? body?.result?.ledger_index) - 1;
    if (!Number.isFinite(previous)) break;
    index = previous;
  }
  return out;
}

/* ── Bitcoin ───────────────────────────────────────────────────────────── */

/**
 * The weakest of the five, and the report says so.
 *
 * There is no free endpoint that answers "large Bitcoin transactions". Walking
 * confirmed blocks means a hundred and twenty requests each, which a poll
 * cannot spend, so this reads the unconfirmed pool instead: one request, the
 * most recent transactions, filtered by total output.
 *
 * That is a sample. A large transfer that confirms between two polls is never
 * seen. It is included because a real sample of Bitcoin beats no Bitcoin, and
 * it is labelled as sampled rather than presented as the whole tape.
 */
async function bitcoin({ prices, signal }) {
  const price = prices?.get('BTC');
  if (!price) return [];
  const body = await json('https://blockchain.info/unconfirmed-transactions?format=json&limit=100', { signal });
  const out = [];

  for (const tx of body?.txs ?? []) {
    const outputs = tx?.out ?? [];
    const sats = outputs.reduce((sum, o) => sum + (Number(o?.value) || 0), 0);
    const amount = sats / 1e8;
    const inputs = tx?.inputs ?? [];
    const row = normalise({
      chain: 'bitcoin',
      symbol: 'BTC',
      amount,
      usd: amount * price,
      hash: tx?.hash,
      at: Number(tx?.time),
      // UTXO transactions have many of each; the largest is the one worth
      // naming, and the count is carried so the row can say it was a sweep.
      from: { address: inputs[0]?.prev_out?.addr },
      to: { address: outputs.reduce((a, b) => ((b?.value ?? 0) > (a?.value ?? 0) ? b : a), {})?.addr },
      parts: Math.max(inputs.length, outputs.length),
    });
    if (row) out.push(row);
  }
  return out;
}

/* ── the registry ──────────────────────────────────────────────────────── */

/**
 * Every chain with a working keyless feed.
 *
 * `platform` is CoinGecko's own id for the network, which is what lets a top
 * fifty coin be matched to a chain by its actual contract address rather than
 * by a table someone typed. `native` is the coin the chain itself runs on.
 */
export const CHAINS = [
  {
    id: 'ethereum',
    label: 'Ethereum',
    platform: 'ethereum',
    native: 'ETH',
    tokens: true,
    complete: true,
    fetch: (ctx) => blockscout({ ...ctx, chain: 'ethereum', host: 'eth.blockscout.com', contracts: ctx.contracts?.ethereum }),
  },
  {
    id: 'polygon',
    label: 'Polygon',
    platform: 'polygon-pos',
    native: 'POL',
    tokens: true,
    complete: true,
    fetch: (ctx) => blockscout({ ...ctx, chain: 'polygon', host: 'polygon.blockscout.com', contracts: ctx.contracts?.polygon }),
  },
  {
    id: 'tron',
    label: 'Tron',
    platform: 'tron',
    native: 'TRX',
    tokens: true,
    complete: true,
    fetch: tronscan,
  },
  {
    id: 'ripple',
    label: 'XRP Ledger',
    platform: 'xrp',
    native: 'XRP',
    tokens: false,
    complete: false,
    fetch: xrpl,
  },
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    platform: 'bitcoin',
    native: 'BTC',
    tokens: false,
    complete: false,
    fetch: bitcoin,
  },
];

/** Said on the panel, so a sampled chain is never mistaken for a swept one. */
export const COVERAGE_NOTE = {
  ripple: 'Sampled: the most recent ledgers each poll, not the whole tape.',
  bitcoin: 'Sampled: the unconfirmed pool each poll, not every confirmed block.',
};

export const chainById = (id) => CHAINS.find((c) => c.id === id) ?? null;

/**
 * Ask every chain at once and keep whatever answers.
 *
 * Settled rather than raced: one source being down costs its own chain and
 * nothing else, which is the difference between a thinner panel and an empty
 * one. Which sources failed is returned rather than swallowed, because the
 * panel has to be able to say so.
 */
export async function collect({ prices, contracts = {}, budgetMs = 22_000 }) {
  /**
   * A hard deadline on the whole sweep.
   *
   * Measured before this existed: one poll of every chain took sixty-three
   * seconds, which a serverless function does not have. It does not matter —
   * the store is what the panel reads, and a sweep that is cut off has simply
   * written less this minute than it might have. Everything gathered before the
   * deadline is kept; what was in flight is dropped and asked for again next
   * time. Blocking the page for a minute to be thorough would be the wrong
   * trade even where the platform allowed it.
   */
  const clock = AbortSignal.timeout(budgetMs);
  const answers = await Promise.allSettled(
    CHAINS.map((c) => c.fetch({ prices, contracts, signal: clock })),
  );
  const rows = [];
  const failed = [];

  answers.forEach((answer, i) => {
    if (answer.status === 'fulfilled') rows.push(...answer.value);
    else {
      const why = answer.reason?.name === 'TimeoutError' || answer.reason?.name === 'AbortError'
        ? 'ran out of time this poll' : (answer.reason?.message ?? 'failed');
      failed.push({ chain: CHAINS[i].id, error: why });
    }
  });

  /**
   * One transfer can arrive twice inside a single sweep — Blockscout pages
   * overlap when a block lands mid-walk, and a swap emits the same leg from two
   * log indices. The id carries the chain, the hash, the symbol and the value,
   * so identical rows collapse and genuinely separate legs of one transaction
   * survive as themselves.
   */
  const unique = new Map();
  for (const row of rows) unique.set(row.id, row);

  return { rows: [...unique.values()], failed };
}
