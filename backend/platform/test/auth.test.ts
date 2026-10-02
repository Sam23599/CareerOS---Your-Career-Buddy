import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';
import { credentials, loginCredentials, newPassword, usernameInput } from '../src/auth/validation.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { Tokens } from '../src/auth/tokens.js';
import { readConfig } from '../src/config.js';
import { createOAuthProviders, googleIdentity, githubIdentity } from '../src/auth/oauth-providers.js';

test('credentials normalize identity but preserve passwords and reject privilege input', () => {
  const password = ' long passphrase ';
  assert.deepEqual(credentials({ name: ' Ada ', email: ' ADA@EXAMPLE.COM ', password }, true), {
    name: 'Ada', email: 'ada@example.com', password,
  });
  for (const body of [null, [], { email: { $ne: null }, password }, { name: 'Ada', email: 'ada@example.com', password, roles: ['ADMIN'] }, { name: 'Ada', email: 'ada@example.com', password: 'short' }]) {
    assert.throws(() => credentials(body, true));
  }
});

test('passwords are salted and verifiable without storing plaintext', async () => {
  const first = await hashPassword('a long test passphrase');
  const second = await hashPassword('a long test passphrase');
  assert.notEqual(first, second);
  assert.equal(first.includes('a long test passphrase'), false);
  assert.equal(await verifyPassword('a long test passphrase', first), true);
  assert.equal(await verifyPassword('incorrect password', first), false);
});

test('password enrollment accepts only a password with the registration length limits', () => {
  assert.equal(newPassword({ password: ' long passphrase ' }), ' long passphrase ');
  for (const body of [null, [], {}, { password: 'short' }, { password: 'x'.repeat(129) }, { password: { $ne: null } }, { password: 'a valid passphrase', userId: 'other' }]) {
    assert.throws(() => newPassword(body));
  }
});

test('optional usernames and login identifiers normalize case and reject ambiguous or unsafe input', () => {
  assert.equal(usernameInput({ username: ' Test_User ' }), 'test_user');
  assert.equal(usernameInput({ username: ' ' }), '');
  assert.deepEqual(loginCredentials({ identifier: ' TEST_USER ', password: ' untrimmed password ' }), { identifier: 'test_user', password: ' untrimmed password ' });
  assert.equal(loginCredentials({ email: ' TEST@EXAMPLE.COM ', password: 'password' }).identifier, 'test@example.com');
  for (const body of [null, { username: 'ab' }, { username: 'invalid-name' }, { username: 'a'.repeat(31) }, { username: 'test', roles: ['ADMIN'] }]) assert.throws(() => usernameInput(body));
  for (const body of [{ identifier: { $ne: null }, password: 'password' }, { identifier: 'test', email: 'test@example.com', password: 'password' }, { identifier: 'invalid name', password: 'password' }, { identifier: 'test', password: '' }]) assert.throws(() => loginCredentials(body));
});

test('JWT verification rejects expiry, tampering, and the wrong token purpose', async () => {
  const tokens = new Tokens(randomBytes(32).toString('hex'));
  const access = await tokens.issue('access', 'user', 'session', new Date(Date.now() + 60_000));
  assert.deepEqual(await tokens.verify('access', access), { userId: 'user', sessionId: 'session' });
  await assert.rejects(tokens.verify('refresh', access));
  await assert.rejects(tokens.verify('access', access + 'tampered'));
  const expired = await tokens.issue('access', 'user', 'session', new Date(Date.now() - 1000));
  await assert.rejects(tokens.verify('access', expired));
  await assert.rejects(new Tokens(randomBytes(32).toString('hex')).verify('access', access));
});

test('auth configuration fails closed for missing secrets and insecure production', () => {
  const base = { MONGODB_URI: 'mongodb://localhost/careeros', AUTH_SECRET: 'ab'.repeat(32) };
  assert.throws(() => readConfig({ ...base, AUTH_SECRET: '' }), /AUTH_SECRET/);
  assert.throws(() => readConfig({ ...base, AUTH_ALLOWED_ORIGINS: '*' }), /AUTH_ALLOWED_ORIGINS/);
  assert.throws(() => readConfig({ ...base, NODE_ENV: 'production' }), /Production/);
  assert.equal(readConfig({ ...base, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'true', AUTH_ALLOWED_ORIGINS: 'https://careeros.example' }).secureCookie, true);
});


