import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { createApp } from '../src/app.js';
import { AuthStore } from '../src/auth/store.js';
import { AuthService } from '../src/auth/service.js';
import { Tokens } from '../src/auth/tokens.js';
import { ProfileStore } from '../src/profiles/store.js';
import { ResumeStore } from '../src/resumes/store.js';
import { LocalResumeStorage } from '../src/resumes/storage.js';
import { IntelligenceClient } from '../src/intelligence/client.js';
import { AnalysisCleanup } from '../src/intelligence/cleanup.js';
import { ApiError } from '../src/errors.js';
import { type DraftRecord, type Source } from '../src/intelligence/drafts.js';
import fixture from './fixtures/resume-draft.json' with { type: 'json' };

if (!process.env.TEST_MONGODB_URI) throw new Error('Set TEST_MONGODB_URI to run integration tests.');
const mongo = new MongoClient(process.env.TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
const db = mongo.db(`careeros_drafts_test_${randomUUID().replaceAll('-', '')}`);
const authStore = new AuthStore(db);
const auth = new AuthService(authStore, new Tokens(randomBytes(32).toString('hex')));
const profiles = new ProfileStore(db);
const pdf = Buffer.from('%PDF-1.4\nsynthetic fixture\n%%EOF');
let calls = 0;
let cleanupUnavailable = false;
let beforeReply: (() => Promise<void>) | undefined;
class DraftClient extends IntelligenceClient {
  records = new Map<string, DraftRecord>();
  history = new Map<string, DraftRecord>();
  constructor() { super({ url: 'http://test.local', token: 'ab'.repeat(32) }); }
  override async analyze(owner: string, source: Source, _data: Buffer, options: { model: string; reasoning: string | null }) {
    calls++;
    const version = (this.records.get(`${owner}:${source.resumeId}`)?.version ?? 0) + 1;
    const record = { ...structuredClone(fixture), id: randomUUID(), version, source, ...options } as DraftRecord;
    this.records.set(`${owner}:${source.resumeId}`, record);
    this.history.set(`${owner}:${record.id}`, record);
    if (beforeReply) await beforeReply();
    return record;
  }
  override async draft(owner: string, source: Source, _signal?: AbortSignal, analysisId?: string) {
    const record = analysisId ? this.history.get(`${owner}:${analysisId}`) : this.records.get(`${owner}:${source.resumeId}`);
    if (!record || JSON.stringify(record.source) !== JSON.stringify(source)) throw new ApiError(404, 'ANALYSIS_NOT_FOUND', 'No saved draft.');
    return record;
  }
  override async deleteDrafts(owner: string, resumeId: string) {
    if (cleanupUnavailable) throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Unavailable');
    this.records.delete(`${owner}:${resumeId}`);
    for (const [key, record] of this.history) if (key.startsWith(`${owner}:`) && record.source.resumeId === resumeId) this.history.delete(key);
  }
  override async draftHistory(owner: string, source: Source, beforeVersion?: number) {
    const records = [...this.history].filter(([key, record]) => key.startsWith(`${owner}:`)
      && JSON.stringify(record.source) === JSON.stringify(source) && (beforeVersion === undefined || record.version < beforeVersion))
      .map(([, record]) => record).sort((a, b) => b.version - a.version);
    const versions = records.slice(0, 20).map(({ id, version, model, reasoning, createdAt }) => ({ id, version, model, reasoning, createdAt }));
    return { versions, nextBeforeVersion: records.length > 20 ? versions.at(-1)!.version : null };
  }
}
const intelligence = new DraftClient();
const cleanup = new AnalysisCleanup(db, intelligence);
let directory: string; let resumes: ResumeStore; let server: Server; let base: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'careeros-drafts-'));
  resumes = new ResumeStore(db, new LocalResumeStorage(directory), cleanup);
  await authStore.initialize();
  server = createApp(async () => {}, { service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false }, profiles, resumes, undefined, undefined, undefined, intelligence).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/intelligence/resumes`;
});
after(async () => {
  await cleanup.stop();
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await mongo.close(); await rm(directory, { recursive: true, force: true });
});
async function account() {
  const login = await auth.register({ name: 'Draft Tester', email: `${randomUUID()}@example.com`, password: 'a draft testing passphrase' });
  const library = await resumes.upload(login.user.id, 'resume.pdf', pdf);
  return { ...login, id: library.resumes[0].id };
}
function request(token: string, id: string, suffix: string, body?: unknown) {
  return fetch(`${base}/${id}/${suffix}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const options = { model: 'gpt-6-luna', reasoning: 'medium' };

