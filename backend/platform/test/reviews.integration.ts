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
import { type ProfileSkills } from '../src/intelligence/matching.js';
import { type ReviewReport } from '../src/intelligence/reviews.js';
import { ApiError } from '../src/errors.js';
import cvFixture from './fixtures/resume-draft.json' with { type: 'json' };
import jobFixture from './fixtures/job-analysis.json' with { type: 'json' };
import fixture from './fixtures/resume-review.json' with { type: 'json' };

if (!process.env.TEST_MONGODB_URI) throw new Error('Set TEST_MONGODB_URI to run integration tests.');
const mongo = new MongoClient(process.env.TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
const db = mongo.db(`careeros_review_test_${randomUUID().replaceAll('-', '')}`);
const store = new AuthStore(db), auth = new AuthService(store, new Tokens(randomBytes(32).toString('hex')));
const profiles = new ProfileStore(db), jobs = new JobStore(db);
let afterReview: (() => Promise<void>) | undefined, reviewCalls = 0;
class ReviewClient extends IntelligenceClient {
  cvs = new Map<string, DraftRecord>(); jds = new Map<string, JobAnalysisRecord>();
  constructor() { super({ url: 'http://test.local', token: 'a'.repeat(64) }); }
  override async draft(owner: string, source: Source, _signal?: AbortSignal, id?: string) {
    const cv = this.cvs.get(`${owner}:${id}`);
    if (!cv || cv.source.resumeId !== source.resumeId) throw new ApiError(404, 'ANALYSIS_NOT_FOUND', 'No saved CV.');
    return cv;
  }
  override async jobAnalysis(owner: string, _source: JobSource, id?: string) {
    const job = this.jds.get(`${owner}:${id}`);
    if (!job) throw new ApiError(404, 'JOB_ANALYSIS_NOT_FOUND', 'No saved analysis.');
    return job;
  }
  override async review(_owner: string, cv: DraftRecord, jd: JobAnalysisRecord | null, profile: ProfileSkills | null) {
    reviewCalls++; if (afterReview) await afterReview();
    const report = structuredClone(fixture) as ReviewReport;
    report.source = { resume: cv.source, draftId: cv.id, draftVersion: cv.version };
    if (!jd) { report.match = null; report.preparation = []; report.keywords = []; }
    else report.match!.source = { ...report.match!.source, resume: cv.source, draftId: cv.id, draftVersion: cv.version,
      jobId: jd.source.jobId, jobHash: jd.source.sha256, jobAnalysisId: jd.id, jobAnalysisVersion: jd.version, profileVersion: profile?.version ?? null };
    return report;
  }
}
const client = new ReviewClient();
let resumes: ResumeStore, directory: string, server: Server, base: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'careeros-review-')); resumes = new ResumeStore(db, new LocalResumeStorage(directory));
  await store.initialize(); await jobs.initialize();
  server = createApp(async () => {}, { service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false }, profiles, resumes,
    { store: jobs, sources: [] }, undefined, undefined, client).listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/intelligence/resumes`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  await db.dropDatabase(); await mongo.close(); await rm(directory, { recursive: true, force: true });
});
async function account() {
  const login = await auth.register({ name: 'Review Tester', email: `${randomUUID()}@example.com`, password: 'a review test passphrase' });
  const library = await resumes.upload(login.user.id, 'resume.pdf', Buffer.from('%PDF-1.4\nsynthetic\n%%EOF'));
  const source = await new ResumeAnalysisService(resumes, client).source(login.user.id, library.resumes[0].id);
  const cv = { ...structuredClone(cvFixture), id: randomUUID(), source: source.source } as DraftRecord;
  const id = randomBytes(32).toString('hex');
  const job = { ...structuredClone(jobFixture), id: randomUUID(), source: { ...jobFixture.source, jobId: id } } as JobAnalysisRecord;
  const fields = Object.fromEntries(job.source.sections.map(section => [section.id, section.text]));
  await jobs.jobs.insertOne({ _id: id, source: 'fixture', sourceId: id, title: fields.title, company: fields.company, location: fields.location,
    description: fields.description, employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', skills: [], sourceUrl: 'https://example.com/job',
    postedAt: null, expiresAt: null, metadata: {}, createdAt: new Date(), updatedAt: new Date() });
  client.cvs.set(`${login.user.id}:${cv.id}`, cv); client.jds.set(`${login.user.id}:${job.id}`, job);
  return { ...login, cv, job, input: { draftId: cv.id, job: { jobId: id, jobAnalysisId: job.id, includeProfileSkills: false } } };
}
const request = (token: string, id: string, body: unknown, query = '') => fetch(`${base}/${id}/review${query}`, { method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('review enforces authentication, ADMIN ownership and strict caller inputs', async () => {
  const owner = await account(), other = await account(); const count = reviewCalls;
  assert.equal((await request('', owner.cv.source.resumeId, owner.input)).status, 401);
  await store.users.updateOne({ _id: other.user.id }, { $set: { roles: ['ADMIN'] } });
  assert.equal((await request(other.accessToken, owner.cv.source.resumeId, owner.input)).status, 404);
  assert.equal((await request(owner.accessToken, owner.cv.source.resumeId, { ...owner.input, job: other.input.job })).status, 404);
  for (const body of [{ ...owner.input, owner: other.user.id }, { ...owner.input, draftId: 'bad' }, { ...owner.input, profile: ['Invented'] }]) {
    assert.equal((await request(owner.accessToken, owner.cv.source.resumeId, body)).status, 400);
  }
  assert.equal((await request(owner.accessToken, owner.cv.source.resumeId, owner.input, '?model=other')).status, 400);
  assert.equal(reviewCalls, count);
});
test('standalone and job reviews bind versions and profile snapshots without changing the library', async () => {
  const owner = await account();
  const standalone = await request(owner.accessToken, owner.cv.source.resumeId, { draftId: owner.cv.id, job: null });
  assert.equal(standalone.status, 200); const body = await standalone.json(); assert.equal(body.report.match, null);
  assert.equal(body.report.source.draftId, owner.cv.id);
  await profiles.update(owner.user, 0, { skills: ['TypeScript'] });
  const response = await request(owner.accessToken, owner.cv.source.resumeId, { ...owner.input, job: { ...owner.input.job, includeProfileSkills: true } });
  assert.equal(response.status, 200); const report = (await response.json()).report;
  assert.equal(report.match.source.profileVersion, 1); assert.equal((await profiles.get(owner.user)).version, 1);
  assert.equal((await resumes.list(owner.user.id)).resumes.length, 1);
});
test('expired unchanged jobs remain reference-only; stale or missing inputs fail before review', async () => {
  const owner = await account();
  await jobs.jobs.updateOne({ _id: owner.job.source.jobId }, { $set: { expiresAt: new Date(0) } });
  assert.equal((await (await request(owner.accessToken, owner.cv.source.resumeId, owner.input)).json()).sourceStatus.expired, true);
  const count = reviewCalls;
  assert.equal((await request(owner.accessToken, owner.cv.source.resumeId, { ...owner.input, draftId: randomUUID() })).status, 404);
  await jobs.jobs.updateOne({ _id: owner.job.source.jobId }, { $set: { description: 'New requirements' } });
  const response = await request(owner.accessToken, owner.cv.source.resumeId, owner.input);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'JOB_ANALYSIS_STALE');
  assert.equal(reviewCalls, count);
});
test('resume removal and concurrent job/profile edits suppress outdated reports', async () => {
  for (const kind of ['resume', 'job', 'profile']) {
    const owner = await account();
    afterReview = async () => {
      if (kind === 'resume') await resumes.remove(owner.user.id, owner.cv.source.resumeId);
      if (kind === 'job') await jobs.jobs.updateOne({ _id: owner.job.source.jobId }, { $set: { description: 'Updated description' } });
      if (kind === 'profile') await profiles.update(owner.user, 0, { skills: ['Updated'] });
    };
    try {
      const response = await request(owner.accessToken, owner.cv.source.resumeId, { ...owner.input, job: { ...owner.input.job, includeProfileSkills: kind === 'profile' } });
      assert.equal(response.status, kind === 'resume' ? 404 : 409);
    } finally { afterReview = undefined; }
  }
});
