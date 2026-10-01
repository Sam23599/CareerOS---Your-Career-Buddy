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
import { JobStore } from '../src/jobs/store.js';
import { FixtureSource } from '../src/jobs/sources.js';
import { type JobInput, type JobSource } from '../src/jobs/model.js';


const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error('Set TEST_MONGODB_URI to run MongoDB integration tests.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const db = client.db(`careeros_jobs_test_${randomUUID().replaceAll('-', '')}`);
const authStore = new AuthStore(db);
const auth = new AuthService(authStore, new Tokens(randomBytes(32).toString('hex')));
const jobs = new JobStore(db);
const fixture = new FixtureSource();
let first: Awaited<ReturnType<AuthService['register']>>;
let second: typeof first;
let server: Server;
let base: string;

before(async () => {
  await authStore.initialize();
  await jobs.initialize();
  first = await auth.register({ name: 'First User', email: 'first@example.com', password: 'a test passphrase' });
  second = await auth.register({ name: 'Second User', email: 'second@example.com', password: 'a test passphrase' });
  await authStore.users.updateOne({ _id: second.user.id }, { $set: { roles: ['ADMIN'] } });
  server = createApp(async () => { await db.command({ ping: 1 }); }, {
    service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false,
  }, undefined, undefined, { store: jobs, sources: [fixture] }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await client.close();
});
function request(path = '', token = '', method = 'GET') { return fetch(base + '/jobs' + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} }); }
let id: string;
test('browsing is public but only ADMIN can ingest a configured source', async () => {
  assert.equal((await request()).status, 200);
  assert.equal((await request('/ingest/fixture', '', 'POST')).status, 401);
  assert.equal((await request('/ingest/fixture', first.accessToken, 'POST')).status, 403);
  assert.equal((await request('/ingest/unknown', second.accessToken, 'POST')).status, 404);
  assert.equal((await request('/ingest/fixture', second.accessToken, 'POST')).status, 200);
  const list = await (await request()).json(); assert.equal(list.total, 1); id = list.jobs[0].id;
  assert.equal((await (await request('/' + id)).json()).job.source, 'fixture');
});
test('reimport updates the existing identity without duplicates and retains creation time', async () => {
  const before = await jobs.get(id);
  const input = (await fixture.fetchJobs())[0];
  await jobs.ingest(new FixtureSource([{ ...input, title: 'Updated engineer' }]));
  const after = await jobs.get(id);
  assert.equal(after.title, 'Updated engineer'); assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
  assert.equal(await jobs.jobs.countDocuments(), 1);
});
test('failed or malformed fetches preserve previously stored jobs', async () => {
  const broken: JobSource = { id: 'fixture', name: 'Broken', cooldownMs: 0, fetchJobs: async () => { throw new Error('Network unavailable'); } };
  await assert.rejects(jobs.ingest(broken));
  assert.equal((await jobs.get(id)).title, 'Updated engineer');
  const malformed: JobSource = { ...broken, id: 'malformed', fetchJobs: async () => [{ ...(await fixture.fetchJobs())[0], company: '' }] };
  await assert.rejects(jobs.ingest(malformed)); assert.equal(await jobs.jobs.countDocuments(), 1);
});
test('literal search, filters, expiry and stable pagination reflect normalized data', async () => {
  const baseJob = (await fixture.fetchJobs())[0];
  const rows: JobInput[] = [
    { ...baseJob, sourceId: 'one', title: 'C++ Engineer', company: 'Acme', location: 'India', remoteType: 'HYBRID', skills: ['C++'], postedAt: new Date('2026-01-01') },
    { ...baseJob, sourceId: 'two', title: 'Designer', company: 'Design Co', location: 'UK', employmentType: 'PART_TIME', remoteType: 'ONSITE', postedAt: new Date('2026-02-01') },
    { ...baseJob, sourceId: 'expired', expiresAt: new Date('2020-01-01') },
  ];
  await jobs.ingest({ id: 'filters', name: 'Filter fixtures', cooldownMs: 0, fetchJobs: async () => rows });
  const query = await (await request('?q=C%2B%2B&location=india&company=acme&skill=C%2B%2B&remoteType=HYBRID&employmentType=FULL_TIME&source=filters')).json();
  assert.equal(query.total, 1); assert.equal(query.jobs[0].title, 'C++ Engineer');
  assert.equal((await (await request('?q=.*')).json()).total, 0);
  const page1 = await (await request('?limit=1')).json(), page2 = await (await request('?limit=1&page=2')).json();
  assert.equal(page1.total, 3); assert.notEqual(page1.jobs[0].id, page2.jobs[0].id);
  assert.equal((await request('?page=0')).status, 400); assert.equal((await request('/missing')).status, 404);
});
test('concurrent refreshes are blocked and source cooldown persists', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source: JobSource = { id: 'cooldown', name: 'Cooldown', cooldownMs: 60_000, fetchJobs: async () => { await gate; return []; } };
  const started = jobs.ingest(source);
  // Wait until the first caller has acquired its database-backed lease.
  for (let i = 0; i < 100; i++) { if (await db.collection<{ _id: string }>('job_ingestion_runs').findOne({ _id: 'cooldown' })) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  await assert.rejects(jobs.ingest(source), { status: 409 });
  release(); await started;
  await assert.rejects(new JobStore(db).ingest(source), { status: 409 });
});

test('four-hour scheduling adopts the shorter interval from a persisted six-hour cooldown', async () => {
  const source: JobSource = { id: 'interval-change', name: 'Interval change', cooldownMs: 4 * 60 * 60 * 1000, fetchJobs: async () => [] };
  const runs = db.collection<{ _id: string; status: string; startedAt: Date; nextAllowedAt: Date }>('job_ingestion_runs');
  await runs.insertOne({ _id: source.id, status: 'success', startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), nextAllowedAt: new Date(Date.now() + 60 * 60 * 1000) });
  assert.ok((await jobs.nextRefreshAt(source)).getTime() <= Date.now());
  await jobs.ingest(source);
  assert.ok((await jobs.nextRefreshAt(source)).getTime() > Date.now());
  await assert.rejects(jobs.ingest(source), { status: 409 });
});
