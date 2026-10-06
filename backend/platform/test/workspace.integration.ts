import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { MongoClient } from 'mongodb';
import { createApp } from '../src/app.js';
import { AuthStore } from '../src/auth/store.js';
import { AuthService } from '../src/auth/service.js';
import { Tokens } from '../src/auth/tokens.js';
import { ResumeStore } from '../src/resumes/store.js';
import { RecoveryStore } from '../src/recovery/store.js';
import { SavedJobStore, parseSavedPatch, parseSavedQuery } from '../src/saved-jobs/store.js';
import { JobStore } from '../src/jobs/store.js';
import { CareerSourceStore, parseSource } from '../src/career-sources/store.js';
import { NotificationStore, NotificationService } from '../src/notifications/store.js';

const client = new MongoClient(process.env.TEST_MONGODB_URI!);
const db = client.db(`careeros_workspace_test_${randomUUID().replaceAll('-', '')}`);
const auth = new AuthService(new AuthStore(db), new Tokens(randomBytes(32).toString('hex')));
const bytes = new Map<string, Buffer>();
const resumes = new ResumeStore(db, { put: async (id, value) => { bytes.set(id, value); }, get: async id => bytes.get(id)!, remove: async () => { throw new Error('Do not erase retained files'); } });
const recovery = new RecoveryStore(db), saved = new SavedJobStore(db), jobs = new JobStore(db), sources = new CareerSourceStore(db, jobs, new NotificationService(new NotificationStore(db)));
let owner: Awaited<ReturnType<AuthService['register']>>, other: typeof owner;
let base: string;
const app = createApp(async () => {}, { service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false }, undefined, resumes, { store: jobs, sources: [] }, saved, { careerSources: sources, notifications: new NotificationStore(db) }, undefined, undefined, recovery);
const server = app.listen(0, '127.0.0.1');
before(async () => {
  await once(server, 'listening'); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  await auth.store.initialize();
  owner = await auth.register({ name: 'Owner', email: 'owner@example.com', password: 'test password' });
  other = await auth.register({ name: 'Support', email: 'support@example.com', password: 'test password' });
});
after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await db.dropDatabase(); await client.close(); });
function request(path: string, token = owner.accessToken, method = 'GET', body?: unknown) { return fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }

test('bin retains PDF bytes, isolates owners and requires audited support for expired recovery', async () => {
  const pdf = Buffer.from('%PDF-1.4\nretained bytes\n%%EOF');
  const library = await resumes.upload(owner.user.id, 'retained.pdf', pdf), id = library.resumes[0].id;
  await resumes.remove(owner.user.id, id);
  assert.deepEqual((await resumes.list(owner.user.id)).resumes, []);
  assert.deepEqual(bytes.get(id), pdf);
  assert.equal((await recovery.list(owner.user.id)).items.length, 1);
  assert.equal((await recovery.list(other.user.id)).items.length, 0);
  assert.equal((await request(`/recycle-bin/resume/${id}/restore`, other.accessToken, 'POST', {})).status, 404);
  await db.collection<{ _id: string }>('resume_libraries').updateOne({ _id: owner.user.id }, { $set: { 'items.0.trash.expiresAt': new Date(0) } });
  assert.equal((await recovery.list(owner.user.id)).items.length, 0);
  assert.equal((await request(`/recycle-bin/resume/${id}/restore`, owner.accessToken, 'POST', {})).status, 404);
  assert.equal((await request(`/recycle-bin/support/${owner.user.id}`, other.accessToken)).status, 403);
  await auth.store.users.updateOne({ _id: other.user.id }, { $set: { roles: ['ADMIN'] } });
  assert.equal((await request(`/recycle-bin/support/${owner.user.id}/resume/${id}/restore`, other.accessToken, 'POST', {})).status, 200);
  assert.deepEqual((await resumes.download(owner.user.id, id)).data, pdf);
  assert.equal(await db.collection('support_recovery_audit').countDocuments({ actor: other.user.id, owner: owner.user.id }), 1);
});

