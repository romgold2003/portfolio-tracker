/**
 * The bits every endpoint needs: reading a request safely, answering in JSON,
 * cookies, origin checks and rate limiting.
 */
import { query, one } from './db.js';
import { newId } from './crypto.js';

/** Nothing this API accepts is anywhere near this big. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // An API response is never a cacheable artifact; one cached vault served to
  // the wrong person would be the worst bug this project could have.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export function fail(res, status, message) {
  send(res, status, { error: message });
}

/**
 * Read and parse a JSON body.
 *
 * Vercel usually parses it already, but not for every content type, and the
 * test harness calls handlers directly — so the raw stream is read when the
 * parsed body is absent. The size cap is enforced while reading rather than
 * after, so an oversized body is dropped instead of buffered.
 */
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export function methodIs(req, res, allowed) {
  if (req.method === allowed) return true;
  res.setHeader('Allow', allowed);
  fail(res, 405, 'Method not allowed');
  return false;
}

export function readCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, maxAgeSeconds) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // The session cookie must be unreadable to script and unusable from another
    // site. Strict is affordable here because the page is static HTML that
    // fetches its data afterwards, so a cold arrival from an external link
    // still works.
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Secure would make the cookie vanish over plain http, which is exactly how
  // the test harness and `npm start` run.
  if (process.env.NODE_ENV !== 'test' && process.env.VERCEL) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

export function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

/**
 * Refuse a state-changing request that came from another site.
 *
 * SameSite=Strict already stops the browser sending the session cookie
 * cross-site, so this is the second lock rather than the first. It is cheap,
 * and it also covers clients that ignore SameSite.
 */
export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true; // not a browser fetch; no ambient cookie to abuse
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Allow at most `limit` attempts per bucket in `windowMinutes`.
 *
 * Without this the login endpoint would let someone try passwords as fast as
 * they can open sockets. Old rows are deleted on the way past, which keeps the
 * table small without needing anything scheduled.
 */
export async function rateLimit(bucket, limit, windowMinutes) {
  const now = Date.now();
  const cutoff = new Date(now - windowMinutes * 60_000).toISOString();
  await query('DELETE FROM attempts WHERE at < $1', [cutoff]);

  const row = await one(
    'SELECT COUNT(*) AS n FROM attempts WHERE bucket = $1 AND at >= $2',
    [bucket, cutoff],
  );
  const used = Number(row?.n ?? 0);
  if (used >= limit) return false;

  await query('INSERT INTO attempts (id, bucket, at) VALUES ($1, $2, $3)', [
    newId('a'), bucket, new Date(now).toISOString(),
  ]);
  return true;
}

/** Clear a bucket after a success, so one good login forgives earlier typos. */
export async function clearRateLimit(bucket) {
  await query('DELETE FROM attempts WHERE bucket = $1', [bucket]);
}

export function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
