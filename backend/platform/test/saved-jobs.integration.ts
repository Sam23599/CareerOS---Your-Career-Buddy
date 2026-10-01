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
import { SavedJobStore } from '../src/saved-jobs/store.js';
import { JobStore } from '../src/jobs/store.js';
import { FixtureSource } from '../src/jobs/sources.js';



const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error('Set TEST_MONGODB_URI to run MongoDB integration tests.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const db = client.db(`careeros_saved_jobs_test_${randomUUID().replaceAll('-', '')}`);
const authStore = new AuthStore(db);
const auth = new AuthService(authStore, new Tokens(randomBytes(32).toString('hex')));
const jobs = new JobStore(db);
const savedJobs = new SavedJobStore(db);
const fixture = new FixtureSource();
let first: Awaited<ReturnType<AuthService['register']>>;
let second: typeof first;
let server: Server;
let base: string;

before(async () => {
  await authStore.initialize();
  await jobs.initialize();
  await savedJobs.initialize();
  await jobs.ingest(fixture);
  first = await auth.register({ name: 'First User', email: 'first@example.com', password: 'a test passphrase' });
  second = await auth.register({ name: 'Second User', email: 'second@example.com', password: 'a test passphrase' });
  await authStore.users.updateOne({ _id: second.user.id }, { $set: { roles: ['ADMIN'] } });
  server = createApp(async () => { await db.command({ ping: 1 }); }, {
    service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false,
  }, undefined, undefined, { store: jobs, sources: [fixture] }, savedJobs).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await client.close();
});
function request(token: string, path = '', method = 'GET', body?: unknown) {
  return fetch(base + '/saved-jobs' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
let id: string;
let revision: string;
test('saved jobs require authentication and repeat/concurrent saves create one entry', async () => {
  assert.equal((await request('')).status, 401);
  id = (await jobs.jobs.findOne({ source: 'fixture' }))!._id;
  assert.equal((await (await request(first.accessToken, '/' + id)).json()).savedJob, null);
  const results = await Promise.all([1, 2, 3].map(() => request(first.accessToken, '/' + id, 'PUT')));
  assert.ok(results.every(result => result.status === 200));
  const result = await (await request(first.accessToken)).json();
  assert.equal(result.total, 1); assert.equal(result.savedJobs[0].status, 'SAVED'); assert.equal(result.savedJobs[0].priority, 'MEDIUM');
  assert.equal('ownerId' in result.savedJobs[0], false); revision = result.savedJobs[0].revision;
});
test('notes, status and priority persist, survive repeat saves, and stale updates conflict', async () => {
  const updated = await request(first.accessToken, '/' + id, 'PATCH', { revision, notes: 'Review the role', status: 'INTERESTED', priority: 'HIGH' });
  assert.equal(updated.status, 200);
  const oldRevision = revision; revision = (await updated.json()).savedJob.revision;
  assert.equal((await request(first.accessToken, '/' + id, 'PATCH', { revision: oldRevision, notes: 'Stale' })).status, 409);
  const again = (await (await request(first.accessToken, '/' + id, 'PUT')).json()).savedJob;
  assert.equal(again.notes, 'Review the role'); assert.equal(again.status, 'INTERESTED'); assert.equal(again.revision, revision);
  assert.equal((await (await request(first.accessToken, '?status=INTERESTED&priority=HIGH&limit=1')).json()).total, 1);
  assert.equal((await (await request(first.accessToken, '?status=NOT_INTERESTED')).json()).total, 0);
  assert.equal((await request(first.accessToken, '/' + id, 'PATCH', { revision, ownerId: second.user.id })).status, 400);
});
test('another user including ADMIN cannot read, change or remove private saved entries', async () => {
  assert.equal((await (await request(second.accessToken, `?ownerId=${first.user.id}`)).json()).total, 0);
  assert.equal((await (await request(second.accessToken, '/' + id)).json()).savedJob, null);
  assert.equal((await request(second.accessToken, '/' + id, 'PATCH', { revision, notes: 'Intrusion' })).status, 409);
  assert.equal((await request(second.accessToken, '/' + id, 'DELETE')).status, 204);
  assert.equal((await (await request(first.accessToken, '/' + id)).json()).savedJob.notes, 'Review the role');
  assert.equal((await request(second.accessToken, '/' + id, 'PUT')).status, 200);
  assert.equal((await (await request(second.accessToken, '/' + id)).json()).savedJob.notes, '');
});
test('feed updates show current job data without changing notes; missing jobs retain a snapshot', async () => {
  const job = (await jobs.jobs.findOne({ _id: id }))!;
  await jobs.jobs.updateOne({ _id: id }, { $set: { title: 'Updated source title', expiresAt: new Date('2020-01-01') } });
  const updated = (await (await request(first.accessToken)).json()).savedJobs[0];
  assert.equal(updated.job.title, 'Updated source title'); assert.equal(updated.notes, 'Review the role');
  await jobs.jobs.deleteOne({ _id: id });
  const missing = (await (await request(first.accessToken)).json()).savedJobs[0];
  assert.equal(missing.available, false); assert.equal(missing.job.title, job.title); assert.equal(missing.notes, 'Review the role');
  await jobs.jobs.insertOne(job);
});
test('unsaving is idempotent, resaving resets metadata, and old revisions cannot edit a new save', async () => {
  assert.equal((await request(first.accessToken, '/' + id, 'DELETE')).status, 204);
  assert.equal((await request(first.accessToken, '/' + id, 'DELETE')).status, 204);
  assert.equal((await (await request(first.accessToken)).json()).total, 0);
  const fresh = (await (await request(first.accessToken, '/' + id, 'PUT')).json()).savedJob;
  assert.equal(fresh.notes, ''); assert.equal(fresh.status, 'SAVED'); assert.notEqual(fresh.revision, revision);
  assert.equal((await request(first.accessToken, '/' + id, 'PATCH', { revision, notes: 'Old draft' })).status, 409);
  assert.equal((await request(first.accessToken, '/' + 'f'.repeat(64), 'PUT')).status, 404);
  assert.equal((await request(first.accessToken, '/invalid', 'PUT')).status, 400);
});