test('analysis checks owner and allowed input before calling intelligence, including ADMIN', async () => {
  const owner = await account(); const other = await account(); const initial = calls;
  await authStore.users.updateOne({ _id: other.user.id }, { $set: { roles: ['ADMIN'] } });
  assert.equal((await request('', owner.id, 'analyze', options)).status, 401);
  assert.equal((await request(other.accessToken, owner.id, 'analyze', options)).status, 404);
  for (const body of [{ ...options, owner: owner.user.id }, { ...options, url: 'https://private.test' }, { model: 'gpt-4.1', reasoning: 'high' }]) {
    assert.equal((await request(owner.accessToken, owner.id, 'analyze', body)).status, 400);
  }
  assert.equal(calls, initial);
});

test('generated draft leaves profile untouched until selected edits are explicitly applied with CAS', async () => {
  const owner = await account();
  const response = await request(owner.accessToken, owner.id, 'analyze', options);
  assert.equal(response.status, 200);
  const record = await response.json();
  assert.equal((await profiles.get(owner.user)).version, 0);
  assert.equal((await request(owner.accessToken, owner.id, 'draft')).status, 200);
  const apply = { analysisId: record.id, patch: { version: 0, headline: 'Reviewed engineer', skills: ['Python'] } };
  const saved = await request(owner.accessToken, owner.id, 'draft/apply', apply);
  assert.equal(saved.status, 200);
  const profile = (await saved.json()).profile;
  assert.equal(profile.headline, 'Reviewed engineer'); assert.equal(profile.fullName, 'Draft Tester');
  assert.equal(profile.version, 1);
  const stale = await request(owner.accessToken, owner.id, 'draft/apply', apply);
  assert.equal(stale.status, 409); assert.equal((await stale.json()).error.code, 'PROFILE_CONFLICT');
});

test('apply requires an owned current draft and rejects unsupported fields', async () => {
  const owner = await account(); const other = await account();
  const record = await (await request(owner.accessToken, owner.id, 'analyze', options)).json();
  const apply = { analysisId: record.id, patch: { version: 0, headline: 'Approved' } };
  assert.equal((await request(other.accessToken, owner.id, 'draft')).status, 404);
  assert.equal((await request(other.accessToken, owner.id, 'draft/apply', apply)).status, 404);
  assert.equal((await request(owner.accessToken, owner.id, 'draft/apply', { ...apply, analysisId: randomUUID() })).status, 409);
  assert.equal((await request(owner.accessToken, owner.id, 'draft/apply', { analysisId: record.id, patch: { version: 0, preferences: {} } })).status, 400);
  assert.equal((await request(owner.accessToken, owner.id, 'draft/apply', { analysisId: record.id, patch: { version: 0, projects: [] } })).status, 400);
});

test('source deletion during generation suppresses the result', async () => {
  const owner = await account();
  beforeReply = async () => { await resumes.remove(owner.user.id, owner.id); };
  try { assert.equal((await request(owner.accessToken, owner.id, 'analyze', options)).status, 404); }
  finally { beforeReply = undefined; }
  assert.equal((await request(owner.accessToken, owner.id, 'draft')).status, 404);
  await cleanup.flush();
});

