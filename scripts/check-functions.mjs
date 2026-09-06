/**
 * Refuse to build if the deployment would exceed its serverless function limit.
 *
 * This exists because of how that limit fails. Vercel's Hobby plan allows
 * twelve functions and enforces it by **not deploying** — no failed build, no
 * error, no email. Production goes on serving the last good build while every
 * push reports success, and the first sign of trouble is somebody saying the
 * update is not showing. That happened here: four commits, including an entire
 * feature, sat undeployed while the site looked healthy.
 *
 * The mistake underneath it was counting with `ls api/*.js`, which returns
 * twelve and misses `api/auth/[action].js`. A file in a subdirectory is still a
 * function. So this counts the way the platform does — every .js under api/
 * that is not in an underscore-prefixed directory — and fails the build loudly
 * while there is still someone at the keyboard to read it.
 *
 * Running it from `build:site` means it fires locally *and* on Vercel, so a
 * silent non-deploy becomes a build failure with a message either way.
 */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = resolve(fileURLToPath(new URL('../api', import.meta.url)));

/** The plan's cap. Hobby is twelve; Pro is far higher and this stops mattering. */
const LIMIT = 12;

/**
 * Underscore says "module, not endpoint" — the same convention Vercel itself
 * uses, and why api/_lib and api/_panels are free.
 */
async function functions(dir, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await functions(join(dir, entry.name), path));
    else if (entry.name.endsWith('.js')) found.push(`api/${path}`);
  }
  return found;
}

const found = (await functions(API)).sort();

if (found.length > LIMIT) {
  console.error(`\n  ${found.length} serverless functions, and the limit is ${LIMIT}.\n`);
  for (const f of found) console.error(`    ${f}`);
  console.error(`
  Vercel does not fail this build on its own — it stops deploying and says
  nothing, so the site keeps serving the last good version while every push
  looks like it worked.

  Fold an endpoint into an existing function rather than adding a file. The
  pattern is already here twice: api/auth/[action].js serves ten auth endpoints
  and api/news/[panel].js serves seven News panels, both routing on the last
  path segment, with vercel.json rewrites keeping the original URLs. Rewrites
  are routing rules, not functions, and cost nothing against this limit.
`);
  process.exit(1);
}

console.log(`  ${found.length} of ${LIMIT} serverless functions`);
