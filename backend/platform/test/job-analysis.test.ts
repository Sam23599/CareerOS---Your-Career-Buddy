import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from './fixtures/job-analysis.json' with { type: 'json' };
import { JobAnalysisVerifier, JobTextSource, RequirementPriority, type JobEvidence } from '../src/intelligence/jobs.js';
import { IntelligenceClient } from '../src/intelligence/client.js';

const invalid = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'INTELLIGENCE_RESPONSE_INVALID';
const trustedSource = JobAnalysisVerifier.record(fixture, fixture.source.jobId).source;
test('job source normalization and hashing match Python and ignore ingestion timestamps', () => {
  const fields = Object.fromEntries(fixture.source.sections.map(item => [item.id, item.text]));
  const job = { id: fixture.source.jobId, title: fields.title, company: fields.company, location: fields.location, description: fields.description };
  assert.deepEqual(JobTextSource.create(job), fixture.source);
  assert.equal(JobTextSource.create({ ...job, description: fields.description.replaceAll('\n', '\r\n') + '\0' }).sha256, fixture.source.sha256);
  assert.notEqual(JobTextSource.create({ ...job, description: fields.description + '\nSQL is required' }).sha256, fixture.source.sha256);
});

test('job record checks source, Unicode offsets, copied values and priority evidence', () => {
  assert.deepEqual(JobAnalysisVerifier.record(fixture, fixture.source.jobId, fixture.source.sha256), fixture);
  const skill = fixture.analysis.skills[0];
  for (const changed of [
    { ...fixture, owner: 'foreign' }, { ...fixture, version: 0 },
    { ...fixture, source: { ...fixture.source, sha256: 'b'.repeat(64) } },
    { ...fixture, analysis: { ...fixture.analysis, skills: [{ ...skill, value: 'Rust' }] } },
    { ...fixture, analysis: { ...fixture.analysis, skills: [{ ...skill, priority: 'preferred' }] } },
    { ...fixture, analysis: { ...fixture.analysis, skills: [{ ...skill, evidence: [{ ...skill.evidence[0], start: 0 }] }] } },
    { ...fixture, analysis: { ...fixture.analysis, skills: [{ ...skill, value: null }] } },
  ]) assert.throws(() => JobAnalysisVerifier.record(changed, fixture.source.jobId), invalid);
  assert.throws(() => JobAnalysisVerifier.record(fixture, 'b'.repeat(64)), invalid);
  assert.throws(() => JobAnalysisVerifier.record(fixture, fixture.source.jobId, 'b'.repeat(64)), invalid);
  assert.throws(() => JobAnalysisVerifier.record(fixture, fixture.source.jobId, undefined, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), invalid);
});

test('priority rules retain unknowns and match the Python source fixtures', () => {
  for (const [text, priority] of [['Python is required', 'required'], ['Python is preferred', 'preferred'],
    ['Python is not required', 'unspecified'], ['Python required or preferred', 'unspecified'], ['Python', 'unspecified'],
    ['Required skills:\nPython', 'required'], ['Required skills:\nBenefits:\nPython', 'unspecified']]) {
    const start = Array.from(text.slice(0, text.indexOf('Python'))).length;
    assert.equal(RequirementPriority.resolve({ description: Array.from(text) }, { section: 'description', quote: 'Python', start, end: start + 6 }).priority, priority);
  }
});

test('repeated source quotes cannot justify a priority through an arbitrary first occurrence', () => {
  const changed = structuredClone(fixture);
  changed.source.sections[3].text += '\nPython';
  changed.source.sha256 = JobTextSource.hash({ normalizerVersion: 'job-source-v1', sections: changed.source.sections as typeof trustedSource.sections });
  assert.throws(() => JobAnalysisVerifier.record(changed, changed.source.jobId), invalid);
  changed.analysis.skills[0].priority = 'unspecified'; changed.analysis.skills[0].priorityEvidence = [];
  JobAnalysisVerifier.record(changed, changed.source.jobId);
});

test('job history rejects unbounded, foreign and malformed metadata', () => {
  const { id, version, model, reasoning, createdAt, source } = fixture;
  const summary = { id, version, model, reasoning, createdAt, sourceHash: source.sha256 };
  const history = { versions: [summary], nextBeforeVersion: null };
  assert.deepEqual(JobAnalysisVerifier.history(history), history);
  for (const value of [{ ...history, owner: 'foreign' }, { versions: [{ ...summary, sourceHash: 'invalid' }], nextBeforeVersion: null },
    { versions: [summary, summary], nextBeforeVersion: null }, { ...history, nextBeforeVersion: 1 },
    { versions: [{ ...summary, analysis: fixture.analysis }], nextBeforeVersion: null }]) assert.throws(() => JobAnalysisVerifier.history(value), invalid);
});

test('job gateway forwards trusted text only and validates exact ID and source', async () => {
  let calls = 0;
  const client = new IntelligenceClient({ url: 'http://intelligence.test', token: 'ab'.repeat(32) }, async (url, init) => {
    calls++;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Owner-Id'), 'trusted-owner');
    assert.equal(headers.get('X-Source-Sha256'), fixture.source.sha256);
    if (String(url).endsWith('/analyze')) {
      assert.deepEqual(JSON.parse(init!.body as string), fixture.source);
      assert.equal(headers.get('X-LLM-Model'), 'gpt-6-luna');
      assert.equal(headers.get('X-LLM-Reasoning'), 'medium');
      assert.equal(headers.get('Content-Type'), 'application/json');
    }
    return Response.json(fixture);
  });
  await client.analyzeJob('trusted-owner', trustedSource, { model: 'gpt-6-luna', reasoning: 'medium' }, new AbortController().signal);
  await client.jobAnalysis('trusted-owner', trustedSource, fixture.id);
  assert.equal(calls, 2);
  await assert.rejects(client.jobAnalysis('trusted-owner', trustedSource, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), invalid);
  assert.equal(calls, 3);
});

test('warnings use validated quotes and fixed safe messages', () => {
  const quote = fixture.analysis.skills[0].evidence[0] as JobEvidence;
  const good = { ...fixture, analysis: { ...fixture.analysis, warnings: [{ code: 'AMBIGUOUS_REQUIREMENT', message: 'This requirement is ambiguous. Review the quoted listing text.', evidence: [quote] }] } };
  JobAnalysisVerifier.record(good, fixture.source.jobId);
  assert.throws(() => JobAnalysisVerifier.record({ ...good, analysis: { ...good.analysis, warnings: [{ ...good.analysis.warnings[0], message: 'Private provider error' }] } }, fixture.source.jobId), invalid);
});
