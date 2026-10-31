/**
 * Friends, what friends share, and group chats (October 2026).
 *
 * Asked for as the start of a social side to Riskbook: add a friend by the
 * email they signed up with, see the list, open a friend to see how their
 * money is spread — percentages only, no dollar amounts — and talk in groups.
 *
 * Three rules shape it.
 *
 * A request is kept against the email typed, not against an account. So
 * adding someone says the same thing whether or not they use Riskbook — this
 * cannot be used to find out who has an account — and a request to someone
 * who joins later is waiting for them when they do.
 *
 * A journal stays encrypted; the server still cannot read one. What a friend
 * sees is a separate summary the owner's own device works out and publishes,
 * only once they switch sharing on: each holding's share of the account.
 *
 * Only friends see it, only members read a chat, and every check is made here
 * on the server, never trusted from the browser.
 *
 * Tables are made on first use, as the whale store makes its own, so sign-in
 * does not pay for them.
 */
import { query, one, driverGeneration } from './db.js';
import { newId } from './crypto.js';
import { normalizeEmail, looksLikeEmail } from './accounts.js';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS friend_requests (
     id         TEXT PRIMARY KEY,
     from_user  TEXT NOT NULL,
     to_email   TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair ON friend_requests (from_user, to_email)`,
  `CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests (to_email)`,
  // One row per pair, the smaller id first, so a pair cannot be friends twice.
  `CREATE TABLE IF NOT EXISTS friendships (
     a     TEXT NOT NULL,
     b     TEXT NOT NULL,
     since TEXT NOT NULL,
     PRIMARY KEY (a, b)
   )`,
  `CREATE INDEX IF NOT EXISTS friendships_b ON friendships (b)`,
  `CREATE TABLE IF NOT EXISTS shares (
     user_id    TEXT PRIMARY KEY,
     summary    TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS chats (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS chat_members (
     chat_id   TEXT NOT NULL,
     user_id   TEXT NOT NULL,
     joined_at TEXT NOT NULL,
     PRIMARY KEY (chat_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS chat_members_user ON chat_members (user_id)`,
  `CREATE TABLE IF NOT EXISTS messages (
     id      TEXT PRIMARY KEY,
     chat_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     body    TEXT NOT NULL,
     at      TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id, at)`,
];

let readyFor = -1;
async function ensureTables() {
  if (readyFor === driverGeneration()) return;
  for (const statement of TABLES) await query(statement, []);
  readyFor = driverGeneration();
}

/** Limits, so one account cannot fill the database or anyone's inbox. */
export const LIMITS = {
  messageLength: 2000,
  chatName: 40,
  chatMembers: 20,
  holdings: 200,
  pageOfMessages: 100,
};

const now = () => new Date().toISOString();
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

/** A refusal the endpoint turns into a 4xx with this message. */
export class SocialError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ───────────────────────── friends ───────────────────────── */

export async function areFriends(x, y) {
  await ensureTables();
  const [a, b] = pair(x, y);
  return Boolean(await one('SELECT 1 AS ok FROM friendships WHERE a = $1 AND b = $2', [a, b]));
}

async function befriend(x, y) {
  const [a, b] = pair(x, y);
  if (await one('SELECT 1 AS ok FROM friendships WHERE a = $1 AND b = $2', [a, b])) return;
  await query('INSERT INTO friendships (a, b, since) VALUES ($1, $2, $3)', [a, b, now()]);
}

/**
 * Ask someone to be a friend, by email.
 *
 * Answers the same whether or not the address has an account. When the other
 * side has already asked this user, the two requests meet and they are friends
 * at once.
 */
export async function requestFriend(user, email) {
  await ensureTables();
  const address = normalizeEmail(email);
  if (!looksLikeEmail(address)) throw new SocialError(400, 'That is not an email address.');
  if (address === normalizeEmail(user.email)) throw new SocialError(400, 'That is your own email.');

  const them = await one('SELECT id, email FROM users WHERE email = $1', [address]);
  if (them && await areFriends(user.id, them.id)) return { status: 'friends' };

  // They asked first: accepting is what both of them want.
  const theirs = them && await one(
    'SELECT id FROM friend_requests WHERE from_user = $1 AND to_email = $2', [them.id, normalizeEmail(user.email)],
  );
  if (theirs) {
    await befriend(user.id, them.id);
    await query('DELETE FROM friend_requests WHERE id = $1', [theirs.id]);
    await query('DELETE FROM friend_requests WHERE from_user = $1 AND to_email = $2', [user.id, address]);
    return { status: 'friends' };
  }

  const existing = await one('SELECT id FROM friend_requests WHERE from_user = $1 AND to_email = $2', [user.id, address]);
  if (!existing) {
    await query('INSERT INTO friend_requests (id, from_user, to_email, created_at) VALUES ($1, $2, $3, $4)',
      [newId('fr'), user.id, address, now()]);
  }
  return { status: 'sent' };
}

/** Accept or decline a request made to this user. */
export async function answerRequest(user, requestId, accept) {
  await ensureTables();
  const request = await one('SELECT id, from_user, to_email FROM friend_requests WHERE id = $1', [String(requestId)]);
  if (!request || request.to_email !== normalizeEmail(user.email)) throw new SocialError(404, 'No such request.');
  if (accept) {
    const sender = await one('SELECT id FROM users WHERE id = $1', [request.from_user]);
    if (sender) await befriend(user.id, sender.id);
  }
  await query('DELETE FROM friend_requests WHERE id = $1', [request.id]);
  return { status: accept ? 'friends' : 'declined' };
}

/** Withdraw a request this user sent. */
export async function cancelRequest(user, requestId) {
  await ensureTables();
  await query('DELETE FROM friend_requests WHERE id = $1 AND from_user = $2', [String(requestId), user.id]);
  return { status: 'cancelled' };
}

/** End a friendship. Shared chats are kept: leaving one is its own choice. */
export async function removeFriend(user, friendId) {
  await ensureTables();
  const [a, b] = pair(user.id, String(friendId));
  await query('DELETE FROM friendships WHERE a = $1 AND b = $2', [a, b]);
  return { status: 'removed' };
}

/** Friends, requests to this user, and requests from them. */
export async function friendsOf(user) {
  await ensureTables();
  const { rows: links } = await query(
    `SELECT f.since, u.id, u.email, s.updated_at AS shared_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
       LEFT JOIN shares s ON s.user_id = u.id
      WHERE f.a = $1 OR f.b = $1`,
    [user.id],
  );
  const { rows: incoming } = await query(
    `SELECT r.id, u.email, r.created_at
       FROM friend_requests r JOIN users u ON u.id = r.from_user
      WHERE r.to_email = $1`,
    [normalizeEmail(user.email)],
  );
  const { rows: outgoing } = await query(
    'SELECT id, to_email AS email, created_at FROM friend_requests WHERE from_user = $1', [user.id],
  );
  const byEmail = (x, y) => x.email.localeCompare(y.email);
  return {
    friends: links.map((r) => ({ id: r.id, email: r.email, since: r.since, sharedAt: r.shared_at ?? null })).sort(byEmail),
    incoming: incoming.map((r) => ({ id: r.id, email: r.email, at: r.created_at })).sort(byEmail),
    outgoing: outgoing.map((r) => ({ id: r.id, email: r.email, at: r.created_at })).sort(byEmail),
  };
}

/* ───────────────────────── what a friend shares ───────────────────────── */

/**
 * The summary as stored: holdings as a share of the account, nothing in
 * dollars. Anything else the browser sends is dropped.
 */
export function cleanSummary(raw) {
  const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : null);
  const holdings = (Array.isArray(raw?.holdings) ? raw.holdings : []).slice(0, LIMITS.holdings).map((h) => {
    const t = typeof h?.t === 'string' ? h.t.trim().toUpperCase().slice(0, 16) : '';
    const w = num(h?.w, -1000, 1000);
    if (!t || w == null) return null;
    return {
      t,
      w: Math.round(w * 100) / 100,
      d: h?.d === 'Short' ? 'Short' : 'Long',
      c: typeof h?.c === 'string' ? h.c.slice(0, 16) : '',
    };
  }).filter(Boolean);
  const cash = num(raw?.cash, -1000, 1000);
  return { holdings, cash: cash == null ? 0 : Math.round(cash * 100) / 100 };
}

/** Publish this user's summary for their friends, or withdraw it. */
export async function setShare(user, summary) {
  await ensureTables();
  if (summary == null) {
    await query('DELETE FROM shares WHERE user_id = $1', [user.id]);
    return { shared: false };
  }
  const clean = JSON.stringify(cleanSummary(summary));
  const at = now();
  if (await one('SELECT 1 AS ok FROM shares WHERE user_id = $1', [user.id])) {
    await query('UPDATE shares SET summary = $1, updated_at = $2 WHERE user_id = $3', [clean, at, user.id]);
  } else {
    await query('INSERT INTO shares (user_id, summary, updated_at) VALUES ($1, $2, $3)', [user.id, clean, at]);
  }
  return { shared: true, at };
}

/** Whether this user shares, and what. */
export async function ownShare(user) {
  await ensureTables();
  const row = await one('SELECT summary, updated_at FROM shares WHERE user_id = $1', [user.id]);
  return row ? { shared: true, at: row.updated_at } : { shared: false };
}

/** A friend's summary — to friends only. */
export async function friendShare(user, friendId) {
  await ensureTables();
  const id = String(friendId);
  if (!await areFriends(user.id, id)) throw new SocialError(403, 'Only friends can see this.');
  const row = await one('SELECT summary, updated_at FROM shares WHERE user_id = $1', [id]);
  if (!row) return { shared: false };
  return { shared: true, at: row.updated_at, ...JSON.parse(row.summary) };
}

/* ───────────────────────── group chats ───────────────────────── */

async function memberOf(user, chatId) {
  const row = await one('SELECT 1 AS ok FROM chat_members WHERE chat_id = $1 AND user_id = $2', [String(chatId), user.id]);
  if (!row) throw new SocialError(404, 'No such chat.');
}

/** A group with a name and some of this user's friends. */
export async function createChat(user, name, memberIds) {
  await ensureTables();
  const title = String(name ?? '').trim().slice(0, LIMITS.chatName);
  if (!title) throw new SocialError(400, 'Give the group a name.');
  const others = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(String))].filter((id) => id !== user.id);
  if (!others.length) throw new SocialError(400, 'Choose at least one friend.');
  if (others.length + 1 > LIMITS.chatMembers) throw new SocialError(400, `A group holds ${LIMITS.chatMembers} at most.`);
  for (const id of others) {
    if (!await areFriends(user.id, id)) throw new SocialError(403, 'Only friends can be added to a group.');
  }
  const id = newId('ch');
  const at = now();
  await query('INSERT INTO chats (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)', [id, title, user.id, at]);
  for (const member of [user.id, ...others]) {
    await query('INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES ($1, $2, $3)', [id, member, at]);
  }
  return { id, name: title };
}

/** The chats this user is in, newest message first, with who is in them. */
export async function chatsOf(user) {
  await ensureTables();
  const { rows } = await query(
    `SELECT c.id, c.name, c.created_at,
            (SELECT MAX(m.at) FROM messages m WHERE m.chat_id = c.id) AS last_at
       FROM chats c JOIN chat_members cm ON cm.chat_id = c.id
      WHERE cm.user_id = $1`,
    [user.id],
  );
  const out = [];
  for (const r of rows) {
    const { rows: members } = await query(
      'SELECT u.id, u.email FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = $1', [r.id],
    );
    const last = r.last_at ? await one(
      `SELECT m.body, u.email FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.chat_id = $1 ORDER BY m.at DESC LIMIT 1`, [r.id],
    ) : null;
    out.push({
      id: r.id,
      name: r.name,
      members: members.map((m) => ({ id: m.id, email: m.email })).sort((x, y) => x.email.localeCompare(y.email)),
      lastAt: r.last_at ?? r.created_at,
      last: last ? { body: last.body.slice(0, 120), email: last.email ?? null } : null,
    });
  }
  return out.sort((x, y) => y.lastAt.localeCompare(x.lastAt));
}

/** Messages in a chat, oldest first: the latest page, or those after `after`. */
export async function messagesIn(user, chatId, after = null) {
  await ensureTables();
  await memberOf(user, chatId);
  const limit = LIMITS.pageOfMessages;
  const { rows } = after
    ? await query(
      `SELECT m.id, m.user_id, u.email, m.body, m.at FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.chat_id = $1 AND m.at > $2 ORDER BY m.at ASC LIMIT ${limit}`, [String(chatId), String(after)],
    )
    : await query(
      `SELECT m.id, m.user_id, u.email, m.body, m.at FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.chat_id = $1 ORDER BY m.at DESC LIMIT ${limit}`, [String(chatId)],
    );
  const list = rows.map((r) => ({ id: r.id, from: r.user_id, email: r.email ?? null, body: r.body, at: r.at, mine: r.user_id === user.id }));
  return after ? list : list.reverse();
}

export async function sendMessage(user, chatId, body) {
  await ensureTables();
  await memberOf(user, chatId);
  const text = String(body ?? '').trim();
  if (!text) throw new SocialError(400, 'The message is empty.');
  if (text.length > LIMITS.messageLength) throw new SocialError(400, `A message is ${LIMITS.messageLength} characters at most.`);
  const message = { id: newId('m'), at: now() };
  await query('INSERT INTO messages (id, chat_id, user_id, body, at) VALUES ($1, $2, $3, $4, $5)',
    [message.id, String(chatId), user.id, text, message.at]);
  return { ...message, from: user.id, email: user.email, body: text, mine: true };
}

/** Leave a chat. The last one out takes its messages with them. */
export async function leaveChat(user, chatId) {
  await ensureTables();
  await memberOf(user, chatId);
  await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [String(chatId), user.id]);
  const left = await one('SELECT 1 AS ok FROM chat_members WHERE chat_id = $1', [String(chatId)]);
  if (!left) {
    await query('DELETE FROM messages WHERE chat_id = $1', [String(chatId)]);
    await query('DELETE FROM chats WHERE id = $1', [String(chatId)]);
  }
  return { status: 'left' };
}

/** Everything social about an account, when the account is deleted. */
export async function forgetUser(userId, email) {
  await ensureTables();
  await query('DELETE FROM friend_requests WHERE from_user = $1 OR to_email = $2', [userId, normalizeEmail(email ?? '')]);
  await query('DELETE FROM friendships WHERE a = $1 OR b = $1', [userId]);
  await query('DELETE FROM shares WHERE user_id = $1', [userId]);
  await query('DELETE FROM messages WHERE user_id = $1', [userId]);
  const { rows } = await query('SELECT chat_id FROM chat_members WHERE user_id = $1', [userId]);
  for (const r of rows) await leaveChat({ id: userId }, r.chat_id).catch(() => {});
}
