/**
 * Are the transfers on the tape real?
 *
 * Take hashes the app is showing and look them up on the chain itself. Not the
 * app's own reader — the public explorer, independently. If the transaction
 * does not exist, or moved a different amount, the tape is fiction.
 */
const SAMPLES = [
  { chain: 'ethereum', hash: '0xec64ff5734bae9eab3d84578a9ce62d1d3d8d8feae96414ffb9b56ee0794f9d9', symbol: 'WBTC', amount: 5517.51552856 },
  { chain: 'ethereum', hash: '0x38dba9eba225e42f8001ddf90281cbc14bbab82ea0ad92e84381f1934e84802c', symbol: 'WBTC', amount: 1003.16238589 },
  { chain: 'bitcoin', hash: 'f5c6c68c56d571cfd46afa0c9086534f007f61b20a5837c06a96568218c1ac05', symbol: 'BTC', amount: 678.71058458 },
  { chain: 'bitcoin', hash: 'b118a4fa231641d76d16ceb4361be82a6612989638f3ea79c8b987a08af38f7e', symbol: 'BTC', amount: 2436.89671717 },
];

const near = (a, b, tol = 0.02) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9) < tol;

for (const s of SAMPLES) {
  process.stdout.write(`${s.chain.padEnd(9)} ${s.hash.slice(0, 14)}…  `);
  try {
    if (s.chain === 'ethereum') {
      /* Blockscout, independent of the app's own call path. */
      const res = await fetch(
        `https://eth.blockscout.com/api/v2/transactions/${s.hash}/token-transfers`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (!res.ok) { console.log(`explorer said ${res.status}`); continue; }
      const body = await res.json();
      const items = body?.items ?? [];
      const match = items.find((t) => (t.token?.symbol ?? '') === s.symbol);
      if (!match) {
        console.log(`EXISTS but no ${s.symbol} leg (legs: ${items.map((t) => t.token?.symbol).join(',')})`);
        continue;
      }
      const units = Number(match.total?.value ?? 0) / 10 ** Number(match.total?.decimals ?? 8);
      console.log(`REAL · ${s.symbol} ${units} ${near(units, s.amount) ? '= app' : `≠ app (${s.amount})`}`
        + ` · ${match.from?.hash?.slice(0, 10)}… → ${match.to?.hash?.slice(0, 10)}…`);
    } else {
      /* mempool.space, the Bitcoin explorer the app links rows to. */
      const res = await fetch(`https://mempool.space/api/tx/${s.hash}`,
        { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { console.log(`explorer said ${res.status}`); continue; }
      const tx = await res.json();
      const out = (tx.vout ?? []).reduce((a, v) => a + (v.value ?? 0), 0) / 1e8;
      console.log(`REAL · ${tx.vout?.length} outputs totalling ${out.toFixed(4)} BTC`
        + ` ${near(out, s.amount, 0.05) ? '≈ app' : `vs app ${s.amount}`}`
        + ` · confirmed ${tx.status?.confirmed} block ${tx.status?.block_height}`);
    }
  } catch (err) {
    console.log(`could not check: ${err.message}`);
  }
}
