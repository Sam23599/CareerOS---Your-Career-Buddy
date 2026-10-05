import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IntelligenceClient } from '../src/intelligence/client.js';
import { MatchVerifier, type MatchResult } from '../src/intelligence/matching.js';
import { type DraftRecord } from '../src/intelligence/drafts.js';
import { type JobAnalysisRecord } from '../src/intelligence/jobs.js';
import resumeFixture from './fixtures/resume-draft.json' with { type: 'json' };
import jobFixture from './fixtures/job-analysis.json' with { type: 'json' };
import fixture from './fixtures/matching.json' with { type: 'json' };

const resume = resumeFixture as DraftRecord, job = jobFixture as JobAnalysisRecord;
const input = { resumeId: resume.source.resumeId, draftId: resume.id, jobAnalysisId: job.id, includeProfileSkills: false };
test('matching input accepts only chosen IDs and an explicit profile toggle', () => {
  assert.deepEqual(MatchVerifier.input(input), input);
  for (const body of [null, { ...input, owner: 'someone' }, { ...input, skills: ['Python'] }, { ...input, includeProfileSkills: 'true' }, { ...input, resumeId: 'bad' }]) {
    assert.throws(() => MatchVerifier.input(body), { code: 'INVALID_INPUT' });
  }
});
test('matching contract verifies source versions, evidence and weighted arithmetic', () => {
  const result = MatchVerifier.result(fixture, resume, job, null);
  assert.equal(result.score, 75); assert.equal(result.matchedWeight, 3); assert.equal(result.totalWeight, 4);
  assert.equal(result.items.find(item => item.category === 'experience')!.status, 'needs_review');
  for (const mutate of [
    (match: MatchResult) => { match.score = 100; },
    (match: MatchResult) => { match.source.draftVersion++; },
    (match: MatchResult) => { match.source.jobHash = 'b'.repeat(64); },
    (match: MatchResult) => { match.items[0].requirement.value = 'Invented'; },
    (match: MatchResult) => { match.items[0].candidate!.evidence[0].quote = 'Invented'; },
    (match: MatchResult) => { match.items[0].candidate!.field = 'summary'; },
    (match: MatchResult) => { match.items[0].weight = 1; },
    (match: MatchResult) => { match.items[0].candidate = null; },
    (match: MatchResult) => { match.items[0].candidate = { source: 'profile', field: 'skills', value: 'Python', evidence: [] }; },
  ]) {
    const changed = structuredClone(fixture) as MatchResult; mutate(changed);
    assert.throws(() => MatchVerifier.result(changed, resume, job, null), { code: 'INTELLIGENCE_RESPONSE_INVALID' });
  }
});
test('matching sends trusted references to the private service without model credentials or document text', async () => {
  let requests = 0;
  const client = new IntelligenceClient({ url: 'http://private.local', token: 'a'.repeat(64) }, async (url, options) => {
    requests++; assert.equal(url, 'http://private.local/internal/v1/matching/compare');
    assert.equal((options!.headers as Record<string, string>)['X-Owner-Id'], 'trusted-owner');
    assert.deepEqual(JSON.parse(options!.body as string), { resume: resume.source, draftId: resume.id, jobId: job.source.jobId,
      jobHash: job.source.sha256, jobAnalysisId: job.id, profile: null });
    return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal((await client.compare('trusted-owner', resume, job, null, new AbortController().signal)).score, 75);
  assert.equal(requests, 1);
});
