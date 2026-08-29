/**
 * The journal itself: fetch the ciphertext, or store a new version of it.
 *
 * The interesting part is the version number. Two devices signed into the same
 * account can both be holding version 4; if both saved blindly, whoever saved
 * second would erase the other's trades without either of them noticing. So a
 * save states the version it was editing, and a save against a stale version is
 * refused with the current one attached — the client then merges and retries
 * rather than overwriting.
 *
 * The server cannot merge, because it cannot read either side. Only the browser
 * that holds the data key can do that.
 */
import {
  send, fail, readCookies, readJson, sameOrigin,
} from './_lib/http.js';
import { userForToken, readVault, writeVault, isVaultBlob } from './_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  if (req.method === 'GET') {
    const vault = await readVault(user.id);
    return send(res, 200, {
      vault: vault ? { iv: vault.iv, ct: vault.ct } : null,
      vaultVersion: vault ? vault.version : 0,
      updatedAt: vault ? vault.updated_at : null,
    });
  }

  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return fail(res, 405, 'Method not allowed');
  }
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const body = await readJson(req).catch((err) => (err.status === 413 ? 'TOO_BIG' : null));
  if (body === 'TOO_BIG') return fail(res, 413, 'That journal is too large to store.');
  if (!isVaultBlob(body?.vault)) return fail(res, 400, 'Malformed vault.');

  const expected = Number(body?.baseVersion);
  if (!Number.isInteger(expected) || expected < 0) return fail(res, 400, 'Missing base version.');

  const result = await writeVault(user.id, body.vault, expected);
  if (!result.ok) {
    return send(res, 409, {
      error: 'This account was saved from somewhere else since you loaded it.',
      vault: result.vault ? { iv: result.vault.iv, ct: result.vault.ct } : null,
      vaultVersion: result.vault ? result.vault.version : 0,
    });
  }
  send(res, 200, { vaultVersion: result.vault.version, updatedAt: result.vault.updated_at });
}
