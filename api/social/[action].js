/**
 * The Friends page's endpoints, behind one serverless function
 * (api/_lib/social.js holds the rules; this only reads requests and answers).
 *
 *   GET  /api/social/friends                friends, requests in and out, own sharing
 *   POST /api/social/request    {email}     ask someone to be a friend
 *   POST /api/social/answer     {id, accept}
 *   POST /api/social/cancel     {id}        withdraw a request sent
 *   POST /api/social/remove     {friendId}
 *   POST /api/social/share      {summary} | {summary: null}
 *   GET  /api/social/portfolio?friend=ID    a friend's holdings, as they chose to show them
 *   GET  /api/social/chats
 *   POST /api/social/chat       {name, members}
 *   GET  /api/social/messages?chat=ID[&after=ISO]
 *   POST /api/social/send       {chat, body}
 *   POST /api/social/leave      {chat}
 *   POST /api/social/direct     {friendId}  the chat with one friend
 *   POST /api/social/members    {chat, add, remove}  a group's maker only
 *
 * One function for all of them, as with auth and the News panels: a Hobby
 * deployment allows twelve, and this is the eighth.
 */
import {
  send, fail, readJson, readCookies, sameOrigin, rateLimit,
} from '../_lib/http.js';
import { userForToken } from '../_lib/accounts.js';
import * as social from '../_lib/social.js';

const SESSION_COOKIE = 'pt_session';

/** Reads: no body. */
const GETS = {
  friends: async (user) => ({ ...await social.friendsOf(user), share: await social.ownShare(user) }),
  portfolio: (user, url) => social.friendShare(user, url.searchParams.get('friend') ?? ''),
  chats: async (user) => ({ chats: await social.chatsOf(user) }),
  messages: async (user, url) => ({
    messages: await social.messagesIn(user, url.searchParams.get('chat') ?? '', url.searchParams.get('after') || null),
  }),
};

/** Writes, each with how often one account may make it: [count, minutes]. */
const POSTS = {
  request: { limit: [30, 60], run: (user, b) => social.requestFriend(user, b.email) },
  answer: { limit: [60, 60], run: (user, b) => social.answerRequest(user, b.id, b.accept === true) },
  cancel: { limit: [60, 60], run: (user, b) => social.cancelRequest(user, b.id) },
  remove: { limit: [60, 60], run: (user, b) => social.removeFriend(user, b.friendId) },
  share: { limit: [120, 60], run: (user, b) => social.setShare(user, b.summary ?? null) },
  chat: { limit: [20, 60], run: (user, b) => social.createChat(user, b.name, b.members) },
  send: { limit: [60, 1], run: (user, b) => social.sendMessage(user, b.chat, b.body) },
  leave: { limit: [60, 60], run: (user, b) => social.leaveChat(user, b.chat) },
  direct: { limit: [120, 60], run: (user, b) => social.directChat(user, b.friendId) },
  members: { limit: [60, 60], run: (user, b) => social.setMembers(user, b.chat, b.add, b.remove) },
};

function actionFrom(url) {
  const path = String(url || '').split('?')[0].replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1);
}

export default async function handler(req, res) {
  const action = actionFrom(req.url);
  const get = GETS[action];
  const post = POSTS[action];
  if (!get && !post) return fail(res, 404, 'No such endpoint.');
  if ((get && req.method !== 'GET') || (post && req.method !== 'POST')) {
    res.setHeader('Allow', get ? 'GET' : 'POST');
    return fail(res, 405, 'Method not allowed.');
  }
  if (post && !sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  try {
    if (get) return send(res, 200, await get(user, new URL(req.url, 'http://local')));
    const [count, minutes] = post.limit;
    if (!await rateLimit(`social:${action}:${user.id}`, count, minutes)) {
      return fail(res, 429, 'Too many in a short time. Wait a little and try again.');
    }
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== 'object') return fail(res, 400, 'Expected a JSON body.');
    return send(res, 200, await post.run(user, body));
  } catch (err) {
    if (err instanceof social.SocialError) return fail(res, err.status, err.message);
    console.error('social', action, err);
    return fail(res, 500, 'Something went wrong. Try again.');
  }
}
