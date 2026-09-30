import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { type Server } from 'node:http';
import { MongoClient } from 'mongodb';
import { createApp } from '../src/app.js';
import { AuthStore } from '../src/auth/store.js';
import { AuthService } from '../src/auth/service.js';
import { Tokens } from '../src/auth/tokens.js';
import { ProfileStore } from '../src/profiles/store.js';
import { emptyProfile } from '../src/profiles/model.js';

const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error('Set TEST_MONGODB_URI to run MongoDB integration tests.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const db = client.db(`careeros_profiles_test_${randomUUID().replaceAll('-', '')}`);
const authStore = new AuthStore(db);
const auth = new AuthService(authStore, new Tokens(randomBytes(32).toString('hex')));
const profiles = new ProfileStore(db);
let first: Awaited<ReturnType<AuthService['register']>>;
let second: typeof first;
let server: Server;
let base: string;

before(async () => {
  await authStore.initialize();
  first = await auth.register({ name: 'First User', email: 'first@example.com', password: 'a test passphrase' });
  second = await auth.register({ name: 'Second User', email: 'second@example.com', password: 'a test passphrase' });
  await authStore.users.updateOne({ _id: second.user.id }, { $set: { roles: ['ADMIN'] } });
  server = createApp(async () => { await db.command({ ping: 1 }); }, {
    service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false,
  }, profiles).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await client.close();
});
function get(token: string, path = '/profiles/me') { return fetch(base + path, { headers: { Authorization: `Bearer ${token}` } }); }
function patch(token: string, body: unknown) { return fetch(base + '/profiles/me', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

test('profiles require bearer authentication and new profiles have private empty defaults', async () => {
  assert.equal((await fetch(base + '/profiles/me')).status, 401);
  assert.equal((await patch('', { version: 0, fullName: 'Name' })).status, 401);
  const response = await get(first.accessToken);
  assert.equal(response.status, 200);
  const { profile } = await response.json();
  assert.equal(profile.fullName, 'First User');
  assert.equal(profile.version, 0);
  assert.deepEqual(profile.skills, []);
  assert.equal(await profiles.profiles.countDocuments(), 0);
  assert.equal('userId' in profile, false);
  assert.equal('passwordHash' in profile, false);
});

test('complete profiles persist, partial edits preserve omitted fields, and explicit removals work', async () => {
  const payload = {
    ...emptyProfile('Career Name'), version: 0, headline: 'Backend engineer', skills: ['Python', 'python', 'React'],
    experience: [{ company: 'Example', role: 'Engineer', location: 'Remote', startDate: '2023-01', endDate: '', current: true, description: 'Built services' }],
    education: [{ institution: 'University', qualification: 'BSc', field: 'CS', startDate: '2018-06', endDate: '2022-05' }],
    certifications: [{ name: 'Cloud', issuer: 'Example', issuedDate: '2025-02', url: 'https://example.com/cert' }],
    links: [{ label: 'Portfolio', url: 'https://example.com/' }],
  };
  const response = await patch(first.accessToken, payload);
  assert.equal(response.status, 200);
  const { profile } = await response.json();
  assert.equal(profile.version, 1);
  assert.deepEqual(profile.skills, ['Python', 'React']);
  assert.ok(profile.updatedAt);
  assert.equal((await (await get(first.accessToken)).json()).profile.fullName, 'Career Name');
  const edit = await patch(first.accessToken, { version: 1, headline: '', links: [], certifications: [] });
  assert.equal(edit.status, 200);
  const edited = (await edit.json()).profile;
  assert.equal(edited.headline, '');
  assert.equal(edited.experience.length, 1);
  assert.deepEqual(edited.links, []);
  assert.deepEqual(edited.certifications, []);
  assert.equal((await (await get(first.accessToken, '/users/me')).json()).user.name, 'First User');
});

test('neither owner IDs nor ADMIN roles allow access to another user profile', async () => {
  const own = await get(second.accessToken, `/profiles/me?userId=${first.user.id}`);
  assert.equal((await own.json()).profile.fullName, 'Second User');
  assert.equal((await get(second.accessToken, `/profiles/${first.user.id}`)).status, 404);
  assert.equal((await patch(second.accessToken, { version: 0, userId: first.user.id, summary: 'Overwrite' })).status, 400);
  assert.equal((await patch(second.accessToken, { version: 0, roles: ['ADMIN'] })).status, 400);
  assert.equal((await (await get(first.accessToken)).json()).profile.fullName, 'Career Name');
});

test('concurrent first saves and stale updates return conflicts without losing newer data', async () => {
  const results = await Promise.all(['First edit', 'Second edit'].map(headline => patch(second.accessToken, { version: 0, headline })));
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  const winning = (await (await get(second.accessToken)).json()).profile;
  const updates = await Promise.all(['Third edit', 'Fourth edit'].map(headline => patch(second.accessToken, { version: winning.version, headline })));
  assert.deepEqual(updates.map(response => response.status).sort(), [200, 409]);
  const stale = await patch(first.accessToken, { version: 1, fullName: 'Stale name' });
  assert.equal(stale.status, 409);
  assert.equal((await (await get(first.accessToken)).json()).profile.fullName, 'Career Name');
  const invalid = await patch(first.accessToken, { version: 2, links: [{ label: 'Bad', url: 'javascript:alert(1)' }] });
  assert.equal(invalid.status, 400);
  assert.equal((await (await get(first.accessToken)).json()).profile.version, 2);
});
