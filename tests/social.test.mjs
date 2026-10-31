/**
 * Friends, what they share, and group chats — the server end to end, against
 * SQLite in memory (October 2026).
 *
 * What has to hold: a friend is added by the email they signed up with, and
 * asking never reveals whether an address has an account; a friend sees the
 * other's holdings as percentages and nothing in dollars, and nobody else sees
 * them at all; only members read or write a chat.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';
import signup from '../api/_auth/signup.js';
import deleteAccount from '../api/account.js';
import social from '../api/social/[action].js';
import {
  generateDataKey, wrapDataKey, encryptJson, generateRecoveryKey, normalizeRecoveryKey,
  generateAuthSalt, deriveAuthSecret,
} from '../src/core/crypto.js';

process.env.NODE_ENV = 'test';

let ip = 1;
/** A signed-in person, by email. */
async function person(email, password = 'correct horse battery') {
  const client = makeClient({ 'x-forwarded-for': `10.0.0.${ip++}` });
  const dataKey = generateDataKey();
  const recoveryKey = generateRecoveryKey();
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();
  const res = await client.call(signup, {
    method: 'POST',
    body: {
      email,
      authSalt,
      recoverySalt,
      authSecret: await deriveAuthSecret(password, authSalt),
      recoverySecret: await deriveAuthSecret(normalizeRecoveryKey(recoveryKey), recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, password),
      recoveryWrapper: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
      vault: await encryptJson({ positions: [], cash: 0 }, dataKey),
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const call = (action, body, query = '') => client.call(social, {
    method: body === undefined ? 'GET' : 'POST', body, url: `/api/social/${action}${query}`,
  });
  return { email, id: res.body.user.id, client, call, authSalt, password };
}

beforeEach(() => { useDriver(sqliteDriver()); });

describe('adding a friend by email', () => {
  test('asked, seen by them, accepted: friends on both sides', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');

    const sent = await romy.call('request', { email: '  Dan@Example.com ' });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.status, 'sent');

    const mine = (await romy.call('friends')).body;
    assert.deepEqual(mine.outgoing.map((r) => r.email), ['dan@example.com']);
    const theirs = (await dan.call('friends')).body;
    assert.deepEqual(theirs.incoming.map((r) => r.email), ['romy@example.com']);

    const answered = await dan.call('answer', { id: theirs.incoming[0].id, accept: true });
    assert.equal(answered.body.status, 'friends');
    assert.deepEqual((await romy.call('friends')).body.friends.map((f) => f.email), ['dan@example.com']);
    assert.deepEqual((await dan.call('friends')).body.friends.map((f) => f.email), ['romy@example.com']);
    assert.equal((await romy.call('friends')).body.outgoing.length, 0);
  });

  test('asking an address with no account says the same, and waits for them to join', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    const toMember = await romy.call('request', { email: 'dan@example.com' });
    const toStranger = await romy.call('request', { email: 'noone@example.com' });
    assert.deepEqual([toStranger.status, toStranger.body], [toMember.status, toMember.body], 'it must not reveal who has an account');

    const later = await person('noone@example.com');
    assert.deepEqual((await later.call('friends')).body.incoming.map((r) => r.email), ['romy@example.com']);
    assert.ok(dan);
  });

  test('two people asking each other are friends at once', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    await romy.call('request', { email: 'dan@example.com' });
    const back = await dan.call('request', { email: 'romy@example.com' });
    assert.equal(back.body.status, 'friends');
    assert.equal((await romy.call('friends')).body.friends.length, 1);
  });

  test('declined, cancelled, removed; and not one\'s own address', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    assert.equal((await romy.call('request', { email: 'romy@example.com' })).status, 400);
    assert.equal((await romy.call('request', { email: 'not an email' })).status, 400);

    await romy.call('request', { email: 'dan@example.com' });
    const [req] = (await dan.call('friends')).body.incoming;
    await dan.call('answer', { id: req.id, accept: false });
    assert.equal((await romy.call('friends')).body.friends.length, 0);

    await romy.call('request', { email: 'dan@example.com' });
    const [out] = (await romy.call('friends')).body.outgoing;
    await romy.call('cancel', { id: out.id });
    assert.equal((await dan.call('friends')).body.incoming.length, 0);

    await romy.call('request', { email: 'dan@example.com' });
    await dan.call('answer', { id: (await dan.call('friends')).body.incoming[0].id, accept: true });
    await romy.call('remove', { friendId: dan.id });
    assert.equal((await dan.call('friends')).body.friends.length, 0);
  });

  test('a request meant for someone else cannot be accepted', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    const eve = await person('eve@example.com');
    await romy.call('request', { email: 'dan@example.com' });
    const [req] = (await dan.call('friends')).body.incoming;
    assert.equal((await eve.call('answer', { id: req.id, accept: true })).status, 404);
  });
});

async function friends(a, b) {
  await a.call('request', { email: b.email });
  const [req] = (await b.call('friends')).body.incoming;
  await b.call('answer', { id: req.id, accept: true });
}

