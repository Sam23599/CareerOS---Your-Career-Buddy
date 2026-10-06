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
import { JobStore } from '../src/jobs/store.js';
import { SavedJobStore, parseSavedPatch } from '../src/saved-jobs/store.js';
import { IntelligenceClient } from '../src/intelligence/client.js';
import { ResumeAnalysisService } from '../src/intelligence/service.js';
import { JobAnalysisService } from '../src/intelligence/job-service.js';
import { SavedJobRankingService } from '../src/intelligence/ranking-service.js';
import { type DraftRecord, type Source } from '../src/intelligence/drafts.js';
import { JobTextSource, type JobAnalysisRecord, type JobSource } from '../src/intelligence/jobs.js';
import { type MatchResult, type ProfileSkills } from '../src/intelligence/matching.js';
import { type RankingResponse } from '../src/intelligence/ranking.js';
import { ApiError } from '../src/errors.js';
import cvFixture from './fixtures/resume-draft.json' with { type: 'json' };
import jobFixture from './fixtures/job-analysis.json' with { type: 'json' };
import reportFixture from './fixtures/resume-review.json' with { type: 'json' };

if (!process.env.TEST_MONGODB_URI) throw new Error('Set TEST_MONGODB_URI to run integration tests.');
const mongo = new MongoClient(process.env.TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
const db = mongo.db(`careeros_ranking_test_${randomUUID().replaceAll('-', '')}`);
const store = new AuthStore(db), auth = new AuthService(store, new Tokens(randomBytes(32).toString('hex')));
const profiles = new ProfileStore(db), jobs = new JobStore(db), saved = new SavedJobStore(db);
let afterCompare: (() => Promise<void>) | undefined, comparisons = 0, active = 0, maximum = 0;
class RankingClient extends IntelligenceClient {
  cvs = new Map<string, DraftRecord>(); jds = new Map<string, JobAnalysisRecord>();
  constructor() { super({ url: 'http://test.local', token: 'a'.repeat(64) }); }
  override async draft(owner: string, source: Source, _signal?: AbortSignal, id?: string) {
    const cv = this.cvs.get(`${owner}:${id}`);
    if (!cv || cv.source.resumeId !== source.resumeId) throw new ApiError(404, 'ANALYSIS_NOT_FOUND', 'No saved CV.');
    return cv;
  }
  override async jobAnalysis(owner: string, source: JobSource) {
    const job = this.jds.get(`${owner}:${source.jobId}`);
    if (!job) throw new ApiError(404, 'JOB_ANALYSIS_NOT_FOUND', 'No saved analysis.');
    return job;
  }
  override async compare(_owner: string, cv: DraftRecord, jd: JobAnalysisRecord, profile: ProfileSkills | null, signal: AbortSignal) {
    comparisons++; active++; maximum = Math.max(maximum, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (afterCompare) { const hook = afterCompare; afterCompare = undefined; await hook(); }
      signal.throwIfAborted();
      const match = structuredClone(reportFixture.match) as MatchResult;
      match.source = { ...match.source, resume: cv.source, draftId: cv.id, draftVersion: cv.version,
        jobId: jd.source.jobId, jobHash: jd.source.sha256, jobAnalysisId: jd.id, jobAnalysisVersion: jd.version,
        profileVersion: profile?.version ?? null };
      if (profile?.skills.includes('TypeScript')) {
        match.score = 100; match.matchedWeight = 4;
        const gap = match.items.find(item => item.status === 'not_found')!;
        gap.status = 'matched'; gap.candidate = { source: 'profile', field: 'skills', value: 'TypeScript', evidence: [] };
      }
      return match;
    } finally { active--; }
  }
}
const client = new RankingClient();
let resumes: ResumeStore, directory: string, server: Server, base: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'careeros-ranking-')); resumes = new ResumeStore(db, new LocalResumeStorage(directory));
  await store.initialize(); await jobs.initialize(); await saved.initialize();
  server = createApp(async () => {}, { service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false }, profiles, resumes,
    { store: jobs, sources: [] }, saved, undefined, client).listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/intelligence/saved-jobs/rank`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await mongo.close(); await rm(directory, { recursive: true, force: true });
});
async function account() {
  const login = await auth.register({ name: 'Ranking Tester', email: `${randomUUID()}@example.com`, password: 'a ranking test passphrase' });
  const library = await resumes.upload(login.user.id, 'resume.pdf', Buffer.from('%PDF-1.4\nsynthetic\n%%EOF'));
  const source = await new ResumeAnalysisService(resumes, client).source(login.user.id, library.resumes[0].id);
  const cv = { ...structuredClone(cvFixture), id: randomUUID(), source: source.source } as DraftRecord;
  client.cvs.set(`${login.user.id}:${cv.id}`, cv);
  return { ...login, cv, input: { resumeId: cv.source.resumeId, draftId: cv.id, includeProfileSkills: false,
    usePreferences: true, filters: { status: '', priority: '' } } };
}
async function add(owner: string, analyzed = true) {
  const id = randomBytes(32).toString('hex');
  const fields = Object.fromEntries(jobFixture.source.sections.map(section => [section.id, section.text]));
  const document = { _id: id, source: 'fixture', sourceId: id, title: fields.title, company: fields.company, location: fields.location,
    description: fields.description, employmentType: 'UNKNOWN' as const, remoteType: 'REMOTE' as const, skills: [], sourceUrl: 'https://example.com/job',
    postedAt: null, expiresAt: null, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
  await jobs.jobs.insertOne(document); const record = await saved.save(owner, id);
  if (analyzed) client.jds.set(`${owner}:${id}`, { ...structuredClone(jobFixture), id: randomUUID(), source: JobTextSource.create({ ...document, id }) } as JobAnalysisRecord);
  return record;
}
const request = (token: string, body: unknown, query = '') => fetch(base + query, { method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('ranking enforces sessions, source ownership for ADMIN, strict inputs and private analysis visibility', async () => {
  const owner = await account(), other = await account(); const job = await add(owner.user.id);
  assert.equal((await request('', owner.input)).status, 401);
  await store.users.updateOne({ _id: other.user.id }, { $set: { roles: ['ADMIN'] } });
  assert.equal((await request(other.accessToken, owner.input)).status, 404);
  for (const body of [{ ...owner.input, owner: other.user.id }, { ...owner.input, draftId: 'bad' },
    { ...owner.input, filters: { status: '', priority: '', page: '2' } }]) assert.equal((await request(owner.accessToken, body)).status, 400);
  assert.equal((await request(owner.accessToken, owner.input, '?model=other')).status, 400);
  await saved.save(other.user.id, job.jobId);
  const response = await request(other.accessToken, other.input);
  assert.equal(response.status, 200); const result = await response.json() as RankingResponse;
  assert.equal(result.ranked.length, 0); assert.equal(result.unranked[0].reason, 'analysis_required');
  await auth.logout(other.refreshToken);
  assert.equal((await request(other.accessToken, other.input)).status, 401);
});
test('ranking separates missing, stale, expired, unavailable and uninterested jobs without generating analyses', async () => {
  const owner = await account(); const good = await add(owner.user.id), missing = await add(owner.user.id, false);
  const stale = await add(owner.user.id), expired = await add(owner.user.id), unavailable = await add(owner.user.id), ignored = await add(owner.user.id);
  await jobs.jobs.updateOne({ _id: stale.jobId }, { $set: { description: 'Changed listing' } });
  await jobs.jobs.updateOne({ _id: expired.jobId }, { $set: { expiresAt: new Date(0) } });
  await jobs.jobs.deleteOne({ _id: unavailable.jobId });
  await saved.update(owner.user.id, ignored.jobId, parseSavedPatch({ revision: ignored.revision, status: 'NOT_INTERESTED' }));
  const count = comparisons, response = await request(owner.accessToken, owner.input);
  assert.equal(response.status, 200); const result = await response.json() as RankingResponse;
  assert.equal(comparisons - count, 1); assert.equal(result.total, 6); assert.equal(result.ranked[0].jobId, good.jobId);
  const reasons = Object.fromEntries(result.unranked.map(job => [job.jobId, job.reason]));
  assert.deepEqual(reasons, { [missing.jobId]: 'analysis_required', [stale.jobId]: 'stale_analysis',
    [expired.jobId]: 'expired', [unavailable.jobId]: 'unavailable', [ignored.jobId]: 'not_interested' });
  assert.equal(result.ranked[0].score, 75); assert.equal(result.source.draftId, owner.cv.id);
});
test('ranking applies server profile skills/preferences, filters all pages and caps complete batches', async () => {
  const owner = await account();
  await profiles.update(owner.user, 0, { skills: ['TypeScript'], preferences: { ...(await profiles.get(owner.user)).preferences, workModes: ['REMOTE'] } });
  const high = await add(owner.user.id); await saved.update(owner.user.id, high.jobId, parseSavedPatch({ revision: high.revision, priority: 'HIGH' }));
  await add(owner.user.id);
  const response = await request(owner.accessToken, { ...owner.input, includeProfileSkills: true, filters: { status: '', priority: 'HIGH' } });
  assert.equal(response.status, 200); const result = await response.json() as RankingResponse;
  assert.equal(result.total, 1); assert.equal(result.source.profileVersion, 1); assert.equal(result.ranked[0].score, 100);
  assert.deepEqual(result.ranked[0].profileOnlySkills, ['TypeScript']); assert.equal(result.ranked[0].preferenceMatches, 1);
  for (let i = 0; i < 49; i++) await add(owner.user.id, false);
  const count = comparisons;
  assert.equal((await request(owner.accessToken, owner.input)).status, 413); assert.equal(comparisons, count);
});
test('ranking rejects notes, preference, description and resume changes made during comparison', async () => {
  for (const kind of ['notes', 'profile', 'description', 'resume']) {
    const owner = await account(), job = await add(owner.user.id);
    afterCompare = async () => {
      if (kind === 'notes') await saved.update(owner.user.id, job.jobId, parseSavedPatch({ revision: job.revision, notes: 'Changed' }));
      if (kind === 'profile') await profiles.update(owner.user, 0, { skills: ['Python'] });
      if (kind === 'description') await jobs.jobs.updateOne({ _id: job.jobId }, { $set: { description: 'Changed while ranking' } });
      if (kind === 'resume') await resumes.remove(owner.user.id, owner.cv.source.resumeId);
    };
    assert.equal((await request(owner.accessToken, owner.input)).status, kind === 'resume' ? 404 : 409, kind);
  }
});
test('ranking includes jobs beyond the ordinary first page and rejects operational failures without partial results', async () => {
  const owner = await account(), oldest = await add(owner.user.id);
  for (let i = 0; i < 20; i++) await add(owner.user.id, false);
  const response = await request(owner.accessToken, owner.input);
  assert.equal(response.status, 200); const result = await response.json() as RankingResponse;
  assert.equal(result.total, 21); assert.equal(result.ranked[0].jobId, oldest.jobId); assert.equal(result.unranked.length, 20);
  afterCompare = async () => { throw new ApiError(503, 'INTELLIGENCE_UNAVAILABLE', 'Comparison temporarily unavailable.'); };
  const failed = await request(owner.accessToken, owner.input);
  assert.equal(failed.status, 503); assert.equal((await failed.json()).ranked, undefined);
});
test('ranking bounds concurrency and stops queued jobs on cancellation', async () => {
  const owner = await account(); for (let i = 0; i < 9; i++) await add(owner.user.id);
  maximum = 0;
  const response = await request(owner.accessToken, owner.input);
  assert.equal(response.status, 200); assert.equal((await response.json()).ranked.length, 9); assert.equal(maximum, 4);
  const cancellation = new AbortController(), count = comparisons;
  afterCompare = async () => { cancellation.abort(); };
  const service = new SavedJobRankingService(saved, new ResumeAnalysisService(resumes, client), new JobAnalysisService(jobs, client), client, profiles);
  await assert.rejects(service.rank(owner.user, owner.input, cancellation.signal));
  assert.ok(comparisons - count <= 4);
});
test('ranking throttles independently of paid analysis with a safe retry hint', async () => {
  const owner = await account();
  for (let i = 0; i < 10; i++) assert.equal((await request(owner.accessToken, owner.input)).status, 200);
  const response = await request(owner.accessToken, owner.input);
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '900');
});
