/**
 * The database, behind one tiny interface.
 *
 * Two drivers implement it. Postgres is what runs in production, over Neon's
 * HTTP driver because a serverless function cannot hold a connection pool open
 * between invocations. SQLite is what the test suite runs against, so the whole
 * API can be exercised on a laptop with no database to install and no cloud
 * account to create.
 *
 * That only works if the SQL is portable, so the schema below sticks to TEXT
 * and INTEGER, and every query is written with $1-style placeholders that the
 * SQLite driver rewrites. Nothing here uses a Postgres-only feature; if that
 * ever changes, the tests stop being evidence about production and the change
 * is not worth it.
 */

/** @type {{query(text: string, params: unknown[]): Promise<{rows: any[]}>}|null} */
let driver = null;
let schemaReady = false;
/**
 * Bumped whenever the database is swapped. Anything caching a value that came
 * out of the database checks this, so pointing at a different database cannot
 * leave a stale value behind from the previous one.
 */
let generation = 0;
/** Set once a real query has succeeded. See databaseAvailable(). */
let healthy = false;

export function driverGeneration() {
  return generation;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id          TEXT PRIMARY KEY,
     email       TEXT NOT NULL UNIQUE,
     auth_salt   TEXT NOT NULL,
     auth_hash   TEXT NOT NULL,
     rec_salt    TEXT NOT NULL,
     rec_hash    TEXT NOT NULL,
     pw_wrapper  TEXT NOT NULL,
     rec_wrapper TEXT NOT NULL,
     created_at  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS vaults (
     user_id    TEXT PRIMARY KEY,
     iv         TEXT NOT NULL,
     ct         TEXT NOT NULL,
     version    INTEGER NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
  /**
   * Every login and signup attempt, kept only long enough to rate limit on.
   * Without this, the login endpoint is an offline password-guessing oracle
   * that answers as fast as the network allows.
   */
  `CREATE TABLE IF NOT EXISTS attempts (
     id      TEXT PRIMARY KEY,
     bucket  TEXT NOT NULL,
     at      TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS attempts_bucket ON attempts (bucket, at)`,
  /** Deployment-wide values that have to be stable but must not be guessable. */
  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  /**
   * The data key, held so that a forgotten password can be recovered by email.
   *
   * This is the row that makes password reset possible and it is the row that
   * makes the promise weaker, so it should be read with both facts in mind. It
   * is encrypted under ESCROW_SECRET, which lives in the deployment's
   * environment and never in here — so a copy of this database is still not
   * enough to read anyone's journal. Someone holding both is.
   *
   * Absent ESCROW_SECRET, nothing is ever written here and the app falls back
   * to recovery keys.
   */
  `CREATE TABLE IF NOT EXISTS escrow (
     user_id    TEXT PRIMARY KEY,
     iv         TEXT NOT NULL,
     ct         TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  /** Outstanding password-reset links. Short-lived and single-use. */
  `CREATE TABLE IF NOT EXISTS resets (
     token_hash TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     used_at    TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS resets_user ON resets (user_id)`,
  /**
   * The last figure seen for each watched economic release.
   *
   * The calendar feed covers one week and has no history endpoint, so a monthly
   * release is absent from it three weeks in four. Kept here, the panel shows
   * every indicator all the time instead of emptying out between prints.
   *
   * Public data, not anyone's: one row per release, shared by every account.
   */
  `CREATE TABLE IF NOT EXISTS econ (
     id         TEXT PRIMARY KEY,
     label      TEXT NOT NULL,
     release_at TEXT,
     impact     TEXT,
     forecast   TEXT,
     previous   TEXT,
     updated_at TEXT NOT NULL
   )`,
];

/** Point the module at a driver. The test suite calls this with SQLite. */
export function useDriver(next) {
  driver = next;
  schemaReady = false;
  healthy = false;
  generation += 1;
}

/**
 * Neon's HTTP driver, created on first use.
 *
 * Vercel injects the connection string when a Postgres store is attached to the
 * project. Several names have been used for it over the years, so all the ones
 * Vercel has set are accepted rather than making the deploy depend on which
 * vintage of the integration created the store.
 */
async function postgresDriver() {
  const url = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.DATABASE_POSTGRES_URL;
  if (!url) return null;

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);

  /**
   * `neon()` returns a tagged-template function. The `.query(text, params)`
   * method for plain parameterised SQL only exists from v1 — in 0.10 it was
   * absent, and calling it threw on every request that touched the database
   * while the health check, which never ran a query, went on reporting that
   * all was well. Checked here so a wrong version fails immediately and says
   * why, instead of surfacing as a 500 on sign-in.
   */
  if (typeof sql.query !== 'function') {
    throw new Error(
      'The installed @neondatabase/serverless has no sql.query(); v1 or later is required.',
    );
  }

  return {
    async query(text, params) {
      const rows = await sql.query(text, params);
      return { rows };
    },
  };
}

async function activeDriver() {
  if (!driver) driver = await postgresDriver();
  return driver;
}

/**
 * True when a database is configured *and answering*.
 *
 * This deliberately runs a real query rather than checking that a connection
 * string exists. A version of this that only looked for the environment
 * variable once reported a healthy cloud on a deployment where every actual
 * query threw, so the app offered people accounts it could not create. A
 * health check that cannot fail is not a health check.
 *
 * Cached once it succeeds, because it runs on every page load.
 */
export async function databaseAvailable() {
  if (healthy) return true;
  try {
    const active = await activeDriver();
    if (!active) return false;
    await ensureSchema(active);
    await active.query('SELECT 1', []);
    healthy = true;
    return true;
  } catch (err) {
    console.error('Database is configured but not usable:', err);
    return false;
  }
}

async function ensureSchema(active) {
  if (schemaReady) return;
  for (const statement of SCHEMA) await active.query(statement, []);
  schemaReady = true;
}

/**
 * Run one statement.
 *
 * Parameters are always bound, never interpolated — every value reaching this
 * function came off the wire from an untrusted client.
 */
export async function query(text, params = []) {
  const active = await activeDriver();
  if (!active) throw new Error('No database is configured for this deployment.');
  await ensureSchema(active);
  return active.query(text, params);
}

export async function one(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}
