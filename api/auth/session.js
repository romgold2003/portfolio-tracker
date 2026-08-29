/**
 * Who is signed in on this browser, and what does their vault look like now?
 *
 * Called at boot so a returning visitor lands in their journal rather than at
 * the sign-in screen. The vault comes back encrypted, as always — the data key
 * is not in this session, it is derived from the password, so the app still
 * asks for it before it can show anything.
 */
import { send, methodIs, readCookies } from '../_lib/http.js';
import { userForToken, publicUser, readVault } from '../_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const token = readCookies(req)[SESSION_COOKIE];
  const user = await userForToken(token);
  if (!user) return send(res, 200, { user: null });

  const vault = await readVault(user.id);
  send(res, 200, {
    user: publicUser(user),
    vault: vault ? { iv: vault.iv, ct: vault.ct } : null,
    vaultVersion: vault ? vault.version : 0,
  });
}
