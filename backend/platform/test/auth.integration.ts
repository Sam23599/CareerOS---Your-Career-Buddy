import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
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
      if (url.searchParams.has('error') || !attempt.verifier || !attempt.nonce) throw new Error('Provider rejected');
      return { provider: id, subject: `${id}-123`, email: `${id}-oauth@example.com`, name: 'OAuth User' };
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

test('logout and absolute session expiry invalidate access immediately', async () => {
  const account = await register();
  const logout = await post('logout', {}, account.cookie);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await me(account.body.accessToken)).status, 401);
  assert.equal((await post('refresh', {}, account.cookie)).status, 401);
  assert.equal((await post('logout')).status, 204);
  const login = await post('login', { email: account.email, password });
  const next = await login.json();
  await store.sessions.updateMany({ userId: account.body.user.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await me(next.accessToken)).status, 401);
  assert.equal((await post('refresh', {}, cookieOf(login))).status, 401);
});

test('CSRF guards reject foreign origins, missing custom headers, and non-JSON requests', async () => {
  assert.equal((await post('logout', {}, '', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('logout', {}, '', { Origin: '' })).status, 403);
  assert.equal((await post('logout', {}, '', { 'X-CareerOS-Client': '' })).status, 403);
  assert.equal((await post('logout', {}, '', { 'Content-Type': 'text/plain' })).status, 415);
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
  for (const scenario of ['expired', 'cancelled']) {
    const start = await fetch(`${base}/api/v1/auth/oauth/google/start`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    if (scenario === 'expired') await store.oauthAttempts.updateOne({ _id: tokenHash(state) }, { $set: { expiresAt: new Date(0) } });
    const callback = await fetch(`${base}/api/v1/auth/oauth/google/callback?state=${state}&error=access_denied`, {
      headers: { Cookie: cookieOf(start) }, redirect: 'manual',
    });
    assert.match(callback.headers.get('location')!, /oauth=failed/);
    assert.equal(callback.headers.getSetCookie().some(value => value.startsWith('careeros_refresh=')), false);
  }
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
