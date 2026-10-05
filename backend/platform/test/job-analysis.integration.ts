import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
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
import { ProfileStore } from '../src/profiles/store.js';
import { ApiError } from '../src/errors.js';
import { IntelligenceClient } from '../src/intelligence/client.js';
import { JobAnalysisCleanup } from '../src/intelligence/job-cleanup.js';
import { JobAnalysisVerifier, type JobSource, type JobAnalysisRecord } from '../src/intelligence/jobs.js';
import fixture from './fixtures/job-analysis.json' with { type: 'json' };

if (!process.env.TEST_MONGODB_URI) throw new Error('Set TEST_MONGODB_URI to run integration tests.');
const mongo = new MongoClient(process.env.TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
const db = mongo.db(`careeros_job_analysis_test_${randomUUID().replaceAll('-', '')}`);
const authStore = new AuthStore(db), auth = new AuthService(authStore, new Tokens(randomBytes(32).toString('hex')));
const jobs = new JobStore(db), profiles = new ProfileStore(db);
let calls = 0, cleanupUnavailable = false;
let beforeReply: (() => Promise<void>) | undefined;
let waitForAbort: { started: () => void; stopped: () => void } | undefined;
class JobClient extends IntelligenceClient {
  records = new Map<string, JobAnalysisRecord>();
  constructor() { super({ url: 'http://test.local', token: 'ab'.repeat(32) }); }
  override async analyzeJob(owner: string, source: JobSource, options: { model: string; reasoning: string | null }, signal: AbortSignal) {
    calls++;
    if (waitForAbort) {
      const waiting = waitForAbort; waiting.started();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { waiting.stopped(); reject(signal.reason); }, { once: true }));
    }
    const previous = [...this.records].filter(([key, item]) => key.startsWith(`${owner}:`) && item.source.jobId === source.jobId);
    const version = Math.max(0, ...previous.map(([, item]) => item.version)) + 1;
    const record = JobAnalysisVerifier.record({ ...structuredClone(fixture), source, id: randomUUID(), version, ...options }, source.jobId, source.sha256);
    this.records.set(`${owner}:${record.id}`, record);
    if (beforeReply) await beforeReply();
    return record;
  }
  override async jobAnalysis(owner: string, source: JobSource, analysisId?: string) {
    const items = [...this.records].filter(([key, item]) => key.startsWith(`${owner}:`) && item.source.jobId === source.jobId && (!analysisId || item.id === analysisId))
      .map(([, item]) => item).sort((a, b) => Number(b.source.sha256 === source.sha256) - Number(a.source.sha256 === source.sha256) || b.version - a.version);
    if (!items.length) throw new ApiError(404, 'JOB_ANALYSIS_NOT_FOUND', 'No saved analysis.');
    return items[0];
  }
  override async jobHistory(owner: string, source: JobSource, beforeVersion?: number) {
    const items = [...this.records].filter(([key, item]) => key.startsWith(`${owner}:`) && item.source.jobId === source.jobId && (beforeVersion === undefined || item.version < beforeVersion))
      .map(([, item]) => item).sort((a, b) => b.version - a.version);
    return { versions: items.slice(0, 20).map(({ id, version, model, reasoning, createdAt, source }) => ({ id, version, model, reasoning, createdAt, sourceHash: source.sha256 })), nextBeforeVersion: items.length > 20 ? items[19].version : null };
  }
  override async deleteJobAnalyses(owner: string, jobId: string) {
    if (cleanupUnavailable) throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Unavailable');
    for (const [key, item] of this.records) if (key.startsWith(`${owner}:`) && item.source.jobId === jobId) this.records.delete(key);
  }
}
const intelligence = new JobClient(), cleanup = new JobAnalysisCleanup(db, jobs, intelligence);
let server: Server; let base: string;
before(async () => {
  await authStore.initialize(); await jobs.initialize();
  server = createApp(async () => {}, { service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false }, profiles,
    undefined, { store: jobs, sources: [] }, undefined, undefined, intelligence, cleanup).listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/intelligence/jobs`;
});
after(async () => {
  await cleanup.stop();
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await mongo.close();
});
async function account() {
  const login = await auth.register({ name: 'Job Tester', email: `${randomUUID()}@example.com`, password: 'a job testing passphrase' });
  const id = randomBytes(32).toString('hex');
  const fields = Object.fromEntries(fixture.source.sections.map(item => [item.id, item.text]));
  await jobs.jobs.insertOne({ _id: id, source: 'fixture', sourceId: id, title: fields.title, company: fields.company, location: fields.location, description: fields.description,
    employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', skills: [], sourceUrl: 'https://example.com/jobs/test', postedAt: null, expiresAt: null, metadata: {}, createdAt: new Date(), updatedAt: new Date() });
  return { ...login, id };
}
function request(token: string, id: string, suffix: string, body?: unknown, signal?: AbortSignal) {
  return fetch(`${base}/${id}/${suffix}`, { method: body === undefined ? 'GET' : 'POST', signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const options = { model: 'gpt-6-luna', reasoning: 'medium' };

test('job analysis checks authentication, ID and strict settings before provider work', async () => {
  const owner = await account(); const count = calls;
  assert.equal((await request('', owner.id, 'analyze', options)).status, 401);
  assert.equal((await request(owner.accessToken, randomUUID(), 'analyze', options)).status, 400);
  assert.equal((await request(owner.accessToken, 'b'.repeat(64), 'analyze', options)).status, 404);
  for (const input of [{ ...options, owner: owner.user.id }, { ...options, text: 'Injected' }, { ...options, url: 'https://private.test' }, { model: 'gpt-4.1', reasoning: 'high' }]) {
    assert.equal((await request(owner.accessToken, owner.id, 'analyze', input)).status, 400);
  }
  assert.equal(calls, count);
});

test('successful explicit clicks create private history without profile changes or read-side AI calls', async () => {
  const owner = await account(); const other = await account();
  const first = await (await request(owner.accessToken, owner.id, 'analyze', options)).json();
  const second = await (await request(owner.accessToken, owner.id, 'analyze', options)).json();
  assert.deepEqual([first.analysis.version, second.analysis.version], [1, 2]);
  assert.equal((await profiles.get(owner.user)).version, 0);
  const count = calls;
  assert.equal((await (await request(owner.accessToken, owner.id, 'analysis')).json()).analysis.id, second.analysis.id);
  assert.equal((await (await request(owner.accessToken, owner.id, `analysis?analysisId=${first.analysis.id}`)).json()).analysis.id, first.analysis.id);
  assert.deepEqual((await (await request(owner.accessToken, owner.id, 'analyses?beforeVersion=2')).json()).versions.map((item: { version: number }) => item.version), [1]);
  await authStore.users.updateOne({ _id: other.user.id }, { $set: { roles: ['ADMIN'] } });
  assert.equal((await request(other.accessToken, owner.id, `analysis?analysisId=${first.analysis.id}`)).status, 404);
  assert.deepEqual((await (await request(other.accessToken, owner.id, 'analyses')).json()).versions, []);
  assert.equal(calls, count);
});

test('identical ingestion keeps analysis current while content changes mark saved versions stale', async () => {
  const owner = await account();
  await request(owner.accessToken, owner.id, 'analyze', options);
  await jobs.jobs.updateOne({ _id: owner.id }, { $set: { updatedAt: new Date() } });
  assert.equal((await (await request(owner.accessToken, owner.id, 'analysis')).json()).sourceStatus.stale, false);
  await jobs.jobs.updateOne({ _id: owner.id }, { $set: { description: 'New role requires SQL.' } });
  const record = await (await request(owner.accessToken, owner.id, 'analysis')).json();
  assert.equal(record.sourceStatus.stale, true);
  assert.equal(record.analysis.analysis.skills[0].value, 'Python');
  assert.equal((await (await request(owner.accessToken, owner.id, 'analyses')).json()).versions[0].stale, true);
});

test('empty, oversized and expired listings do not generate; expiry keeps saved results readable', async () => {
  const owner = await account();
  await request(owner.accessToken, owner.id, 'analyze', options); const count = calls;
  await jobs.jobs.updateOne({ _id: owner.id }, { $set: { expiresAt: new Date(0) } });
  assert.equal((await request(owner.accessToken, owner.id, 'analyze', options)).status, 409);
  assert.equal((await (await request(owner.accessToken, owner.id, 'analysis')).json()).sourceStatus.expired, true);
  await jobs.jobs.updateOne({ _id: owner.id }, { $set: { expiresAt: null, description: '' } });
  assert.equal((await request(owner.accessToken, owner.id, 'analyze', options)).status, 422);
  await jobs.jobs.updateOne({ _id: owner.id }, { $set: { description: 'x'.repeat(60000) } });
  assert.equal((await request(owner.accessToken, owner.id, 'analyze', options)).status, 413);
  assert.equal(calls, count);
});

test('changed and removed sources during generation suppress the response', async () => {
  for (const removed of [false, true]) {
    const owner = await account();
    beforeReply = async () => { if (removed) await jobs.jobs.deleteOne({ _id: owner.id }); else await jobs.jobs.updateOne({ _id: owner.id }, { $set: { description: 'Changed listing' } }); };
    try { assert.equal((await request(owner.accessToken, owner.id, 'analyze', options)).status, removed ? 404 : 409); }
    finally { beforeReply = undefined; }
  }
  await cleanup.flush();
});

test('job cleanup references survive an outage and restart, and expiry is retained', async () => {
  const owner = await account(); await request(owner.accessToken, owner.id, 'analyze', options);
  await jobs.jobs.updateOne({ _id: owner.id }, { $set: { expiresAt: new Date(0) } });
  await cleanup.flush(); assert.equal(await db.collection('job_analysis_sources').countDocuments({ jobId: owner.id }), 1);
  await jobs.jobs.deleteOne({ _id: owner.id }); cleanupUnavailable = true;
  try { await cleanup.flush(); assert.equal(await db.collection('job_analysis_sources').countDocuments({ jobId: owner.id }), 1); }
  finally { cleanupUnavailable = false; }
  const restarted = new JobAnalysisCleanup(db, jobs, intelligence); await restarted.flush(); await restarted.stop();
  assert.equal(await db.collection('job_analysis_sources').countDocuments({ jobId: owner.id }), 0);
  assert.equal((await request(owner.accessToken, owner.id, 'analysis')).status, 404);
});

test('history query validation rejects arbitrary and repeated values', async () => {
  const owner = await account(); const count = calls;
  for (const suffix of ['analysis?analysisId=bad', 'analysis?owner=foreign', 'analyses?beforeVersion=0', 'analyses?beforeVersion=2147483648', 'analyses?beforeVersion=2&beforeVersion=1']) {
    assert.equal((await request(owner.accessToken, owner.id, suffix)).status, 400);
  }
  assert.equal(calls, count);
});

test('browser cancellation aborts upstream generation without saving a partial record', async () => {
  const owner = await account(); const controller = new AbortController();
  let started!: () => void; let stopped!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }); const cancelled = new Promise<void>(resolve => { stopped = resolve; });
  waitForAbort = { started, stopped };
  try {
    const pending = request(owner.accessToken, owner.id, 'analyze', options, controller.signal);
    await ready; controller.abort(); await assert.rejects(pending);
    await Promise.race([cancelled, new Promise((_, reject) => setTimeout(() => reject(new Error('Upstream did not cancel')), 2000))]);
    assert.equal([...intelligence.records.values()].some(item => item.source.jobId === owner.id), false);
  } finally { waitForAbort = undefined; }
});
