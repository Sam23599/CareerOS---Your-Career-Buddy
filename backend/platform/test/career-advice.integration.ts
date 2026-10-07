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
import { IntelligenceClient } from '../src/intelligence/client.js';
import { ResumeAnalysisService } from '../src/intelligence/service.js';
import { type DraftRecord, type Source } from '../src/intelligence/drafts.js';
import { type JobAnalysisRecord, type JobSource } from '../src/intelligence/jobs.js';
import { type ProfileSkills, type MatchResult } from '../src/intelligence/matching.js';
import { type PlanReview, type PreparationRecord, type PreparationInput } from '../src/intelligence/preparation.js';
import { type CadyInput, CadyVerifier } from '../src/intelligence/cady.js';
import { ApiError } from '../src/errors.js';
import cvFixture from './fixtures/resume-draft.json' with { type: 'json' };
import jobFixture from './fixtures/job-analysis.json' with { type: 'json' };
import matchFixture from './fixtures/matching.json' with { type: 'json' };
import planFixture from './fixtures/preparation.json' with { type: 'json' };
import cadyFixture from './fixtures/cady.json' with { type: 'json' };

if (!process.env.TEST_MONGODB_URI) throw new Error('Set TEST_MONGODB_URI for isolated tests.');
const mongo = new MongoClient(process.env.TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
const db = mongo.db(`careeros_advice_test_${randomUUID().replaceAll('-', '')}`), store = new AuthStore(db), auth = new AuthService(store, new Tokens(randomBytes(32).toString('hex')));
const profiles = new ProfileStore(db), jobs = new JobStore(db);
let afterAsk: (() => Promise<void>) | undefined;
const source = (cv: DraftRecord, jd: JobAnalysisRecord, profile: ProfileSkills | null) => ({ resume: cv.source, draftId: cv.id, draftVersion: cv.version,
  jobId: jd.source.jobId, jobHash: jd.source.sha256, jobAnalysisId: jd.id, jobAnalysisVersion: jd.version, profileVersion: profile?.version ?? null });
class AdviceClient extends IntelligenceClient {
  cvs = new Map<string, DraftRecord>(); jds = new Map<string, JobAnalysisRecord>(); plans = new Map<string, PreparationRecord>(); queued = 0; asked = 0;
  override async draft(owner: string, context: Source, _signal?: AbortSignal, id?: string) {
    const value = this.cvs.get(`${owner}:${id}`); if (!value || value.source.resumeId !== context.resumeId) throw new ApiError(404, 'ANALYSIS_NOT_FOUND', 'No CV.'); return value;
  }
  override async jobAnalysis(owner: string, _context: JobSource, id?: string) {
    const value = this.jds.get(`${owner}:${id}`); if (!value) throw new ApiError(404, 'JOB_ANALYSIS_NOT_FOUND', 'No analysis.'); return value;
  }
  override async compare(_owner: string, cv: DraftRecord, jd: JobAnalysisRecord, profile: ProfileSkills | null) { return { ...structuredClone(matchFixture), source: source(cv, jd, profile) } as MatchResult; }
  override async startPreparation(owner: string, _jobId: string, input: PreparationInput) {
    this.queued++;
    const cv = this.cvs.get(`${owner}:${input.context.draftId}`)!, jd = this.jds.get(`${owner}:${input.context.jobAnalysisId}`)!;
    const plan = { ...structuredClone(planFixture), id: randomUUID(), source: source(cv, jd, input.context.profile), goals: input.goals } as PreparationRecord;
    this.plans.set(`${owner}:${plan.id}`, plan); return { taskId: randomUUID() };
  }
  override async preparation(owner: string, jobId: string, planId: string) {
    const value = this.plans.get(`${owner}:${planId}`); if (!value || value.source.jobId !== jobId) throw new ApiError(404, 'PREPARATION_NOT_FOUND', 'No plan.'); return value;
  }
  override async preparationHistory(owner: string, jobId: string) {
    return { versions: [...this.plans.entries()].filter(([key, value]) => key.startsWith(`${owner}:`) && value.source.jobId === jobId).map(([, value]) => ({ id: value.id, version: value.version, source: value.source, model: value.model, reasoning: value.reasoning, createdAt: value.createdAt, reviewRevision: value.review.revision })), nextBeforeVersion: null };
  }
  override async reviewPreparation(owner: string, jobId: string, planId: string, review: PlanReview) {
    const record = await this.preparation(owner, jobId, planId);
    if (review.revision !== record.review.revision) throw new ApiError(409, 'PREPARATION_CHANGED', 'Reload before saving.');
    const result = { ...record, review: { ...review, revision: review.revision + 1 } }; this.plans.set(`${owner}:${planId}`, result); return result;
  }
  override async askCady(_owner: string, input: CadyInput, cv: DraftRecord, jds: JobAnalysisRecord[]) {
    this.asked++; if (afterAsk) await afterAsk();
    const result = { ...structuredClone(cadyFixture), resume: cv.source, draftId: cv.id, draftVersion: cv.version, sources: jds.map(jd => source(cv, jd, input.profile)), profileVersion: input.profile?.version ?? null, model: input.model, reasoning: input.reasoning };
    return CadyVerifier.result(result, cv, jds, input.profile, input);
  }
}
const client = new AdviceClient({});
let resumes: ResumeStore, directory: string, server: Server, base: string;
const previousToken = process.env.INTELLIGENCE_SERVICE_TOKEN;
before(async () => {
  process.env.INTELLIGENCE_SERVICE_TOKEN = 'b'.repeat(64);
  directory = await mkdtemp(join(tmpdir(), 'careeros-advice-')); resumes = new ResumeStore(db, new LocalResumeStorage(directory));
  await store.initialize(); await jobs.initialize();
  server = createApp(async () => {}, { service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false }, profiles, resumes,
    { store: jobs, sources: [] }, undefined, undefined, client).listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await mongo.close(); await rm(directory, { recursive: true, force: true });
  if (previousToken === undefined) delete process.env.INTELLIGENCE_SERVICE_TOKEN; else process.env.INTELLIGENCE_SERVICE_TOKEN = previousToken;
});
async function account() {
  const login = await auth.register({ name: 'Advice Tester', email: `${randomUUID()}@example.com`, password: 'an advice test passphrase' });
  const library = await resumes.upload(login.user.id, 'resume.pdf', Buffer.from('%PDF-1.4\nsynthetic\n%%EOF'));
  const context = await new ResumeAnalysisService(resumes, client).source(login.user.id, library.resumes[0].id);
  const cv = { ...structuredClone(cvFixture), id: randomUUID(), source: context.source } as DraftRecord;
  const id = randomBytes(32).toString('hex'), jd = { ...structuredClone(jobFixture), id: randomUUID(), source: { ...jobFixture.source, jobId: id } } as JobAnalysisRecord;
  const fields = Object.fromEntries(jd.source.sections.map(section => [section.id, section.text]));
  await jobs.jobs.insertOne({ _id: id, source: 'fixture', sourceId: id, title: fields.title, company: fields.company, location: fields.location, description: fields.description,
    employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', skills: [], sourceUrl: 'https://example.com/job', postedAt: null, expiresAt: null, metadata: {}, createdAt: new Date(), updatedAt: new Date() });
  client.cvs.set(`${login.user.id}:${cv.id}`, cv); client.jds.set(`${login.user.id}:${jd.id}`, jd);
  const selection = { resumeId: cv.source.resumeId, draftId: cv.id, jobAnalysisId: jd.id, includeProfileSkills: false };
  const prepare = { ...selection, profileVersion: null, goals: planFixture.goals, model: 'gpt-6-luna', reasoning: 'medium', requestKey: randomUUID() };
  const ask = { resumeId: cv.source.resumeId, draftId: cv.id, jobs: [{ jobId: id, jobAnalysisId: jd.id }], includeProfileSkills: false, question: 'How should I prepare?', history: [], model: 'gpt-6-luna', reasoning: 'medium' };
  return { ...login, id, cv, jd, prepare, ask };
}
async function request(token: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('advice authenticates and rejects foreign sources and caller-provided facts before AI', async () => {
  const owner = await account(), other = await account(), queued = client.queued, asked = client.asked;
  const path = `/api/v1/intelligence/jobs/${owner.id}/preparation-plans`;
  assert.equal((await request('', path, owner.prepare)).status, 401);
  assert.equal((await request(other.accessToken, path, owner.prepare)).status, 404);
  assert.equal((await request(owner.accessToken, path, { ...owner.prepare, owner: other.user.id })).status, 400);
  assert.equal((await request(owner.accessToken, '/api/v1/intelligence/cady/ask', { ...owner.ask, profile: { skills: ['Invented'] } })).status, 400);
  assert.equal((await request(other.accessToken, '/api/v1/intelligence/cady/ask', owner.ask)).status, 404);
  assert.equal(client.queued, queued); assert.equal(client.asked, asked);
});
test('owned plans read without AI, keep immutable output and reject conflicting review saves', async () => {
  const owner = await account(), path = `/api/v1/intelligence/jobs/${owner.id}/preparation-plans`;
  assert.equal((await request(owner.accessToken, path, owner.prepare)).status, 202);
  const history = await (await request(owner.accessToken, path)).json(), id = history.versions[0].id, count = client.queued;
  const original = await (await request(owner.accessToken, path + '/' + id)).json();
  assert.equal(original.record.source.draftId, owner.cv.id); assert.equal(client.queued, count);
  const review = { revision: 0, actions: [{ id: 'action-1', title: 'My own task', detail: 'Practice and review', status: 'done' }] };
  const updated = await (await request(owner.accessToken, path + '/' + id + '/review', review, 'PATCH')).json();
  assert.equal(updated.record.review.revision, 1); assert.deepEqual(updated.record.plan, original.record.plan); assert.equal(client.queued, count);
  assert.equal((await request(owner.accessToken, path + '/' + id + '/review', review, 'PATCH')).status, 409);
  await resumes.remove(owner.user.id, owner.cv.source.resumeId);
  assert.equal((await request(owner.accessToken, path + '/' + id)).status, 404);
  assert.equal((await (await request(owner.accessToken, path)).json()).versions.length, 0);
  assert.equal(client.plans.has(`${owner.user.id}:${id}`), true);
});
test('preparation rejects a changed profile revision before queuing and preserves its source on reads', async () => {
  const owner = await account(), path = `/api/v1/intelligence/jobs/${owner.id}/preparation-plans`;
  await profiles.update(owner.user, 0, { skills: ['Python'] });
  const input = { ...owner.prepare, includeProfileSkills: true, profileVersion: 1 }, count = client.queued;
  assert.equal((await request(owner.accessToken, path, { ...input, profileVersion: 0 })).status, 409);
  assert.equal(client.queued, count);
  assert.equal((await request(owner.accessToken, path, input)).status, 202);
  const history = await (await request(owner.accessToken, path)).json(), id = history.versions[0].id;
  const result = await (await request(owner.accessToken, path + '/' + id)).json();
  assert.equal(result.record.source.profileVersion, 1); assert.equal(result.match.source.profileVersion, null);
  await profiles.update(owner.user, 1, { skills: ['Python', 'TypeScript'] });
  const stale = await (await request(owner.accessToken, path + '/' + id)).json();
  assert.equal(stale.sourceStatus.profileChanged, true);
  assert.equal((await request(owner.accessToken, path + '/' + id + '/review', { revision: 0, actions: [] }, 'PATCH')).status, 409);
});
test('Cady responds from selected versions, rechecks deletion after generation and rejects stale jobs', async () => {
  const owner = await account();
  const result = await (await request(owner.accessToken, '/api/v1/intelligence/cady/ask', owner.ask)).json();
  assert.equal(result.draftId, owner.cv.id); assert.equal(result.sources[0].jobAnalysisId, owner.jd.id);
  const count = client.asked;
  await jobs.jobs.updateOne({ _id: owner.id }, { $set: { description: 'Changed source' } });
  assert.equal((await request(owner.accessToken, '/api/v1/intelligence/cady/ask', owner.ask)).status, 409); assert.equal(client.asked, count);
  const another = await account(); afterAsk = () => resumes.remove(another.user.id, another.cv.source.resumeId).then(() => {});
  try { assert.equal((await request(another.accessToken, '/api/v1/intelligence/cady/ask', another.ask)).status, 404); } finally { afterAsk = undefined; }
  const expiring = await account(); afterAsk = () => jobs.jobs.updateOne({ _id: expiring.id }, { $set: { expiresAt: new Date(0) } }).then(() => {});
  try { assert.equal((await request(expiring.accessToken, '/api/v1/intelligence/cady/ask', expiring.ask)).status, 409); } finally { afterAsk = undefined; }
});
test('worker source checks require the service token and reject removed or changed sources', async () => {
  const owner = await account(), path = '/internal/v1/intelligence/sources/check';
  const body = { owner: owner.user.id, resume: owner.cv.source, jobId: owner.id, jobHash: owner.jd.source.sha256, profileVersion: null };
  assert.equal((await request(owner.accessToken, path, body)).status, 401);
  assert.equal((await request('b'.repeat(64), path, body)).status, 200);
  assert.equal((await request('b'.repeat(64), path, { ...body, jobHash: 'c'.repeat(64) })).status, 409);
  await resumes.remove(owner.user.id, owner.cv.source.resumeId);
  assert.equal((await request('b'.repeat(64), path, body)).status, 409);
});
