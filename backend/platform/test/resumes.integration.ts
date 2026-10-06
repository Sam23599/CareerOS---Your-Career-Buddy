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
import { ResumeStore } from '../src/resumes/store.js';
import { LocalResumeStorage } from '../src/resumes/storage.js';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error('Set TEST_MONGODB_URI to run MongoDB integration tests.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const db = client.db(`careeros_profiles_test_${randomUUID().replaceAll('-', '')}`);
const authStore = new AuthStore(db);
const auth = new AuthService(authStore, new Tokens(randomBytes(32).toString('hex')));
let directory: string;
let resumes: ResumeStore;
let first: Awaited<ReturnType<AuthService['register']>>;
let second: typeof first;
let server: Server;
let base: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'careeros-resumes-'));
  resumes = new ResumeStore(db, new LocalResumeStorage(directory));
  await authStore.initialize();
  first = await auth.register({ name: 'First User', email: 'first@example.com', password: 'a test passphrase' });
  second = await auth.register({ name: 'Second User', email: 'second@example.com', password: 'a test passphrase' });
  await authStore.users.updateOne({ _id: second.user.id }, { $set: { roles: ['ADMIN'] } });
  server = createApp(async () => { await db.command({ ping: 1 }); }, {
    service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false,
  }, undefined, resumes).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await client.close();
  await rm(directory, { recursive: true, force: true });
});
function request(token: string, path = '', method = 'GET', body?: Buffer) {
  return fetch(base + '/resumes' + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/pdf' } : {}) }, body: body ? new Uint8Array(body) : undefined });
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
let firstId: string;
let secondId: string;
test('uploads require authentication, PDF markers, extension and size limits', async () => {
  assert.equal((await request('')).status, 401);
  assert.equal((await request(first.accessToken, '?name=bad.txt', 'POST', pdf)).status, 400);
  assert.equal((await request(first.accessToken, '?name=resume.pdf', 'POST', Buffer.from('not pdf'))).status, 400);
  assert.equal((await request(first.accessToken, '?name=resume.pdf', 'POST', Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await request(first.accessToken, '?name=resume.pdf', 'POST')).status, 415);
  assert.deepEqual(await readdir(directory), []);
});
test('versions persist, download exact bytes, and selecting active updates the library', async () => {
  const response = await request(first.accessToken, '?name=first.pdf', 'POST', pdf);
  assert.equal(response.status, 201);
  const initial = (await response.json()).resumes[0]; firstId = initial.id;
  assert.equal(initial.active, true); assert.equal(initial.version, 1);
  const uploaded = (await (await request(first.accessToken, '?name=second.pdf', 'POST', pdf)).json()).resumes;
  secondId = uploaded[0].id;
  assert.equal(uploaded[0].version, 2); assert.equal(uploaded[0].active, false);
  const download = await request(first.accessToken, `/${firstId}/download`);
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition')!, /attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  const selected = (await (await request(first.accessToken, `/${secondId}/active`, 'PUT')).json()).resumes;
  assert.deepEqual(selected.filter((item: { active: boolean }) => item.active).map((item: { id: string }) => item.id), [secondId]);
});
test('another user including ADMIN cannot download, select or delete owned resumes', async () => {
  assert.deepEqual((await (await request(second.accessToken)).json()).resumes, []);
  for (const [path, method] of [[`/${firstId}/download`, 'GET'], [`/${firstId}/active`, 'PUT'], [`/${firstId}`, 'DELETE']]) {
    assert.equal((await request(second.accessToken, path, method)).status, 404);
  }
});
test('deletion retains bytes, clears active selection and keeps version numbers increasing', async () => {
  const deleted = await request(first.accessToken, `/${secondId}`, 'DELETE'); assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).resumes.some((item: { active: boolean }) => item.active), false);
  assert.equal((await request(first.accessToken, `/${secondId}/download`)).status, 404);
  assert.deepEqual((await readdir(directory)).sort(), [firstId, secondId].sort());
  const next = (await (await request(first.accessToken, '?name=third.pdf', 'POST', pdf)).json()).resumes[0];
  assert.equal(next.version, 3); assert.equal(next.active, true);
});
test('trash hides a resume without calling destructive storage cleanup', async () => {
  const disk = new LocalResumeStorage(directory);
  const store = new ResumeStore(db, { put: (key, data) => disk.put(key, data), get: key => disk.get(key), remove: async () => { throw new Error('Destructive cleanup must not run'); } });
  await store.remove(first.user.id, firstId);
  await assert.rejects(store.download(first.user.id, firstId));
  await assert.rejects(store.activate(first.user.id, firstId));
  assert.equal((await readdir(directory)).includes(firstId), true);
});

test('concurrent uploads allocate distinct versions and keep one active selection', async () => {
  const owner = randomUUID();
  await Promise.all([1, 2, 3].map(number => resumes.upload(owner, `version-${number}.pdf`, pdf)));
  const library = await resumes.list(owner);
  assert.deepEqual(library.resumes.map(item => item.version), [3, 2, 1]);
  assert.equal(library.resumes.filter(item => item.active).length, 1);
  await Promise.all(library.resumes.map(item => resumes.remove(owner, item.id)));
  assert.deepEqual((await resumes.list(owner)).resumes, []);
});
