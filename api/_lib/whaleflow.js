/**
 * What the whales are doing, rather than what one of them did once.
 *
 * The transaction tracker answers "did anyone move $20M". That question misses
 * the case it most needs to catch: a wallet that wants a large position and
 * does not want to be seen taking it will take it in pieces, and every piece
 * falls under the threshold. Nothing about that behaviour is exotic — it is
 * what anyone competent does — and a tracker that only watches for single large
 * transfers is blind to it by construction.
 *
 * So these are aggregations over the recorded transfers, not a new feed. Every
 * number here comes from rows the app already collected, which is why the
 * collection floor was dropped to a million: the pieces have to be kept for the
 * total to exist.
 *
 * Everything in this file is a pure function of rows in, numbers out, so each
 * claim it makes can be tested against a book that is known.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────
 *
 * **Entity clustering.** Grouping several wallets under one owner needs
 * attribution this app cannot get: the free indexers return no label at all for
 * the addresses that matter — Binance's main hot wallet comes back with
 * `name: null` and no tags. Guessing that two addresses share an owner because
 * they transact together is exactly the "weak guess" that must not be made, so
 * an address is an address and where a source does give a name it is used and
 * nowhere else.
 *
 * **Lifetime profit and loss.** A real smart-money score needs every position a
 * wallet ever took, entered and exited, priced at the time. That is a different
 * product with a different data bill. What `performance()` computes instead is
 * narrower and honest about it, and it refuses to produce a number at all when
 * there is not enough observed history to support one.
 */

/** The windows the panel offers, in hours. */
export const WINDOWS = [
  { id: '1w', label: '1W', hours: 24 * 7 },
  { id: '1m', label: '1M', hours: 24 * 31 },
  { id: '3m', label: '3M', hours: 24 * 92 },
  { id: '1y', label: '1Y', hours: 24 * 366 },
  // Everything recorded. Not a claim about a year — a claim about the record,
  // which began the first time the collector ran and grows from there.
  { id: 'all', label: 'All', hours: Infinity },
];

/**
 * Falls back by name, not by index.
 *
 * It used to return WINDOWS[3], which was the week until 6h was removed and
 * became the month the moment the array shifted — a default that changes
 * because a neighbour was deleted is a trap waiting for the next edit.
 */
export const windowDef = (id) => WINDOWS.find((w) => w.id === id)
  ?? WINDOWS.find((w) => w.id === '1m');

/** Addresses that are not wallets: the holes tokens are minted from and burnt into. */
const VOID = new Set([
  '0x0000000000000000000000000000000000000000',
  'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
]);

/**
 * Movements that are a wallet taking or shedding a position.
 *
 * A mint is issuance, a burn is redemption and a contract leg is usually one
 * half of an atomic operation that also had the other half. None of the three
 * is somebody deciding to own more of something, and counting them as
 * accumulation is the single easiest way to make this whole file lie.
 */
const POSITIONAL = new Set(['transfer']);

/**
 * Per-wallet flow over a window.
 *
 * `received` and `sent` rather than "bought" and "sold", and the distinction is
 * not pedantry. Without exchange labels this app cannot see a trade — it sees
 * coins arriving at an address. Coins arriving is accumulation in the only
 * sense the chain can prove, and calling it a purchase would assert a
 * counterparty and an intent that are not in the data.
 *
 * **`minTransfers` is what stops this listing every transfer twice.** Every
 * transfer credits a receiver and debits a sender, so a wallet seen exactly
 * once always arrives paired with its own mirror image: +$102.8M against
 * −$102.8M, the same event written from both ends, netting to nothing and
 * filling half the list with rows that say what the transfer list already said.
 *
 * A wallet with one transfer has no position to speak of — it has an event, and
 * events belong in the transfer list. Requiring two makes the mirrors collapse
 * on their own: a buyer taking from ten sellers appears once with ten
 * transfers, while each seller, having done one thing, does not appear at all.
 * That asymmetry is the signal, and it only shows once single events are out of
 * the way.
 */
