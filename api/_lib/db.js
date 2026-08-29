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
];

/** Point the module at a driver. The test suite calls this with SQLite. */
export function useDriver(next) {
  driver = next;
  schemaReady = false;
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

/** True when a database is configured. The app runs local-only without one. */
export async function databaseAvailable() {
  return !!(await activeDriver());
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
