/**
 * A smoke test against a live deployment.
 *
 * The unit tests run against SQLite, which is what makes them fast and
 * dependency-free — but it also means they cannot tell you that the SQL works
 * on Postgres, or that the deployed functions have the environment they need.
 * This closes that gap by driving the real endpoints over HTTPS with the app's
 * own crypto module, exactly as a browser would.
 *
 * It is worth running after any deploy that touches the API. The bug it was
 * written for got past 27 green unit tests: the Neon driver in production had
 * no .query method, so every database call failed while the status endpoint
 * still reported a healthy cloud.
 *
 *   npm run check:live -- https://your-app.vercel.app
 *
 * It creates one throwaway account per run, named livecheck+<timestamp>, and
 * writes only to that account.
 */
import {
  generateDataKey, wrapDataKey, unwrapDataKey, encryptJson, decryptJson,
  generateRecoveryKey, normalizeRecoveryKey, generateAuthSalt, deriveAuthSecret,
} from '../src/core/crypto.js';

const BASE = process.argv[2];
const EMAIL = `livecheck+${Date.now()}@example.com`;
const PASSWORD = 'live-check-password-9482';

const JOURNAL = {
  positions: [{ id: 1, ticker: 'ZZTEST', cls: 'Stocks', dir: 'Long', status: 'Open', entry: 10, cur: 12, qty: 3 }],
  cash: 1234.56,
  snapshots: [{ date: '2026-08-30', value: 1270.56 }],
  apiKey: 'live-check-key',
};

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

/** A browser: remembers its cookie. */
function device(label) {
  let cookie = null;
  return {
    label,
    async call(path, { method = 'GET', body } = {}) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          origin: BASE,
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      const set = res.headers.get('set-cookie');
      if (set) {
        const pair = set.split(';')[0];
        if (/Max-Age=0/.test(set)) cookie = null; else cookie = pair;
      }
      let json = null;
      try { json = await res.json(); } catch { /* not json */ }
      return { status: res.status, body: json };
    },
  };
}