export function accumulation(rows, {
  hours = 24 * 31, now = Date.now(), symbol = null, minTransfers = 1,
} = {}) {
  // Infinity means the whole record, so nothing is cut off.
  const cutoff = Number.isFinite(hours) ? Math.floor(now / 1000) - hours * 3600 : -Infinity;
  const wallets = new Map();

  const touch = (address, owner, row, direction) => {
    if (!address || VOID.has(address)) return;
    let w = wallets.get(address);
    if (!w) {
      w = {
        address,
        owner: owner || null,
        receivedUsd: 0,
        sentUsd: 0,
        transfers: 0,
        chains: new Set(),
        symbols: new Map(),
        /** Token quantities, kept apart from dollars so a position can be marked. */
        units: new Map(),
        firstAt: Infinity,
        lastAt: 0,
        largest: 0,
      };
      wallets.set(address, w);
    }
    if (!w.owner && owner) w.owner = owner;

    const usd = Number(row.usd) || 0;
    const qty = Number(row.amount) || 0;
    const sign = direction === 'in' ? 1 : -1;

    if (direction === 'in') w.receivedUsd += usd; else w.sentUsd += usd;
    w.transfers += 1;
    w.chains.add(row.blockchain);
    w.symbols.set(row.symbol, (w.symbols.get(row.symbol) ?? 0) + sign * usd);
    if (qty > 0) w.units.set(row.symbol, (w.units.get(row.symbol) ?? 0) + sign * qty);
    w.firstAt = Math.min(w.firstAt, Number(row.at));
    w.lastAt = Math.max(w.lastAt, Number(row.at));
    w.largest = Math.max(w.largest, usd);
  };

  for (const r of rows ?? []) {
    if (Number(r.at) < cutoff) continue;
    if (!POSITIONAL.has(r.kind)) continue;
    if (symbol && r.symbol !== symbol) continue;
    // A value that is not a positive number is not a movement, whatever the
    // row says. Nothing valid reaches here that way, and one that did would
    // otherwise be added into a total.
    if (!(Number(r.usd) > 0)) continue;

    const to = r.to?.address ?? r.to_addr;
    const from = r.from?.address ?? r.from_addr;

    /**
     * A wallet paying itself moved nothing.
     *
     * Both ends are the same address, so it credits and debits the same wallet:
     * net zero, but **two transfers counted from one**. That count is not
     * cosmetic — it is the gate deciding whether a wallet has repeat activity,
     * the observation count under the performance score, and part of the
     * stealth test. Bitcoin does this constantly, since change comes back to an
     * address the sender controls, so a single self-send was enough to make a
     * wallet look like it had come back for more.
     */
    if (to && from && to === from) continue;

    touch(to, r.to?.owner ?? r.to_owner, r, 'in');
    touch(from, r.from?.owner ?? r.from_owner, r, 'out');
  }

  return [...wallets.values()].filter((w) => w.transfers >= minTransfers).map((w) => ({
    address: w.address,
    owner: w.owner,
    receivedUsd: w.receivedUsd,
    sentUsd: w.sentUsd,
    netUsd: w.receivedUsd - w.sentUsd,
    grossUsd: w.receivedUsd + w.sentUsd,
    transfers: w.transfers,
    chains: [...w.chains],
    symbols: [...w.symbols.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([sym, net]) => ({ symbol: sym, netUsd: net, netUnits: w.units.get(sym) ?? null })),
    firstAt: w.firstAt === Infinity ? null : w.firstAt,
    lastAt: w.lastAt || null,
    /** The biggest single piece — what tells a stealth build from one big move. */
    largestUsd: w.largest,
    /**
     * How one-sided the flow was, 0 to 1.
     *
     * A wallet that only received scores 1. A pass-through that received and
     * sent the same amount scores 0, which is the number that keeps routers —
     * most of a raw feed — off the top of the list without needing a blocklist.
     */
    conviction: w.receivedUsd + w.sentUsd > 0
      ? Math.abs(w.receivedUsd - w.sentUsd) / (w.receivedUsd + w.sentUsd)
      : 0,
  }));
}

/* ── performance ───────────────────────────────────────────────────────── */

/** Below this there is not enough observed history for a number to mean anything. */
export const MIN_OBSERVATIONS = 4;
export const MIN_SPAN_HOURS = 6;

/**
 * How the flows this app actually watched have done since.
 *
 * This is **not** lifetime profit and loss, and the difference matters enough
 * to be stated wherever the number is shown. It marks what a wallet accumulated
 * — at the dollar value recorded the moment it moved — against what those same
 * token quantities are worth now. That is a real, checkable measure of whether
 * a wallet has been buying before things went up, over the window this app has
 * been watching, and nothing more than that.
 *
 * What it cannot see: anything before the app started recording, anything on a
 * chain it does not read, and any position closed somewhere it cannot observe.
 *
 * Returns null rather than a number when the record is too thin. A score
 * invented from two transfers over an hour would be indistinguishable on screen
 * from one earned over a month, which is the failure this whole function exists
 * to avoid.
 */
