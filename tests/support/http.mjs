/**
 * Just enough of Node's req/res to call a Vercel handler directly, plus a
 * client that keeps cookies the way a browser would.
 *
 * Calling the handlers in-process rather than over a socket means the tests run
 * in milliseconds and a failure points at a line of application code instead of
 * a connection error.
 */
import { Readable } from 'node:stream';

function makeReq({ method, body, headers = {}, cookies = {} }) {
  const raw = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const stream = Readable.from(raw ? [raw] : []);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');

  return Object.assign(stream, {
    method,
    headers: {
      host: 'app.test',
      'content-type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...headers,
    },
    socket: { remoteAddress: headers['x-forwarded-for'] || '10.0.0.1' },
  });
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    bodyText: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(text) { this.bodyText = text ?? ''; this.done = true; },
  };
  return res;
}

/** A browser-ish client: remembers the session cookie between calls. */
export function makeClient(overrides = {}) {
  const jar = {};
  return {
    jar,
    async call(handler, { method = 'GET', body, headers = {} } = {}) {
      const req = makeReq({
        method, body, cookies: jar, headers: { ...overrides, ...headers },
      });
      const res = makeRes();
      await handler(req, res);

      const setCookie = res.getHeader('set-cookie');
      if (setCookie) {
        const [pair] = String(setCookie).split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq);
        const value = decodeURIComponent(pair.slice(eq + 1));
        if (/Max-Age=0/.test(String(setCookie)) || value === '') delete jar[name];
        else jar[name] = value;
      }

      let json = null;
      try { json = res.bodyText ? JSON.parse(res.bodyText) : null; } catch { /* not json */ }
      return { status: res.statusCode, body: json, headers: res.headers };
    },
  };
}
