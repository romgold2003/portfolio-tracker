/**
 * A zero-dependency static file server for local development.
 *
 * The app is plain ES modules, which browsers refuse to load over `file://`,
 * so it has to be served over HTTP. Rather than pull in a package for that,
 * this is Node's own http and fs modules — no install step, no lockfile,
 * nothing to keep up to date.
 *
 *   node scripts/dev-server.mjs [port]
 *
 * It also exposes one non-static endpoint, `/__recover`, which exists solely to
 * bridge a journal out of the old `file://` version and into this origin. See
 * docs/RECOVER-OLD-DATA.md. It is bound to loopback only and is a development
 * convenience, not part of the app.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const RECOVERY_FILE = join(ROOT, '.recovered', 'backup.json');

/** Refuse absurd payloads outright rather than buffering them. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * The recovery page runs from `file://`, whose Origin header is literally
 * "null", so it cannot be allow-listed by name. This is acceptable only
 * because the server is bound to loopback and the endpoint does nothing but
 * park a JSON file in the project directory.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleRecovery(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const positions = parsed?.data?.positions ?? parsed?.positions;
      if (!Array.isArray(positions)) throw new Error('No positions array in payload');

      await mkdir(dirname(RECOVERY_FILE), { recursive: true });
      await writeFile(RECOVERY_FILE, JSON.stringify(parsed, null, 2), 'utf8');

      console.log(`[recover] received ${positions.length} position(s) -> .recovered/backup.json`);
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, positions: positions.length }));
    } catch (err) {
      console.log(`[recover] rejected: ${err.message}`);
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'GET') {
    try {
      const saved = await readFile(RECOVERY_FILE, 'utf8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(saved);
    } catch {
      res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: false, error: 'nothing recovered yet' }));
    }
    return;
  }

  res.writeHead(405, CORS).end();
}

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

  if (urlPath === '/__recover') {
    await handleRecovery(req, res);
    return;
  }

  const relative = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^([/\\])+/, '');
  const filePath = join(ROOT, relative);

  // Refuse anything that escapes the project directory.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      // Always re-read from disk: an edit should show up on refresh.
      'Cache-Control': 'no-store',
    }).end(body);
  } catch (err) {
    const status = err.code === 'ENOENT' ? 404 : 500;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end(status === 404 ? 'Not found' : 'Server error');
  }
});

// Loopback only — never expose the project directory to the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Portfolio Tracker running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