export function performance(wallet, prices, { now = Date.now() } = {}) {
  const spanHours = wallet.firstAt && wallet.lastAt
    ? (wallet.lastAt - wallet.firstAt) / 3600 : 0;

  if (wallet.transfers < MIN_OBSERVATIONS) {
    return { score: null, reason: `only ${wallet.transfers} transfers observed`, spanHours };
  }
  if (spanHours < MIN_SPAN_HOURS) {
    return { score: null, reason: 'observed for under six hours', spanHours };
  }

  let thenUsd = 0;
  let nowUsd = 0;
  for (const s of wallet.symbols) {
    if (!(s.netUsd > 0) || !(s.netUnits > 0)) continue;
    const price = prices?.get(s.symbol);
    if (!price) continue;
    thenUsd += s.netUsd;
    nowUsd += s.netUnits * price;
  }
  if (!(thenUsd > 0)) {
    return { score: null, reason: 'no priced accumulation to mark', spanHours };
  }

  const markPct = ((nowUsd - thenUsd) / thenUsd) * 100;

  return {
    /**
     * The mark, tempered by how much of it was one-sided and how much was
     * observed. Every input is on the object beside it, so the number can be
     * argued with rather than trusted.
     */
    score: Math.round(markPct * wallet.conviction * 100) / 100,
    markPct: Math.round(markPct * 100) / 100,
    conviction: Math.round(wallet.conviction * 100) / 100,
    observations: wallet.transfers,
    spanHours: Math.round(spanHours * 10) / 10,
    accumulatedUsd: thenUsd,
    worthNowUsd: nowUsd,
    reason: null,
  };
}

/* ── consensus ─────────────────────────────────────────────────────────── */

/**
 * A wallet has to move this much before it counts as having a position.
 *
 * Half a million rather than a million, because the pieces got smaller: the
 * measured distribution puts almost everything under a million, so a
 * million-dollar participation floor was excluding most of the wallets the
 * consensus is supposed to be counting.
 */
export const PARTICIPANT_FLOOR_USD = 500_000;

/**
 * What the whales collectively did to one asset over one window.
 *
 * The classification is arithmetic rather than a label somebody chose. Two
 * things decide it: how one-sided the money was (net over gross), and how many
 * wallets were on the heavy side. Both are needed — a single wallet moving
 * $400M one way is a one-sided number and not a consensus, and twenty wallets
 * netting to nothing is a crowd with no opinion.
 */
export function consensus(wallets, { floor = PARTICIPANT_FLOOR_USD } = {}) {
  const active = (wallets ?? []).filter((w) => Math.abs(w.netUsd) >= floor);

  const accumulating = active.filter((w) => w.netUsd > 0);
  const distributing = active.filter((w) => w.netUsd < 0);
  const buyUsd = accumulating.reduce((s, w) => s + w.netUsd, 0);
  const sellUsd = distributing.reduce((s, w) => s + Math.abs(w.netUsd), 0);
  const netUsd = buyUsd - sellUsd;
  const grossUsd = buyUsd + sellUsd;
  const tilt = grossUsd > 0 ? netUsd / grossUsd : 0;

  /**
   * Holding, in the only sense the chain shows: took a position in this window
   * and has not sent it back out. It is not a claim about what they still own —
   * only about what they did here.
   */
  const holding = accumulating.filter((w) => w.sentUsd === 0).length;

  const participants = active.length;
  const heavySide = Math.max(accumulating.length, distributing.length);

  let trend = 'Neutral';
  if (participants >= 2 && Math.abs(tilt) >= 0.25) {
    const strong = Math.abs(tilt) >= 0.6 && heavySide >= 3;
    if (tilt > 0) trend = strong ? 'Strong Accumulation' : 'Accumulation';
    else trend = strong ? 'Strong Distribution' : 'Distribution';
  }

  return {
    trend,
    tilt: Math.round(tilt * 1000) / 1000,
    participants,
    accumulating: accumulating.length,
    distributing: distributing.length,
    holding,
    buyUsd,
    sellUsd,
    netUsd,
    grossUsd,
    transfers: active.reduce((s, w) => s + w.transfers, 0),
    /**
     * Stated so the label can never be read as more than it is. Two wallets is
     * not a consensus and the panel has to be able to say which it is looking at.
     */
    thin: participants < 3,
  };
}

/* ── stealth ───────────────────────────────────────────────────────────── */

