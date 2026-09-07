/**
 * One answer, from several independent signals that have to agree.
 *
 * Everything else in this app produces a *view*. Six of them ended up on one
 * screen and none of them said what to conclude, so reading the panel meant
 * synthesising exchange flow, holder balances, whale positions and a transfer
 * tape yourself, every time. This does that synthesis and shows its working.
 *
 * The rule it is built on is the one every serious source repeats: **never act
 * on a single on-chain metric, look for convergence.** So the verdict is not a
 * weighted score dressed up as precision — it is a count. Four signals, each
 * reading bullish, bearish or silent on its own terms, and the answer is how
 * many agree. A signal that has no data says nothing rather than voting zero,
 * which would quietly drag every verdict toward neutral.
 *
 * The signals are deliberately measuring different things. Exchange flow is
 * about supply reaching the market; holder balances are about whether the
 * people who already own it are letting go; whale accumulation is about new
 * money arriving; stablecoin flow is about money getting ready to arrive. Four
 * correlated restatements of one number would look like agreement and be worth
 * nothing.
 */

/** Stablecoins move onto exchanges to buy, which is the opposite of a coin doing it. */
const STABLE = new Set(['USDT', 'USDC', 'DAI', 'USDE', 'USDS', 'PYUSD', 'USD1', 'RLUSD', 'USDG', 'FDUSD', 'TUSD']);

export const isStable = (symbol) => STABLE.has(String(symbol ?? '').toUpperCase());

/** Below this a signal is noise, whatever its sign. */
const MIN_USD = 250_000;
const MIN_HOLDER_PCT = 1;

/**
 * One signal's reading: +1 bullish, −1 bearish, 0 silent.
 *
 * Silent is a real answer and is counted as such — a signal with nothing to say
 * is not a vote for neutral, it is an abstention, and the verdict reports how
 * many signals were actually available so a two-signal agreement is never
 * mistaken for a four-signal one.
 */
function signal(id, label, value, { bullishWhen = 'negative', detail = null, min = MIN_USD } = {}) {
  const abstain = { id, label, vote: 0, value, detail, reads: 'no data' };
  if (!Number.isFinite(value) || Math.abs(value) < min) return abstain;

  const negativeIsBullish = bullishWhen === 'negative';
  const bullish = negativeIsBullish ? value < 0 : value > 0;
  return {
    id,
    label,
    vote: bullish ? 1 : -1,
    value,
    detail,
    reads: bullish ? 'bullish' : 'bearish',
  };
}

/**
 * Read one asset.
 *
 * @param {object} input
 * @param {object|null} input.flow      netflow row for this symbol
 * @param {object|null} input.stables   netflow across stablecoins, all symbols
 * @param {object[]}    input.holders   holder changes for this symbol
 * @param {object[]}    input.wallets   accumulation rows, already windowed
 */
export function verdictFor({ symbol, flow = null, stables = null, holders = [], wallets = [] } = {}) {
  const signals = [];

  /**
   * Exchange netflow. Negative is coins leaving, which is accumulation — the
   * sign inverts against intuition and is the easiest thing here to get
   * backwards, so it is spelled out at every step.
   */
  signals.push(signal('exchange', 'Exchange netflow', flow ? flow.netUsd : NaN, {
    bullishWhen: 'negative',
    detail: flow ? `${flow.netUsd < 0 ? 'leaving' : 'arriving'} · ${flow.transfers} transfers` : null,
  }));

  /**
   * Stablecoins are the mirror image: money arriving on an exchange is money
   * about to buy something. Treating them like any other asset would count
   * buying power as selling pressure.
   */
  signals.push(signal('stables', 'Stablecoins to exchanges', stables ? stables.netUsd : NaN, {
    bullishWhen: 'positive',
    detail: stables ? `${stables.netUsd > 0 ? 'dry powder arriving' : 'leaving'}` : null,
  }));

  /**
   * What the people who already hold it are doing. Summed across the top
   * holders, in dollars, so one treasury unloading outweighs a dozen small
   * wallets trimming.
   */
  const held = holders.reduce((s, h) => s + h.usdDelta, 0);
  const insiders = holders.filter((h) => h.insider);
  signals.push(signal('holders', 'Top holders', holders.length ? held : NaN, {
    bullishWhen: 'positive',
    detail: insiders.length
      ? `${insiders.length} insider${insiders.length === 1 ? '' : 's'} among them`
      : `${holders.length} holder${holders.length === 1 ? '' : 's'} moved`,
  }));

  /** New money: what the whales netted over the window. */
  const whaleNet = wallets.reduce((s, w) => s + w.netUsd, 0);
  signals.push(signal('whales', 'Whale accumulation', wallets.length ? whaleNet : NaN, {
    bullishWhen: 'positive',
    detail: wallets.length ? `${wallets.length} wallets` : null,
  }));

  const heard = signals.filter((s) => s.vote !== 0);
  const bullish = heard.filter((s) => s.vote > 0).length;
  const bearish = heard.length - bullish;
  const net = bullish - bearish;

  /**
   * The label. Two thirds of the available signals pointing one way is the line
   * for a strong call — and it is a line on *agreement*, not on size, because
   * one enormous number that nothing else corroborates is exactly the case this
   * whole file exists to refuse.
   */
  let trend = 'Neutral';
  if (heard.length >= 2) {
    const share = net / heard.length;
    /**
     * "Strong" needs three signals, not two agreeing out of two.
     *
     * Two signals both pointing one way is a share of 1.0 and looked like the
     * strongest possible reading, which is precisely backwards: it is the
     * thinnest evidence that can produce a call at all. Convergence is the
     * whole idea, so the strong label is reserved for a majority of a real
     * quorum rather than unanimity among a pair.
     */
    const quorum = heard.length >= 3;
    if (share >= 0.66) trend = quorum ? 'Strong accumulation' : 'Accumulation';
    else if (share > 0) trend = 'Accumulation';
    else if (share <= -0.66) trend = quorum ? 'Strong distribution' : 'Distribution';
    else if (share < 0) trend = 'Distribution';
  }

  return {
    symbol: symbol ?? null,
    trend,
    bullish,
    bearish,
    heard: heard.length,
    of: signals.length,
    signals,
    /**
     * A verdict from one signal is that signal with a grander name, and a
     * verdict from none is nothing at all. Both say so.
     */
    thin: heard.length < 2,
    insiderSelling: insiders.some((h) => h.usdDelta < 0),
  };
}