describe('what a friend sees', () => {
  test('percentages only: anything in dollars the browser sends is dropped', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    await friends(romy, dan);

    await romy.call('share', {
      summary: {
        holdings: [{ t: 'nvda', w: 41.234, d: 'Long', c: 'Stocks', value: 18000, qty: 10 }, { t: 'USO', w: -2.8, d: 'Short' }],
        cash: 2.9,
        account: 45999.62,
      },
    });
    const seen = await dan.call('portfolio', undefined, `?friend=${romy.id}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.shared, true);
    assert.deepEqual(seen.body.holdings, [{ t: 'NVDA', w: 41.23, d: 'Long', c: 'Stocks' }, { t: 'USO', w: -2.8, d: 'Short', c: '' }]);
    assert.equal(seen.body.cash, 2.9);
    assert.equal(seen.body.account, undefined);
    assert.doesNotMatch(JSON.stringify(seen.body), /18000|45999|qty|value/);
    assert.equal((await dan.call('friends')).body.friends[0].sharedAt != null, true);
  });

  test('nobody but a friend sees it, and withdrawing it takes it away', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    const eve = await person('eve@example.com');
    await friends(romy, dan);
    await romy.call('share', { summary: { holdings: [{ t: 'NVDA', w: 50 }], cash: 50 } });
    assert.equal((await eve.call('portfolio', undefined, `?friend=${romy.id}`)).status, 403);

    await romy.call('share', { summary: null });
    assert.equal((await dan.call('portfolio', undefined, `?friend=${romy.id}`)).body.shared, false);
  });
});

describe('group chats', () => {
  test('made with friends, read and written by members only', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    const eve = await person('eve@example.com');
    await friends(romy, dan);

    assert.equal((await romy.call('chat', { name: 'Tech', members: [eve.id] })).status, 403, 'only friends can be added');
    assert.equal((await romy.call('chat', { name: '', members: [dan.id] })).status, 400);

    const made = await romy.call('chat', { name: 'Tech longs', members: [dan.id] });
    assert.equal(made.status, 200);
    const chat = made.body.id;

    const listed = (await dan.call('chats')).body.chats;
    assert.deepEqual(listed.map((c) => [c.name, c.members.map((m) => m.email)]), [['Tech longs', ['dan@example.com', 'romy@example.com']]]);

    await romy.call('send', { chat, body: 'NVDA earnings tonight' });
    const reply = await dan.call('send', { chat, body: 'In at 180' });
    assert.equal(reply.status, 200);

    const read = (await romy.call('messages', undefined, `?chat=${chat}`)).body.messages;
    assert.deepEqual(read.map((m) => [m.email, m.body, m.mine]), [
      ['romy@example.com', 'NVDA earnings tonight', true],
      ['dan@example.com', 'In at 180', false],
    ]);
    // Only what is new since the last one seen, for the next check.
    const after = (await romy.call('messages', undefined, `?chat=${chat}&after=${encodeURIComponent(read[1].at)}`)).body.messages;
    assert.equal(after.length, 0);

    assert.equal((await eve.call('messages', undefined, `?chat=${chat}`)).status, 404);
    assert.equal((await eve.call('send', { chat, body: 'hi' })).status, 404);
    assert.equal((await romy.call('send', { chat, body: '   ' })).status, 400);
    assert.equal((await romy.call('send', { chat, body: 'x'.repeat(2001) })).status, 400);

    await dan.call('leave', { chat });
    assert.equal((await dan.call('chats')).body.chats.length, 0);
    assert.equal((await romy.call('chats')).body.chats[0].members.length, 1);
  });
});

describe('what each person chose to show (Profile → Investment details)', () => {
  test('Amounts: dollars as well — value, invested, cash and total', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    await friends(romy, dan);
    await romy.call('share', {
      summary: { mode: 'amount', holdings: [{ t: 'NVDA', w: 80, d: 'Long', v: 4000, inv: 2800 }], cash: 20, cashV: 1000, total: 5000 },
    });
    const seen = (await dan.call('portfolio', undefined, `?friend=${romy.id}`)).body;
    assert.equal(seen.mode, 'amount');
    assert.deepEqual(seen.holdings, [{ t: 'NVDA', w: 80, d: 'Long', c: '', v: 4000, inv: 2800 }]);
    assert.deepEqual([seen.cashV, seen.total], [1000, 5000]);
    assert.equal((await dan.call('friends')).body.friends[0].shows, 'amount');
    assert.equal((await romy.call('friends')).body.share.mode, 'amount');
  });

  test('Percentages: any dollars sent along are dropped', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    await friends(romy, dan);
    await romy.call('share', { summary: { mode: 'percent', holdings: [{ t: 'NVDA', w: 80, v: 4000, inv: 2800 }], cash: 20, cashV: 1000, total: 5000 } });
    const seen = (await dan.call('portfolio', undefined, `?friend=${romy.id}`)).body;
    assert.equal(seen.mode, 'percent');
    assert.doesNotMatch(JSON.stringify(seen), /4000|2800|1000|5000|"v"|inv|total|cashV/);
    assert.equal((await dan.call('friends')).body.friends[0].shows, 'percent');
  });

  test('None: nothing at all', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    await friends(romy, dan);
    await romy.call('share', { summary: { mode: 'amount', holdings: [{ t: 'NVDA', w: 100, v: 1 }] } });
    await romy.call('share', { summary: null });
    assert.equal((await dan.call('portfolio', undefined, `?friend=${romy.id}`)).body.shared, false);
    assert.equal((await dan.call('friends')).body.friends[0].shows, 'none');
    assert.equal((await romy.call('friends')).body.share.mode, 'none');
  });
});

describe('a chat with one friend', () => {
  test('the same chat from either side, friends only, and not left', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    const eve = await person('eve@example.com');
    await friends(romy, dan);
    assert.equal((await romy.call('direct', { friendId: eve.id })).status, 403);

    const mine = (await romy.call('direct', { friendId: dan.id })).body.id;
    const theirs = (await dan.call('direct', { friendId: romy.id })).body.id;
    assert.equal(mine, theirs);
    await romy.call('send', { chat: mine, body: 'Just us' });

    const [c] = (await dan.call('chats')).body.chats;
    assert.deepEqual([c.kind, c.name, c.with.email, c.owner], ['direct', 'romy@example.com', 'romy@example.com', false]);
    assert.equal((await dan.call('leave', { chat: mine })).status, 400);
    assert.equal((await romy.call('members', { chat: mine, add: [], remove: [dan.id] })).status, 400);
  });
});

describe("a group's members", () => {
  test('its maker adds and removes friends; nobody else can', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    const eve = await person('eve@example.com');
    const zoe = await person('zoe@example.com');
    await friends(romy, dan);
    await friends(romy, eve);
    const chat = (await romy.call('chat', { name: 'Desk', members: [dan.id] })).body.id;
    assert.equal((await romy.call('chats')).body.chats[0].owner, true);

    assert.equal((await dan.call('members', { chat, add: [eve.id] })).status, 403, 'only the maker');
    assert.equal((await romy.call('members', { chat, add: [zoe.id] })).status, 403, 'only friends');

    const changed = await romy.call('members', { chat, add: [eve.id], remove: [dan.id, romy.id] });
    assert.deepEqual(changed.body, { added: 1, removed: 1 }, 'the maker cannot remove themselves this way');
    const [c] = (await romy.call('chats')).body.chats;
    assert.deepEqual(c.members.map((m) => m.email), ['eve@example.com', 'romy@example.com']);
    assert.equal((await dan.call('messages', undefined, `?chat=${chat}`)).status, 404, 'removed: no longer reads it');
  });

  test('messages are permanent: they stay when people leave, even the last', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    const eve = await person('eve@example.com');
    await friends(romy, dan);
    await friends(romy, eve);
    const chat = (await romy.call('chat', { name: 'Desk', members: [dan.id, eve.id] })).body.id;
    await dan.call('send', { chat, body: 'kept' });

    // The maker leaves: whoever has been in it longest manages it now.
    await romy.call('leave', { chat });
    const owners = await Promise.all([dan, eve].map(async (p) => (await p.call('chats')).body.chats[0].owner));
    assert.equal(owners.filter(Boolean).length, 1);

    await dan.call('leave', { chat });
    assert.deepEqual((await eve.call('messages', undefined, `?chat=${chat}`)).body.messages.map((m) => m.body), ['kept']);
  });
});

describe('the endpoint', () => {
  test('signed in only, the right method, and no writes from another site', async () => {
    const stranger = makeClient();
    assert.equal((await stranger.call(social, { url: '/api/social/friends' })).status, 401);
    const romy = await person('romy@example.com');
    assert.equal((await romy.client.call(social, { method: 'POST', body: {}, url: '/api/social/friends' })).status, 405);
    assert.equal((await romy.client.call(social, { url: '/api/social/nothing' })).status, 404);
    const cross = await romy.client.call(social, {
      method: 'POST', body: { email: 'dan@example.com' }, url: '/api/social/request', headers: { origin: 'https://evil.example' },
    });
    assert.equal(cross.status, 403);
  });

  test('deleting an account takes its friendships, sharing and messages with it', async () => {
    const romy = await person('romy@example.com');
    const dan = await person('dan@example.com');
    await friends(romy, dan);
    await romy.call('share', { summary: { holdings: [{ t: 'NVDA', w: 100 }] } });
    const chat = (await romy.call('chat', { name: 'Two', members: [dan.id] })).body.id;
    await romy.call('send', { chat, body: 'bye' });

    const res = await romy.client.call(deleteAccount, {
      method: 'POST', body: { authSecret: await deriveAuthSecret(romy.password, romy.authSalt) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const left = (await dan.call('friends')).body;
    assert.equal(left.friends.length, 0);
    assert.deepEqual((await dan.call('messages', undefined, `?chat=${chat}`)).body.messages, []);
  });
});
