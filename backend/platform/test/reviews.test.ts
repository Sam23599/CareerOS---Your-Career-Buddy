import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IntelligenceClient } from '../src/intelligence/client.js';
import { ReviewVerifier, type ReviewReport } from '../src/intelligence/reviews.js';
import { type DraftRecord } from '../src/intelligence/drafts.js';
import { type JobAnalysisRecord, type JobFact } from '../src/intelligence/jobs.js';
import cvFixture from './fixtures/resume-draft.json' with { type: 'json' };
import jobFixture from './fixtures/job-analysis.json' with { type: 'json' };
import fixture from './fixtures/resume-review.json' with { type: 'json' };

const cv = cvFixture as DraftRecord, job = jobFixture as JobAnalysisRecord;
const input = { draftId: cv.id, job: { jobId: job.source.jobId, jobAnalysisId: job.id, includeProfileSkills: false } };
test('review accepts only an explicit saved draft ID and optional job IDs/profile toggle', () => {
  assert.deepEqual(ReviewVerifier.input(input), input);
  assert.deepEqual(ReviewVerifier.input({ draftId: cv.id, job: null }), { draftId: cv.id, job: null });
  for (const changed of [null, { ...input, owner: 'other' }, { ...input, draftId: 'bad' }, { draftId: cv.id },
    { ...input, job: { ...input.job, profile: ['Python'] } }, { ...input, job: { ...input.job, includeProfileSkills: 'true' } }]) {
    assert.throws(() => ReviewVerifier.input(changed), { code: 'INVALID_INPUT' });
  }
});
test('review binds source/evidence, validates skill coverage and rejects invented preparation references', () => {
  assert.equal(ReviewVerifier.result(fixture, cv, job, null).match!.score, 75);
  for (const mutate of [
    (report: ReviewReport) => { report.source.draftVersion++; },
    (report: ReviewReport) => { report.sections[0].section = 'invented'; },
    (report: ReviewReport) => { report.findings[0].evidence = [{ page: 1, quote: 'Invented' }]; },
    (report: ReviewReport) => { report.findings[0].fields = ['invented']; },
    (report: ReviewReport) => { report.findings[0].fields = ['__proto__']; },
    (report: ReviewReport) => { report.findings.push(report.findings[0]); },
    (report: ReviewReport) => { report.findings[0].fields = ['extraction.warnings']; },
    (report: ReviewReport) => { report.match!.score = 100; },
    (report: ReviewReport) => { report.preparation[0].matchIndex = 0; },
    (report: ReviewReport) => { report.preparation[0].kind = 'profile_only'; },
    (report: ReviewReport) => { report.preparation.pop(); },
    (report: ReviewReport) => { report.preparation.push(report.preparation[0]); },
  ]) {
    const report = structuredClone(fixture) as ReviewReport; mutate(report);
    assert.throws(() => ReviewVerifier.result(report, cv, job, null), { code: 'INTELLIGENCE_RESPONSE_INVALID' });
  }
  const standalone = { ...structuredClone(fixture), match: null, preparation: [], keywords: [] };
  assert.equal(ReviewVerifier.result(standalone, cv, null, null).match, null);
  assert.throws(() => ReviewVerifier.result(fixture, cv, null, null), { code: 'INTELLIGENCE_RESPONSE_INVALID' });
});
test('keyword mentions require job provenance and an exact selected-CV page quote', () => {
  const term = { value: 'Python', evidence: (job.analysis.skills as JobFact[])[0].evidence };
  const withKeyword = { ...job, analysis: { ...job.analysis, keywords: [term] } } as JobAnalysisRecord;
  const report = { ...structuredClone(fixture), keywords: [{ term, status: 'found', evidence: [{ page: 1, quote: 'Python' }] }] } as ReviewReport;
  assert.equal(ReviewVerifier.result(report, cv, withKeyword, null).keywords[0].status, 'found');
  for (const mutate of [
    (report: ReviewReport) => { report.keywords[0].evidence[0].page = 2; },
    (report: ReviewReport) => { report.keywords[0].evidence[0].quote = 'Resume Tester'; },
    (report: ReviewReport) => { report.keywords[0].term.value = 'Invented'; },
    (report: ReviewReport) => { report.keywords[0].status = 'not_found'; },
  ]) {
    const changed = structuredClone(report); mutate(changed);
    assert.throws(() => ReviewVerifier.result(changed, cv, withKeyword, null), { code: 'INTELLIGENCE_RESPONSE_INVALID' });
  }
});
test('review sends only server-resolved references to Python with no provider or document payload', async () => {
  const client = new IntelligenceClient({ url: 'http://private.local', token: 'a'.repeat(64) }, async (url, options) => {
    assert.equal(url, 'http://private.local/internal/v1/resumes/review');
    assert.equal((options!.headers as Record<string, string>)['X-Owner-Id'], 'trusted-owner');
    assert.deepEqual(JSON.parse(options!.body as string), { resume: cv.source, draftId: cv.id, job: {
      jobId: job.source.jobId, jobHash: job.source.sha256, jobAnalysisId: job.id, profile: null,
    } });
    return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal((await client.review('trusted-owner', cv, job, null, new AbortController().signal)).match!.score, 75);
});