/**
 * A large position assembled entirely out of pieces too small to notice.
 *
 * The whole reason for this file. The test is exact and has no judgement in it:
 * the net accumulation across participating wallets clears a meaningful total,
 * and **no single transfer in it reached the headline size**. If one did, it is
 * not stealth — it is a big move with some smaller ones around it.
 *
 * `displayFloor` stays at twenty million even though the transfer list now
 * starts at one, and that is deliberate. The claim being made is "this was
 * assembled without anything that would have turned a head", and twenty million
 * is the size that turns a head. Tying it to whatever the list happens to show
 * would weaken the alert every time that floor moved.
 */
export function stealth(wallets, {
  displayFloor = 20_000_000, minNetUsd = 10_000_000, minTransfers = 8,
  minTransfersPerWallet = 2,
} = {}) {
  /**
   * Each wallet has to have bought more than once.
   *
   * Without this the detector fired on the opposite behaviour: one address
   * paying out to ten others once each is ten wallets, ten transfers and a
   * large total, and reads as a crowd accumulating when it is one seller
   * dispersing. A build is repeated buying by the same address; a single
   * receipt is not a build however many addresses did it.
   */
  const quiet = (wallets ?? []).filter((w) => w.netUsd > 0
    && w.largestUsd < displayFloor
    && w.transfers >= minTransfersPerWallet);
  if (!quiet.length) return null;

  const netUsd = quiet.reduce((s, w) => s + w.netUsd, 0);
  const transfers = quiet.reduce((s, w) => s + w.transfers, 0);
  if (netUsd < minNetUsd || transfers < minTransfers) return null;

  const largest = quiet.reduce((m, w) => Math.max(m, w.largestUsd), 0);
  const symbols = new Map();
  for (const w of quiet) {
    for (const s of w.symbols) {
      if (s.netUsd > 0) symbols.set(s.symbol, (symbols.get(s.symbol) ?? 0) + s.netUsd);
    }
  }

  return {
    wallets: quiet.length,
    transfers,
    netUsd,
    largestUsd: largest,
    symbols: [...symbols.entries()].sort((a, b) => b[1] - a[1])
      .map(([symbol, usd]) => ({ symbol, usd })),
    firstAt: Math.min(...quiet.map((w) => w.firstAt ?? Infinity)),
    lastAt: Math.max(...quiet.map((w) => w.lastAt ?? 0)),
  };
}

/* ── the ranked table ──────────────────────────────────────────────────── */

/**
 * The smallest position worth a row.
 *
 * There used to be a separate ten-million floor on the whale as well as a floor
 * on the position, and the two could not both be right: a $1M–5M band asks for
 * positions between one and five million, and a ten-million qualifier emptied
 * that band by construction. The band is the filter. This is only the point
 * below which a holding is not a position at all.
 */
export const WHALE_FLOOR_USD = 1_000_000;

/**
 * One row per whale per coin, biggest first.
 *
 * The wallet list answered "who moved money", which put a wallet holding two
 * coins on one line and made the actual question — how big is this position, in
 * what — something you had to read out of a summary string. So the row is a
 * pair now: a whale and a coin.
 *
 * A whale qualifies once, on the total it moved across everything; its
 * positions then rank individually. Somebody with ten million in Bitcoin and
 * two million in Solana appears twice, ten places apart, which is the honest
 * shape: those are two positions of very different size that happen to share an
 * owner.
 *
 * Ranked on the absolute value, so a large sale sits beside a large purchase
 * rather than at the bottom of the table. The sign carries the direction and
 * the colour carries it again.
 *
 * The amount is **what moved in this window**, not what the wallet holds. The
 * chain will say what an address holds if asked, but that is one request per
 * address and this table is fifty rows; more importantly it is a different
 * claim, and the column says which one it is making.
 */
export function ranked(wallets, {
  min = WHALE_FLOOR_USD, max = Infinity, limit = 50,
} = {}) {
  const rows = [];

  for (const w of wallets ?? []) {
    for (const s of w.symbols ?? []) {
      // Each holding is judged on its own size, which is what the bands ask.
      const size = Math.abs(s.netUsd);
      if (!(size >= min) || size >= max) continue;
      rows.push({
        address: w.address,
        owner: w.owner,
        symbol: s.symbol,
        netUsd: s.netUsd,
        netUnits: s.netUnits,
        chains: w.chains,
        transfers: w.transfers,
        lastAt: w.lastAt,
        firstAt: w.firstAt,
        /** The wallet's whole position, so a row can say what else it holds. */
        walletNetUsd: w.netUsd,
        walletPositions: (w.symbols ?? []).length,
        /** The whole book for this wallet, so a row can open into it. */
        holdings: (w.symbols ?? []).map((x) => ({
          symbol: x.symbol, netUsd: x.netUsd, netUnits: x.netUnits,
        })),
      });
    }
  }

  return rows
    .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