test('deleting a resume queues durable cleanup during outage and retries after restart', async () => {
  const owner = await account();
  await request(owner.accessToken, owner.id, 'analyze', options);
  cleanupUnavailable = true;
  try {
    await resumes.remove(owner.user.id, owner.id); await cleanup.flush();
    assert.equal((await request(owner.accessToken, owner.id, 'draft')).status, 404);
    assert.equal(await db.collection('intelligence_cleanup').countDocuments({ owner: owner.user.id }), 1);
  } finally { cleanupUnavailable = false; }
  const restarted = new AnalysisCleanup(db, intelligence);
  await restarted.flush(); await restarted.stop();
  assert.equal(await db.collection('intelligence_cleanup').countDocuments(), 0);
  assert.equal(intelligence.records.has(`${owner.user.id}:${owner.id}`), false);
});

test('an earlier reviewed model draft remains importable after another model creates a newer draft', async () => {
  const owner = await account();
  const earlier = await (await request(owner.accessToken, owner.id, 'analyze', options)).json();
  const newer = await (await request(owner.accessToken, owner.id, 'analyze', { model: 'gpt-4.1', reasoning: null })).json();
  assert.notEqual(earlier.id, newer.id);
  assert.equal((await (await request(owner.accessToken, owner.id, 'draft')).json()).id, newer.id);
  const applied = await request(owner.accessToken, owner.id, 'draft/apply', {
    analysisId: earlier.id, patch: { version: 0, headline: 'Reviewed earlier draft' },
  });
  assert.equal(applied.status, 200);
  assert.equal((await applied.json()).profile.headline, 'Reviewed earlier draft');
});

test('repeated analysis saves versions and history/old version reads are owned, validated and provider-free', async () => {
  const owner = await account(); const other = await account();
  const empty = await (await request(owner.accessToken, owner.id, 'drafts')).json();
  assert.deepEqual(empty, { versions: [], nextBeforeVersion: null });
  const first = await (await request(owner.accessToken, owner.id, 'analyze', options)).json();
  const second = await (await request(owner.accessToken, owner.id, 'analyze', options)).json();
  assert.deepEqual([first.version, second.version], [1, 2]); assert.notEqual(first.id, second.id);
  const generated = calls;
  const history = await (await request(owner.accessToken, owner.id, 'drafts')).json();
  assert.deepEqual(history.versions.map((item: { version: number }) => item.version), [2, 1]);
  assert.deepEqual(Object.keys(history.versions[0]).sort(), ['createdAt', 'id', 'model', 'reasoning', 'version']);
  assert.equal((await (await request(owner.accessToken, owner.id, `draft?analysisId=${first.id}`)).json()).id, first.id);
  assert.equal((await (await request(owner.accessToken, owner.id, 'draft')).json()).id, second.id);
  assert.deepEqual((await (await request(owner.accessToken, owner.id, 'drafts?beforeVersion=2')).json()).versions.map((item: { version: number }) => item.version), [1]);
  assert.equal((await request(other.accessToken, owner.id, 'drafts')).status, 404);
  assert.equal((await request(other.accessToken, other.id, `draft?analysisId=${first.id}`)).status, 404);
  for (const suffix of ['draft?analysisId=bad', `draft?analysisId=${first.id}&analysisId=${second.id}`, 'draft?owner=foreign',
    'drafts?beforeVersion=0', 'drafts?beforeVersion=-1', 'drafts?beforeVersion=1.5', 'drafts?beforeVersion=2147483648',
    'drafts?beforeVersion=2&beforeVersion=1', 'drafts?owner=foreign']) {
    assert.equal((await request(owner.accessToken, owner.id, suffix)).status, 400, suffix);
  }
  assert.equal(calls, generated);
  await resumes.remove(owner.user.id, owner.id); await cleanup.flush();
  assert.equal((await request(owner.accessToken, owner.id, 'drafts')).status, 404);
  assert.equal([...intelligence.history].some(([key, item]) => key.startsWith(`${owner.user.id}:`) && item.source.resumeId === owner.id), false);
});
