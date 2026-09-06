/**
 * Create (or refill) the demo account.
 *
 *   node scripts/seed-demo.mjs --email demo@riskbook.app --password 12345678
 *   node scripts/seed-demo.mjs --base http://localhost:3000
 *
 * This does exactly what the sign-up screen does, in the same order, using the
 * same functions the browser uses — the point being that the demo account is a
 * real account and not a special case the app has to know about. The password
 * is stretched into an auth secret that travels, and separately into a key that
 * never leaves this process; the journal is encrypted here and the server only
 * ever sees ciphertext. Seeding it server-side would have been half the code
 * and would have required the server to be able to read journals.
 *
 * Re-running it on an address that already has an account refills that account's
 * vault rather than failing, so the demo can be reset after someone has clicked
 * around in it.
 *
 * The recovery key is printed once. Losing it and the password means the demo
 * is unrecoverable, same as any other account — there is no back door here.
 */
import {
  generateDataKey, wrapDataKey, unwrapDataKey, encryptJson,
  generateRecoveryKey, normalizeRecoveryKey, generateAuthSalt, deriveAuthSecret,
  toBase64,
} from '../src/core/crypto.js';
import { buildDemoJournal, DEMO_TICKERS, FALLBACK_PRICES } from './demo-journal.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const BASE = (args.get('base') ?? 'https://riskbook.vercel.app').replace(/\/$/, '');
const EMAIL = args.get('email') ?? 'demo@riskbook.app';
const PASSWORD = args.get('password') ?? '12345678';

/**
 * Yahoo's chart endpoint, which is what the app's own /api/quote reads and
 * needs no key. Crypto is asked for as a pair, the way that source names it.
 */
async function livePrice(ticker) {
  const symbol = ticker === 'BTC' ? 'BTC-USD'
    : ticker === 'ETH' ? 'ETH-USD'
      : ticker.replace(/\./g, '-');
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'riskbook-seed', Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const meta = (await res.json())?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function livePrices() {
  const prices = {};
  const missing = [];
  await Promise.all(DEMO_TICKERS.map(async (t) => {
    const price = await livePrice(t);
    if (price) prices[t] = price;
    else missing.push(t);
  }));
  // A quote that could not be fetched falls back rather than failing the seed:
  // one stale price in a demo book is a smaller problem than no demo book.
  if (missing.length) {
    console.warn(`  no live quote for ${missing.join(', ')} — using the stored fallback`);
    for (const t of missing) prices[t] = FALLBACK_PRICES[t];
  }
  return prices;
}

/** Keeps the session cookie across the two calls that need it. */
let cookie = null;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];

  let payload = null;
  try { payload = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(payload?.error || `${method} ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

async function main() {
  const config = await api('/config');
  if (!config?.cloud) {
    throw new Error(`${BASE} is not cloud-backed — there are no accounts to create there.`);
  }

  console.log(`seeding ${EMAIL} on ${BASE}`);
  console.log('  fetching live prices…');
  const prices = await livePrices();

  const journal = buildDemoJournal({ prices, today: new Date().toISOString().slice(0, 10) });
  const value = journal.positions
    .filter((p) => p.status === 'Open')
    .reduce((sum, p) => sum + p.cur * p.qty, 0) + journal.cash;
  console.log(`  built ${journal.positions.length} positions, account $${value.toFixed(2)}`);

  const recoveryKey = generateRecoveryKey();
  const normalizedRecovery = normalizeRecoveryKey(recoveryKey);
  const dataKey = generateDataKey();
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();

  console.log('  deriving keys (two PBKDF2 passes, a few seconds)…');
  try {
    await api('/auth/signup', {
      method: 'POST',
      body: {
        email: EMAIL,
        authSalt,
        recoverySalt,
        authSecret: await deriveAuthSecret(PASSWORD, authSalt),
        recoverySecret: await deriveAuthSecret(normalizedRecovery, recoverySalt),
        passwordWrapper: await wrapDataKey(dataKey, PASSWORD),
        recoveryWrapper: await wrapDataKey(dataKey, normalizedRecovery),
        vault: await encryptJson(journal, dataKey),
        ...(config.emailReset ? { escrowDataKey: toBase64(dataKey) } : {}),
      },
    });
    console.log('\ncreated.');
    console.log(`  email        ${EMAIL}`);
    console.log(`  password     ${PASSWORD}`);
    console.log(`  recovery key ${recoveryKey}`);
    console.log('\nWrite the recovery key down. It is not stored and cannot be reissued.');
    return;
  } catch (err) {
    if (err.status !== 409) throw err;
  }

  // The address is taken, which on a re-run is the expected case: sign in and
  // overwrite the vault with a fresh book instead of making a second account.
  console.log('  account exists — refilling its vault instead');
  const salts = await api('/auth/begin', { method: 'POST', body: { email: EMAIL } });
  const session = await api('/auth/login', {
    method: 'POST',
    body: { email: EMAIL, authSecret: await deriveAuthSecret(PASSWORD, salts.authSalt) },
  });

  const existingKey = await unwrapDataKey(session.user.passwordWrapper, PASSWORD);
  if (!existingKey) throw new Error('Signed in, but that password does not open the vault.');

  await api('/vault', {
    method: 'PUT',
    body: {
      vault: await encryptJson(journal, existingKey),
      baseVersion: session.vaultVersion,
    },
  });
  console.log('\nrefilled.');
  console.log(`  email     ${EMAIL}`);
  console.log(`  password  ${PASSWORD}`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exitCode = 1;
});
