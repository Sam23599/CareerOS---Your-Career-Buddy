import assert from 'node:assert/strict';
import { after, before, test, mock } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { type Server } from 'node:http';
import express from 'express';
import { MongoClient } from 'mongodb';
import { createApp } from '../src/app.js';
import { handleError } from '../src/errors.js';
import { AuthStore } from '../src/auth/store.js';
import { AuthService } from '../src/auth/service.js';
import { Tokens } from '../src/auth/tokens.js';
import { authenticate, requireRoles } from '../src/auth/routes.js';
import { type OAuthProvider } from '../src/auth/oauth-providers.js';
import { tokenHash } from '../src/auth/tokens.js';

const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error('Set TEST_MONGODB_URI to run MongoDB integration tests.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const db = client.db(`careeros_auth_test_${randomUUID().replaceAll('-', '')}`);
const store = new AuthStore(db);
const service = new AuthService(store, new Tokens(randomBytes(32).toString('hex')));
const origin = 'http://localhost:5173';
let server: Server;
let base: string;

before(async () => {
  await store.initialize();
  const app = express();
  app.get('/admin-check', authenticate(service), requireRoles('ADMIN'), (_req, res) => res.json({ ok: true }));
  const providers: OAuthProvider[] = (['google', 'github'] as const).map(id => ({
    id, name: id,
    async authorizationUrl(attempt) { return new URL(`https://provider.example/authorize?state=${attempt.state}`); },
    async exchange(url, attempt) {
      if (url.searchParams.has('error') || url.searchParams.get('code') === 'invalid' || !attempt.verifier || !attempt.nonce) throw new Error('Provider rejected');
      return { provider: id, subject: `${id}-${url.searchParams.get('code') === 'collision' ? 'other' : '123'}`, email: `${id}-oauth@example.com`, name: 'OAuth User' };
    },
  }));
  app.use(createApp(async () => { await db.command({ ping: 1 }); }, {
    service, allowedOrigins: [origin], secureCookie: false, oauth: { providers, publicOrigin: origin },
  }));
  app.use(handleError);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase();
  await client.close();
});
const email = () => `${randomUUID()}@example.com`;
const password = 'a strong test passphrase';
async function post(path: string, body: unknown = {}, cookie = '', headers: Record<string, string> = {}) {
  return fetch(`${base}/api/v1/auth/${path}`, {
    method: 'POST', headers: { Origin: origin, 'X-CareerOS-Client': 'web', 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    body: JSON.stringify(body),
  });
}
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
const me = (token: string) => fetch(`${base}/api/v1/users/me`, { headers: { Authorization: `Bearer ${token}` } });
async function register() {
  const address = email();
  const response = await post('register', { name: 'Ada', email: address, password });
  assert.equal(response.status, 201);
  return { response, body: await response.json(), email: address, cookie: cookieOf(response) };
}
async function oauthSession() {
  const body = await service.oauthSignIn({ provider: 'github', subject: randomUUID(), email: email(), name: 'Restore Tester' });
  return { body, cookie: `careeros_refresh=${body.refreshToken}` };
}

test('registration persists safe defaults and duplicate emails are rejected atomically', async () => {
  const account = await register();
  assert.deepEqual(account.body.user.roles, ['USER']);
  assert.equal('passwordHash' in account.body.user, false);
  assert.equal('refreshToken' in account.body, false);
  assert.match(account.response.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(account.response.headers.get('set-cookie')!, /SameSite=Strict/);
  assert.match(account.response.headers.get('set-cookie')!, /Path=\/api\/v1\/auth/);
  const stored = await store.users.findOne({ email: account.email });
  assert.ok(stored?.passwordHash?.startsWith('scrypt$'));
  assert.ok(stored);
  const session = await store.sessions.findOne({ userId: stored._id });
  assert.match(session!.refreshHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(session).includes(account.cookie.split('=')[1]), false);
  assert.equal((await post('register', { name: 'Other', email: account.email.toUpperCase(), password })).status, 409);
  const malicious = await post('register', { name: 'Other', email: email(), password, roles: ['ADMIN'] });
  assert.equal(malicious.status, 400);
  const duplicate = email();
  const responses = await Promise.all([1, 2].map(() => post('register', { name: 'Concurrent', email: duplicate, password })));
  assert.deepEqual(responses.map(res => res.status).sort(), [201, 409]);
});

test('login, role enforcement, and session ownership use the current database state', async () => {
  const account = await register();
  const wrong = await post('login', { email: account.email, password: 'incorrect passphrase' });
  const unknown = await post('login', { email: email(), password });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal((await wrong.json()).error.message, (await unknown.json()).error.message);
  const login = await post('login', { email: account.email.toUpperCase(), password });
  assert.equal(login.status, 200);
  const { accessToken } = await login.json();
  assert.equal((await me(accessToken)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/users/me`)).status, 401);
  assert.equal((await me(accessToken + 'changed')).status, 401);
  const admin = () => fetch(`${base}/admin-check`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.equal((await admin()).status, 403);
  await store.users.updateOne({ email: account.email }, { $set: { roles: ['ADMIN'] } });
  assert.equal((await admin()).status, 200);
  await store.users.updateOne({ email: account.email }, { $set: { roles: ['USER'] } });
  assert.equal((await admin()).status, 403);
  const second = await register();
  assert.equal((await (await me(second.body.accessToken)).json()).user.id, second.body.user.id);
  assert.notEqual(second.body.user.id, account.body.user.id);
});

test('refresh rotates once; reuse revokes the session and its access tokens', async () => {
  const account = await register();
  assert.equal((await me(account.cookie.split('=')[1])).status, 401);
  const rotated = await post('refresh', {}, account.cookie);
  assert.equal(rotated.status, 200);
  assert.notEqual(cookieOf(rotated), account.cookie);
  const next = await rotated.json();
  assert.equal((await me(next.accessToken)).status, 200);
  assert.equal((await post('refresh', {}, account.cookie)).status, 401);
  assert.equal((await post('refresh', {}, cookieOf(rotated))).status, 401);
  assert.equal((await me(next.accessToken)).status, 401);
});

test('restoration is repeatable across tabs without rotating, extending expiry or exposing the cookie', async () => {
  const account = await oauthSession();
  const before = await store.sessions.findOne({ userId: account.body.user.id });
  const responses = await Promise.all([1, 2, 3].map(() => post('restore', {}, account.cookie)));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    const body = await response.json();
    assert.equal('refreshToken' in body, false);
    assert.equal((await me(body.accessToken)).status, 200);
  }
  const after = await store.sessions.findOne({ userId: account.body.user.id });
  assert.equal(after!.refreshHash, before!.refreshHash);
  assert.equal(after!.expiresAt.getTime(), before!.expiresAt.getTime());
  assert.equal((await post('refresh', {}, account.cookie)).status, 200);
});

test('restoration rejects rotated tokens and revokes the session on replay', async () => {
  const account = await oauthSession();
  const rotated = await post('refresh', {}, account.cookie);
  const next = await rotated.json();
  assert.equal((await post('restore', {}, cookieOf(rotated))).status, 200);
  assert.equal((await post('restore', {}, account.cookie)).status, 401);
  assert.equal((await post('restore', {}, cookieOf(rotated))).status, 401);
  assert.equal((await me(next.accessToken)).status, 401);
  assert.equal((await post('restore')).status, 401);
  assert.equal((await post('restore', {}, `careeros_refresh=${account.body.accessToken}`)).status, 401);
});

test('logout and absolute session expiry invalidate access immediately', async () => {
  const account = await register();
  const logout = await post('logout', {}, account.cookie);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await me(account.body.accessToken)).status, 401);
  assert.equal((await post('refresh', {}, account.cookie)).status, 401);
  assert.equal((await post('restore', {}, account.cookie)).status, 401);
  assert.equal((await post('logout')).status, 204);
  const login = await post('login', { email: account.email, password });
  const next = await login.json();
  await store.sessions.updateMany({ userId: account.body.user.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await me(next.accessToken)).status, 401);
  assert.equal((await post('refresh', {}, cookieOf(login))).status, 401);
  assert.equal((await post('restore', {}, cookieOf(login))).status, 401);
});

test('CSRF guards reject foreign origins, missing custom headers, and non-JSON requests', async () => {
  assert.equal((await post('logout', {}, '', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('logout', {}, '', { Origin: '' })).status, 403);
  assert.equal((await post('logout', {}, '', { 'X-CareerOS-Client': '' })).status, 403);
  assert.equal((await post('logout', {}, '', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('restore', {}, '', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('restore', {}, '', { 'X-CareerOS-Client': '' })).status, 403);
  assert.equal((await post('restore', {}, '', { 'Content-Type': 'text/plain' })).status, 415);
});

test('OAuth users can add a password to the same account without changing provider identity or allowing overwrite', async () => {
  const account = await oauthSession();
  const headers = { Authorization: `Bearer ${account.body.accessToken}` };
  assert.equal(account.body.user.hasPassword, false);
  assert.equal(account.body.user.passwordPromptPending, true);
  assert.equal((await post('password', { password }, account.cookie)).status, 401);
  assert.equal((await post('password', { password }, '', { ...headers, Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('password', { password, userId: 'another-user' }, '', headers)).status, 400);
  const added = await post('password', { password }, '', headers);
  assert.equal(added.status, 200);
  const { user } = await added.json();
  assert.equal(user.id, account.body.user.id);
  assert.equal(user.hasPassword, true);
  assert.equal(user.passwordPromptPending, false);
  assert.equal(user.oauthProvider, 'github');
  assert.equal('passwordHash' in user, false);
  const stored = await store.users.findOne({ _id: user.id });
  assert.ok(stored?.passwordHash?.startsWith('scrypt$'));
  assert.equal((await post('password', { password: 'a different passphrase' }, '', headers)).status, 409);
  const login = await post('login', { email: user.email, password });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.id, user.id);
  const returning = await service.oauthSignIn({ provider: 'github', subject: stored!.oauth!.subject, email: user.email, name: user.name });
  assert.equal(returning.user.id, user.id);
  assert.equal(returning.user.hasPassword, true);
  assert.equal(returning.user.passwordPromptPending, false);
  await post('logout', {}, account.cookie);
  assert.equal((await post('password', { password }, '', headers)).status, 401);
});

test('password enrollment requires recent sign-in and atomically permits only one new password', async () => {
  const old = await oauthSession();
  await store.sessions.updateOne({ userId: old.body.user.id }, { $set: { createdAt: new Date(Date.now() - 16 * 60_000) } });
  const rejected = await post('password', { password }, '', { Authorization: `Bearer ${old.body.accessToken}` });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, 'REAUTH_REQUIRED');
  assert.equal((await store.users.findOne({ _id: old.body.user.id }))!.passwordHash, undefined);
  const concurrent = await oauthSession();
  const results = await Promise.allSettled([
    service.addPassword(concurrent.body.accessToken, { password }),
    service.addPassword(concurrent.body.accessToken, { password: 'another concurrent password' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const local = await register();
  await assert.rejects(service.addPassword(local.body.accessToken, { password }), /already has a password/);
});

test('password suggestion is optional and never returns after dismissal or a returning OAuth sign-in', async () => {
  const account = await oauthSession();
  assert.equal((await post('password-prompt/dismiss')).status, 401);
  const dismissed = await post('password-prompt/dismiss', {}, '', { Authorization: `Bearer ${account.body.accessToken}` });
  assert.equal(dismissed.status, 200);
  assert.equal((await dismissed.json()).user.passwordPromptPending, false);
  assert.equal((await (await post('restore', {}, account.cookie)).json()).user.passwordPromptPending, false);
  const skipped = await oauthSession();
  const stored = await store.users.findOne({ _id: skipped.body.user.id });
  const returning = await service.oauthSignIn({ provider: 'github', subject: stored!.oauth!.subject, email: stored!.email, name: stored!.name });
  assert.equal(returning.user.passwordPromptPending, false);
  assert.equal(returning.user.hasPassword, false);
});

test('optional usernames are unique, case-insensitive and usable with the same password account', async () => {
  const account = await oauthSession();
  await service.addPassword(account.body.accessToken, { password });
  const headers = { Authorization: `Bearer ${account.body.accessToken}` };
  const username = `tester_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  assert.equal((await post('username', { username })).status, 401);
  assert.equal((await post('username', { username, userId: 'another' }, '', headers)).status, 400);
  const saved = await post('username', { username: username.toUpperCase() }, '', headers);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).user.username, username);
  const login = await post('login', { identifier: username.toUpperCase(), password });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.id, account.body.user.id);
  assert.equal((await post('login', { identifier: account.body.user.email, password })).status, 200);
  const other = await oauthSession();
  const collision = await post('username', { username }, '', { Authorization: `Bearer ${other.body.accessToken}` });
  assert.equal(collision.status, 409);
  assert.equal((await collision.json()).error.code, 'USERNAME_IN_USE');
  const raced = await Promise.all([account, other].map(value => post('username', { username: `${username}_race` }, '', { Authorization: `Bearer ${value.body.accessToken}` })));
  assert.deepEqual(raced.map(value => value.status).sort(), [200, 409]);
  const removed = await post('username', { username: '' }, '', headers);
  assert.equal((await removed.json()).user.username, null);
  assert.equal((await post('login', { identifier: username, password })).status, 401);
  await post('logout', {}, account.cookie);
  assert.equal((await post('username', { username }, '', headers)).status, 401);
});

test('login attempts are throttled', async () => {
  let response: Response | undefined;
  for (let index = 0; index < 22; index++) {
    response = await post('login', { email: 'invalid' });
    if (response.status === 429) break;
  }
  assert.equal(response!.status, 429);
  assert.ok(response!.headers.get('retry-after'));
});


test('both OAuth callbacks require browser-bound, single-use state and create CareerOS sessions', async () => {
  for (const provider of ['google', 'github']) {
    const start = await fetch(`${base}/api/v1/auth/oauth/${provider}/start`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const binding = cookieOf(start);
    assert.match(start.headers.get('set-cookie')!, /SameSite=Lax/);
    const callback = `${base}/api/v1/auth/oauth/${provider}/callback?state=${state}&code=example`;
    const missingBinding = await fetch(callback, { redirect: 'manual' });
    assert.match(missingBinding.headers.get('location')!, /oauth=failed/);
    const success = await fetch(callback, { headers: { Cookie: binding }, redirect: 'manual' });
    assert.equal(success.headers.get('location'), `${origin}/dashboard`);
    const sessionCookie = success.headers.getSetCookie().find(value => value.startsWith('careeros_refresh='))!.split(';')[0];
    const refreshed = await post('refresh', {}, sessionCookie);
    assert.equal(refreshed.status, 200);
    const result = await refreshed.json();
    assert.deepEqual(result.user.roles, ['USER']);
    assert.equal((await me(result.accessToken)).status, 200);
    assert.equal((await store.users.findOne({ _id: result.user.id }))!.passwordHash, undefined);
    const replay = await fetch(callback, { headers: { Cookie: binding }, redirect: 'manual' });
    assert.match(replay.headers.get('location')!, /oauth=failed/);
    assert.equal(replay.headers.getSetCookie().some(value => value.startsWith('careeros_refresh=')), false);
  }
});

test('OAuth state expires and provider cancellation does not create a session', async () => {
  for (const provider of ['google', 'github']) {
    for (const scenario of ['expired', 'cancelled']) {
      const start = await fetch(`${base}/api/v1/auth/oauth/${provider}/start`, { redirect: 'manual' });
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      if (scenario === 'expired') await store.oauthAttempts.updateOne({ _id: tokenHash(state) }, { $set: { expiresAt: new Date(0) } });
      const callback = await fetch(`${base}/api/v1/auth/oauth/${provider}/callback?state=${state}&error=access_denied`, {
        headers: { Cookie: cookieOf(start) }, redirect: 'manual',
      });
      assert.match(callback.headers.get('location')!, /oauth=failed/);
      assert.equal(callback.headers.getSetCookie().some(value => value.startsWith('careeros_refresh=')), false);
    }
  }
});

test('GitHub callback failures and email conflicts return safe errors without creating sessions', async () => {
  const sessions = await store.sessions.countDocuments();
  const warnings: string[] = [];
  const logger = mock.method(console, 'warn', (message: string) => { warnings.push(message); });
  try {
    for (const [code, message, stage] of [['invalid', 'failed', 'exchange'], ['collision', 'account_exists', 'session']]) {
      const start = await fetch(`${base}/api/v1/auth/oauth/github/start`, { redirect: 'manual' });
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      const binding = cookieOf(start);
      const callback = await fetch(`${base}/api/v1/auth/oauth/github/callback?state=${state}&code=${code}`, {
        headers: { Cookie: binding }, redirect: 'manual',
      });
      assert.equal(callback.headers.get('location'), `${origin}/login?oauth=${message}`);
      assert.equal(callback.headers.getSetCookie().some(value => value.startsWith('careeros_refresh=')), false);
      assert.equal(await store.sessions.countDocuments(), sessions);
      const warning = warnings.at(-1)!;
      assert.equal(JSON.parse(warning).stage, stage);
      assert.equal(warning.includes(state), false);
      assert.equal(warning.includes(binding.split('=')[1]), false);
      assert.equal(warning.includes('Provider rejected'), false);
    }
  } finally { logger.mock.restore(); }
});

test('OAuth uses stable provider identity and never silently links matching emails', async () => {
  const identity = { provider: 'google' as const, subject: 'stable-google-id', email: 'stable@example.com', name: 'Stable' };
  const first = await service.oauthSignIn(identity);
  const returning = await service.oauthSignIn({ ...identity, email: 'new-address@example.com' });
  assert.equal(first.user.id, returning.user.id);
  await assert.rejects(service.oauthSignIn({ ...identity, provider: 'github', subject: 'different' }), /original sign-in method/);
  const passwordUser = await store.users.findOne({ passwordHash: { $exists: true } });
  assert.ok(passwordUser);
  await assert.rejects(service.oauthSignIn({ ...identity, subject: 'email-collision', email: passwordUser.email }), /original sign-in method/);
});