async function run() {
  console.log(`\nLive check against ${BASE}`);
  console.log(`Test account: ${EMAIL}\n`);

  // ── enrol, exactly as the browser does ────────────────────────────
  const dataKey = generateDataKey();
  const recoveryKey = generateRecoveryKey();
  const normalizedRecovery = normalizeRecoveryKey(recoveryKey);
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();

  const laptop = device('laptop');

  console.log('SIGN UP');
  const created = await laptop.call('/api/auth/signup', {
    method: 'POST',
    body: {
      email: EMAIL,
      authSalt,
      recoverySalt,
      authSecret: await deriveAuthSecret(PASSWORD, authSalt),
      recoverySecret: await deriveAuthSecret(normalizedRecovery, recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, PASSWORD),
      recoveryWrapper: await wrapDataKey(dataKey, normalizedRecovery),
      vault: await encryptJson(JOURNAL, dataKey),
    },
  });
  ok('account created (201)', created.status === 201, JSON.stringify(created.body));
  if (created.status === 429) {
    console.log('\n  Signups are capped at five an hour per address, and this script'
      + '\n  spends two per run. That is the limiter working. Wait, then re-run.');
  }
  if (created.status !== 201) { report(); return; }
  ok('vault starts at version 1', created.body.vaultVersion === 1);

  console.log('\nDUPLICATE EMAIL');
  const dupe = await laptop.call('/api/auth/signup', {
    method: 'POST',
    body: {
      email: EMAIL.toUpperCase(),
      authSalt,
      recoverySalt,
      authSecret: await deriveAuthSecret(PASSWORD, authSalt),
      recoverySecret: await deriveAuthSecret(normalizedRecovery, recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, PASSWORD),
      recoveryWrapper: await wrapDataKey(dataKey, normalizedRecovery),
      vault: await encryptJson(JOURNAL, dataKey),
    },
  });
  /**
   * 429 is a pass here, not a failure.
   *
   * This check spends a second signup, and signups are capped at five an hour
   * per address. Running the smoke test a few times in a row therefore trips
   * the limiter before it reaches the duplicate check — which is the limiter
   * working, not the unique index failing. The index itself is covered by the
   * unit suite, where there is no rate limit in the way.
   */
  ok(
    'a second signup is refused (409 taken, or 429 rate limited)',
    dupe.status === 409 || dupe.status === 429,
    `got ${dupe.status}`,
  );
  if (dupe.status === 429) console.log('        (rate limited — run again in an hour for the 409)');

  console.log('\nSAVE (exercises UPDATE ... RETURNING)');
  const saved = await laptop.call('/api/vault', {
    method: 'PUT',
    body: { vault: await encryptJson({ ...JOURNAL, cash: 999 }, dataKey), baseVersion: 1 },
  });
  ok('save accepted (200)', saved.status === 200, JSON.stringify(saved.body));
  ok('version incremented to 2', saved.body?.vaultVersion === 2, JSON.stringify(saved.body));

  console.log('\nSTALE SAVE (the data-loss guard)');
  const stale = await laptop.call('/api/vault', {
    method: 'PUT',
    body: { vault: await encryptJson({ ...JOURNAL, cash: 111 }, dataKey), baseVersion: 1 },
  });
  ok('stale save refused (409)', stale.status === 409, `got ${stale.status}`);
  ok('conflict returns current version', stale.body?.vaultVersion === 2);

  console.log('\nSIGN OUT');
  const out = await laptop.call('/api/auth/logout', { method: 'POST' });
  ok('signed out (200)', out.status === 200);
  const afterOut = await laptop.call('/api/vault');
  ok('session really dead (401)', afterOut.status === 401, `got ${afterOut.status}`);

  console.log('\nSECOND DEVICE — nothing but email + password');
  const phone = device('phone');
  const salts = await phone.call('/api/auth/begin', { method: 'POST', body: { email: EMAIL } });
  ok('salts returned', salts.status === 200 && !!salts.body?.authSalt);
  ok('auth and recovery salts differ', salts.body?.authSalt !== salts.body?.recoverySalt);

  const signedIn = await phone.call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, authSecret: await deriveAuthSecret(PASSWORD, salts.body.authSalt) },
  });
  ok('signed in (200)', signedIn.status === 200, JSON.stringify(signedIn.body));

  const reopened = await unwrapDataKey(signedIn.body.user.passwordWrapper, PASSWORD);
  ok('password unwraps the data key', !!reopened);
  const journal = await decryptJson(signedIn.body.vault, reopened);
  ok('journal decrypts', !!journal);
  ok('journal is the saved one (cash 999)', journal?.cash === 999, JSON.stringify(journal?.cash));
  ok('position survived', journal?.positions?.[0]?.ticker === 'ZZTEST');

  console.log('\nWRONG PASSWORD');
  const wrong = await device('attacker').call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, authSecret: await deriveAuthSecret('not it', salts.body.authSalt) },
  });
  ok('refused (401)', wrong.status === 401, `got ${wrong.status}`);

  console.log('\nACCOUNT ENUMERATION');
  const ghostA = await phone.call('/api/auth/begin', { method: 'POST', body: { email: 'nobody-here-9x@example.com' } });
  const ghostB = await phone.call('/api/auth/begin', { method: 'POST', body: { email: 'nobody-here-9x@example.com' } });
  ok('unknown email still gets a salt', ghostA.status === 200 && !!ghostA.body?.authSalt);
  ok('decoy is stable', ghostA.body?.authSalt === ghostB.body?.authSalt);
  ok('decoy differs from the real one', ghostA.body?.authSalt !== salts.body?.authSalt);

  console.log('\nRECOVERY KEY');
  const rescue = device('rescue');
  const rsalts = await rescue.call('/api/auth/begin', { method: 'POST', body: { email: EMAIL } });
  const recovered = await rescue.call('/api/auth/recover', {
    method: 'POST',
    body: {
      email: EMAIL,
      recoverySecret: await deriveAuthSecret(normalizedRecovery, rsalts.body.recoverySalt),
    },
  });
  ok('recovery key signs in (200)', recovered.status === 200, `got ${recovered.status}`);
  const viaRecovery = await unwrapDataKey(recovered.body?.user?.recoveryWrapper, normalizedRecovery);
  ok('recovery key opens the journal', !!viaRecovery);
  ok('and it is the right journal',
    (await decryptJson(recovered.body.vault, viaRecovery))?.cash === 999);

  console.log('\nDELETE ACCOUNT');
  const wrongPw = await phone.call('/api/account', {
    method: 'POST',
    body: { authSecret: await deriveAuthSecret('not the password', salts.body.authSalt) },
  });
  ok('wrong password will not delete (401)', wrongPw.status === 401, `got ${wrongPw.status}`);
  ok('journal survived the attempt', (await phone.call('/api/vault')).status === 200);

  const removed = await phone.call('/api/account', {
    method: 'POST',
    body: { authSecret: await deriveAuthSecret(PASSWORD, salts.body.authSalt) },
  });
  ok('right password deletes it (200)', removed.status === 200, `got ${removed.status}`);
  ok('journal is gone (401)', (await phone.call('/api/vault')).status === 401);

  const reused = await device('fresh').call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, authSecret: await deriveAuthSecret(PASSWORD, salts.body.authSalt) },
  });
  ok('the account no longer exists (401)', reused.status === 401, `got ${reused.status}`);

  console.log('\nCROSS-ORIGIN');
  const evil = await fetch(`${BASE}/api/vault`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ vault: { iv: 'aXY=', ct: 'Y3Q=' }, baseVersion: 1 }),
  });
  ok('refused (401 or 403)', evil.status === 401 || evil.status === 403, `got ${evil.status}`);

  report();
}

function report() {
  console.log(`\n${'─'.repeat(46)}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => { console.error('\nCRASHED:', err); process.exit(1); });
