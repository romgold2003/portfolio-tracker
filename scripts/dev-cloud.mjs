/**
 * The app plus its API, on one port, for developing the cloud mode.
 *
 * Vercel runs the files in api/ as separate functions and serves the static
 * files itself. This does both in one process so the whole thing can be driven
 * in a browser without deploying, and without a Postgres to install: the same
 * SQLite driver the tests use stands in for the database.
 *
 * The store is a file rather than memory so a restart does not throw away the
 * account you just made. Delete .dev-cloud.db to start clean.
 *
 *   node scripts/dev-cloud.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { useDriver } from '../api/_lib/db.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 4173;
const DB_FILE = join(ROOT, '.dev-cloud.db');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
};

/** The same driver shape the tests use, backed by a file on disk. */
function fileDriver() {
  const db = new DatabaseSync(DB_FILE);
  return {
    async query(text, params = []) {
      const sql = text.replace(/\$(\d+)/g, '?$1');
      const statement = db.prepare(sql);
      const bound = params.map((p) => (p === undefined ? null : p));
      if (/^\s*(SELECT|WITH)/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        return { rows: statement.all(...bound) };
      }
      const info = statement.run(...bound);
      return { rows: [], rowCount: Number(info.changes ?? 0) };
    },
  };
}

useDriver(fileDriver());

/**
 * Local stand-ins for the two things the reset flow needs from the outside
 * world, so the whole journey can be walked in a browser without a Brevo
 * account and without mailing anyone.
 *
 * The escrow secret is fixed rather than random: a restart that changed it
 * would leave every account in .dev-cloud.db unable to be reset, which is a
 * confusing way to spend an afternoon. It is a development value and is not
 * the one production uses.
 */
process.env.ESCROW_SECRET ??= 'dev-only-escrow-secret-not-for-production';
process.env.MAIL_FROM ??= 'dev@localhost';
process.env.MAIL_API_KEY ??= 'dev';

/**
 * The mail provider, replaced by the terminal. Anything aimed at Brevo is
 * intercepted and the link is printed where you are already looking.
 */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (!String(url).includes('api.brevo.com')) return realFetch(url, options);
  const message = JSON.parse(options.body);
  const link = /https?:\/\/\S+/.exec(message.textContent)?.[0] ?? '(no link found)';
  console.log(`\n  ✉  reset link for ${message.to[0].email}\n     ${link}\n`);
  return { ok: true, status: 201, text: async () => '' };
};

/** api/auth/login.js is reached as /api/auth/login. */
const ROUTES = {
  '/api/config': '../api/config.js',
  '/api/vault': '../api/vault.js',
  '/api/account': '../api/account.js',
  '/api/history': '../api/history.js',
  '/api/quote': '../api/quote.js',
  '/api/fed': '../api/fed.js',
  '/api/econ': '../api/econ.js',
  '/api/weekstart': '../api/weekstart.js',
  '/api/sentiment': '../api/sentiment.js',
  '/api/auth/begin': '../api/_auth/begin.js',
  '/api/auth/signup': '../api/_auth/signup.js',
  '/api/auth/login': '../api/_auth/login.js',
  '/api/auth/logout': '../api/_auth/logout.js',
  '/api/auth/session': '../api/_auth/session.js',
  '/api/auth/recover': '../api/_auth/recover.js',
  '/api/auth/password': '../api/_auth/password.js',
  '/api/auth/forgot': '../api/_auth/forgot.js',
  '/api/auth/reset': '../api/_auth/reset.js',
  '/api/auth/escrow': '../api/_auth/escrow.js',
};

const handlers = new Map();
async function handlerFor(pathname) {
  const spec = ROUTES[pathname];
  if (!spec) return null;
  if (!handlers.has(pathname)) {
    handlers.set(pathname, (await import(new URL(spec, import.meta.url))).default);
  }
  return handlers.get(pathname);
}

async function serveStatic(res, urlPath) {
  // Anything that resolves outside the project is a traversal attempt.
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const file = join(ROOT, relative === '' ? 'index.html' : relative);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  const handler = await handlerFor(pathname);
  if (handler) {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`${pathname} failed:`, err);
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
      }
    }
    return;
  }
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"No such endpoint"}');
    return;
  }
  await serveStatic(res, pathname);
}).listen(PORT, () => {
  console.log(`Portfolio Tracker (cloud mode) on http://localhost:${PORT}`);
  console.log(`  accounts and journals -> ${DB_FILE}`);
});