test('single job filters match populated metadata and manual progress remains separate from interest', async () => {
  await jobs.ingest({ id: 'test-source', name: 'Test', cooldownMs: 0, fetchJobs: async () => [{ sourceId: '1', title: 'Engineer', company: 'Example', location: 'India', description: 'Full-time role. Fully remote. TypeScript required.', employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', skills: [], sourceUrl: 'https://example.com/jobs/1', postedAt: new Date('2026-10-01'), expiresAt: null, metadata: {} }] });
  for (const query of ['skill=TypeScript', 'remoteType=REMOTE', 'employmentType=FULL_TIME', 'location=India', 'company=Example', 'source=test-source']) assert.equal((await (await request('/jobs?' + query)).json()).total, 1, query);
  const job = (await jobs.jobs.findOne({ source: 'test-source' }))!;
  let item = await saved.save(owner.user.id, job._id);
  item = await saved.update(owner.user.id, job._id, parseSavedPatch({ revision: item.revision, applicationStatus: 'INTERVIEWING' }));
  assert.equal(item.status, 'SAVED'); assert.equal(item.applicationEvents.length, 1);
  item = await saved.update(owner.user.id, job._id, parseSavedPatch({ revision: item.revision, applicationStatus: 'INTERVIEWING', notes: 'Updated notes' }));
  assert.equal(item.applicationEvents.length, 1);
  assert.equal((await saved.list(owner.user.id, parseSavedQuery({ location: 'India', postedFrom: '2026-10-01', postedTo: '2026-10-01', companyHistory: 'previously_applied', applicationStatus: 'INTERVIEWING' }))).total, 1);
  await saved.remove(owner.user.id, job._id); assert.equal(await saved.get(owner.user.id, job._id), null);
  const removed = (await recovery.list(owner.user.id)).items.find(item => item.kind === 'saved-job')!;
  const fresh = await saved.save(owner.user.id, job._id);
  assert.equal(fresh.notes, ''); assert.equal(fresh.applicationStatus, 'NOT_APPLIED');
  assert.equal((await request(`/recycle-bin/saved-job/${removed.id}/restore`, owner.accessToken, 'POST', {})).status, 409);
  assert.equal((await saved.get(owner.user.id, job._id))?.notes, '');
  await saved.remove(owner.user.id, job._id);
  await recovery.restore(owner.user.id, owner.user.id, 'saved-job', removed.id);
  assert.equal((await saved.get(owner.user.id, job._id))?.notes, 'Updated notes');
});

test('new feed groups use first discovery rather than every import, and removed sources restore', async () => {
  const source = await sources.create(owner.user.id, parseSource({ kind: 'job-source', company: 'Example', careerUrl: 'https://boards.greenhouse.io/example', keywords: [], locations: [], scanHours: 0, enabled: true }));
  const job = (await jobs.jobs.findOne({ source: 'test-source' }))!;
  await jobs.jobs.updateOne({ _id: job._id }, { $set: { source: 'greenhouse:example', createdAt: new Date(Date.now() - 60_000) } });
  const first = await sources.matchingJobs(owner.user.id, source.id, {}); assert.equal(first.newTotal, 1);
  await sources.viewed(owner.user.id, source.id, { visitedAt: first.visitedAt });
  await jobs.jobs.updateOne({ _id: job._id }, { $set: { updatedAt: new Date() } });
  assert.equal((await sources.matchingJobs(owner.user.id, source.id, {})).newTotal, 0);
  assert.equal((await sources.matchingJobs(owner.user.id, source.id, { since: first.since })).newTotal, 1);
  assert.equal((await sources.matchingJobs(owner.user.id, source.id, { q: 'missing' })).total, 0);
  await sources.remove(owner.user.id, source.id); await assert.rejects(sources.matchingJobs(owner.user.id, source.id, {}));
  const fresh = await sources.create(owner.user.id, parseSource({ kind: 'job-source', company: 'New copy', careerUrl: 'https://boards.greenhouse.io/example', keywords: [], locations: [], scanHours: 0, enabled: true }));
  assert.equal((await request(`/recycle-bin/career-source/${source.id}/restore`, owner.accessToken, 'POST', {})).status, 409);
  await sources.remove(owner.user.id, fresh.id);
  await recovery.restore(owner.user.id, owner.user.id, 'career-source', source.id);
  assert.equal((await sources.matchingJobs(owner.user.id, source.id, {})).total, 1);
});