test('OAuth identity mapping requires verified email and stable provider IDs', () => {
  assert.equal(googleIdentity({ sub: '123', email: 'ADA@example.com', email_verified: true, name: 'Ada' }).email, 'ada@example.com');
  assert.throws(() => googleIdentity({ sub: '123', email: 'ada@example.com', email_verified: false }));
  assert.throws(() => googleIdentity({ email: 'ada@example.com', email_verified: true }));
  assert.equal(githubIdentity({ id: 123, login: 'ada' }, [{ email: 'ada@example.com', primary: true, verified: true }]).subject, '123');
  assert.throws(() => githubIdentity({ id: 123 }, [{ email: 'ada@example.com', primary: true, verified: false }]));
  assert.throws(() => githubIdentity({ login: 'ada' }, [{ email: 'ada@example.com', primary: true, verified: true }]));
});

test('both OAuth authorization URLs use PKCE and fixed callbacks; Google includes nonce', async () => {
  const providers = createOAuthProviders({ publicOrigin: 'http://localhost:5173',
    google: { clientId: 'google-id', clientSecret: 'secret' }, github: { clientId: 'github-id', clientSecret: 'secret' },
  });
  for (const provider of providers) {
    const url = await provider.authorizationUrl({ state: 'random-state', nonce: 'random-nonce', verifier: 'a'.repeat(43) });
    assert.equal(url.searchParams.get('state'), 'random-state');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(url.searchParams.get('redirect_uri'), `http://localhost:5173/api/v1/auth/oauth/${provider.id}/callback`);
    assert.equal(url.searchParams.get('client_secret'), null);
    assert.equal(url.searchParams.get('prompt'), null);
    const selection = await provider.authorizationUrl({ state: 'random-state', nonce: 'random-nonce', verifier: 'a'.repeat(43) }, true);
    assert.equal(selection.searchParams.get('prompt'), 'select_account');
    assert.equal(selection.searchParams.get('state'), 'random-state');
    if (provider.id === 'google') assert.equal(url.searchParams.get('nonce'), 'random-nonce');
  }
});


test('Google exchanges a PKCE code and validates ID-token signature and nonce', async () => {
  const key = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(key.publicKey), kid: 'google-test-key', use: 'sig', alg: 'RS256' };
  let nonce = 'expected-nonce';
  const transport = mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get('code_verifier'), 'a'.repeat(43));
    assert.equal(body.get('redirect_uri'), 'http://localhost:5173/api/v1/auth/oauth/google/callback');
    const idToken = await new SignJWT({ nonce, email: 'google@example.com', email_verified: true, name: 'Google User' })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' }).setIssuer('https://accounts.google.com')
      .setAudience('google-client').setSubject('stable-google-subject').setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
    return Response.json({ token_type: 'Bearer', access_token: 'provider-only-token', expires_in: 300, id_token: idToken });
  });
  try {
    const [provider] = createOAuthProviders({ publicOrigin: 'http://localhost:5173', google: { clientId: 'google-client', clientSecret: 'secret' } });
    const callback = new URL('http://localhost:5173/api/v1/auth/oauth/google/callback?code=code&state=state');
    const attempt = { verifier: 'a'.repeat(43), state: 'state', nonce: 'expected-nonce' };
    assert.equal((await provider.exchange(callback, attempt)).subject, 'stable-google-subject');
    nonce = 'wrong-nonce';
    await assert.rejects(provider.exchange(callback, attempt));
    assert.ok(transport.mock.callCount() >= 3);
  } finally { transport.mock.restore(); }
});

test('GitHub exchanges a PKCE code and fetches the verified primary email', async () => {
  const transport = mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('code_verifier'), 'a'.repeat(43));
      return Response.json({ access_token: 'github-token', token_type: 'bearer', scope: 'read:user,user:email' });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer github-token');
    if (url === 'https://api.github.com/user') return Response.json({ id: 456, login: 'github-user' });
    assert.equal(url, 'https://api.github.com/user/emails');
    return Response.json([{ email: 'github@example.com', verified: true, primary: true }]);
  });
  try {
    const [provider] = createOAuthProviders({ publicOrigin: 'http://localhost:5173', github: { clientId: 'github-client', clientSecret: 'secret' } });
    const callback = new URL('http://localhost:5173/api/v1/auth/oauth/github/callback?code=code&state=state');
    callback.searchParams.set('iss', 'https://github.com/login/oauth');
    const attempt = { verifier: 'a'.repeat(43), state: 'state', nonce: 'unused' };
    const identity = await provider.exchange(callback, attempt);
    assert.deepEqual(identity, { provider: 'github', subject: '456', email: 'github@example.com', name: 'github-user' });
    const requests = transport.mock.callCount();
    callback.searchParams.set('iss', 'https://attacker.example');
    await assert.rejects(provider.exchange(callback, attempt));
    assert.equal(transport.mock.callCount(), requests);
    callback.searchParams.delete('iss');
    assert.equal((await provider.exchange(callback, attempt)).subject, '456');
  } finally { transport.mock.restore(); }
});
