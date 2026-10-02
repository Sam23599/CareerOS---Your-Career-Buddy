import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from './fixtures/resume-draft.json' with { type: 'json' };
import { validateDraft, validateHistory, validateModel, type Source } from '../src/intelligence/drafts.js';
import { IntelligenceClient } from '../src/intelligence/client.js';
import { DraftReview, type ResumeDraft } from '../../../frontend/web/src/resumes/draftReview.js';
import { emptyProfile } from '../src/profiles/model.js';

const code = (expected: string) => (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === expected;

test('draft gateway validates schema, source binding and exact page evidence', () => {
  assert.deepEqual(validateDraft(fixture, fixture.source), fixture);
  for (const changed of [
    { ...fixture, owner: 'foreign' }, { ...fixture, schemaVersion: 2 },
    { ...fixture, version: 0 }, { ...fixture, version: 1.5 }, { ...fixture, version: undefined },
    { ...fixture, source: { ...fixture.source, sha256: 'd'.repeat(64) } },
    { ...fixture, draft: { ...fixture.draft, fullName: { value: 'Private', evidence: [] } } },
    { ...fixture, draft: { ...fixture.draft, fullName: { value: 'Invented name', evidence: [{ page: 1, quote: 'Resume Tester' }] } } },
    { ...fixture, draft: { ...fixture.draft, fullName: { value: 'Resume Tester', evidence: [{ page: 2, quote: 'Resume Tester' }] } } },
    { ...fixture, extraction: { ...fixture.extraction, text: 'inconsistent' } },
  ]) assert.throws(() => validateDraft(changed, fixture.source), code('INTELLIGENCE_RESPONSE_INVALID'));
});

test('version history has bounded metadata, descending versions and a valid pagination cursor', async () => {
  const { id, version, model, reasoning, createdAt } = fixture;
  const summary = { id, version, model, reasoning, createdAt };
  const history = { versions: [summary], nextBeforeVersion: null };
  assert.deepEqual(validateHistory(history), history);
  for (const invalid of [{ ...history, owner: 'foreign' }, { versions: [{ ...summary, draft: {} }], nextBeforeVersion: null },
    { versions: [{ ...summary, version: 0 }], nextBeforeVersion: null }, { versions: [summary, summary], nextBeforeVersion: null },
    { ...history, nextBeforeVersion: 1 }, { versions: [{ ...summary, model: 'unknown' }], nextBeforeVersion: null }]) {
    assert.throws(() => validateHistory(invalid), code('INTELLIGENCE_RESPONSE_INVALID'));
  }
  assert.throws(() => validateHistory(history, 1), code('INTELLIGENCE_RESPONSE_INVALID'));
  const client = new IntelligenceClient({ url: 'http://intelligence.test', token: 'ab'.repeat(32) }, async (url, init) => {
    assert.equal(String(url), `http://intelligence.test/internal/v1/resumes/${fixture.source.resumeId}/drafts?beforeVersion=2`);
    assert.equal(new Headers(init?.headers).get('X-Owner-Id'), 'trusted-owner');
    assert.equal(new Headers(init?.headers).get('X-Source-Sha256'), fixture.source.sha256);
    return Response.json(history);
  });
  assert.deepEqual(await client.draftHistory('trusted-owner', fixture.source, 2), history);
});

test('only requested model IDs and their real reasoning settings are accepted', () => {
  assert.deepEqual(validateModel({ model: 'gpt-4.1', reasoning: null }), { model: 'gpt-4.1', reasoning: null });
  assert.equal(validateModel({ model: 'gpt-6.1-sol', reasoning: 'max' }).reasoning, 'max');
  for (const request of [{ model: 'gpt-4.1', reasoning: 'medium' }, { model: 'gpt-6.1-sol', reasoning: 'none' },
    { model: 'gpt-6-luna', reasoning: 'ultra' }, { model: 'other', reasoning: null }, { model: 'gpt-6-luna', reasoning: 'medium', owner: 'foreign' }]) {
    assert.throws(() => validateModel(request), code('INVALID_INPUT'));
  }
});

test('analysis client sends trusted source headers and validates the returned source', async () => {
  let calls = 0;
  const settings = { url: 'http://intelligence.test', token: 'ab'.repeat(32) };
  const client = new IntelligenceClient(settings, async (url, init) => {
    calls++;
    assert.equal(String(url), 'http://intelligence.test/internal/v1/resumes/analyze');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${settings.token}`);
    assert.equal(headers.get('X-Owner-Id'), 'trusted-owner');
    assert.equal(headers.get('X-Source-Sha256'), fixture.source.sha256);
    assert.equal(headers.get('X-LLM-Model'), 'gpt-6-luna');
    assert.equal(headers.get('X-LLM-Reasoning'), 'medium');
    assert.equal(headers.get('Content-Type'), 'application/pdf');
    return Response.json(fixture);
  });
  const result = await client.analyze('trusted-owner', fixture.source as Source, Buffer.from('%PDF-1.4'), { model: 'gpt-6-luna', reasoning: 'medium' }, new AbortController().signal);
  assert.equal(result.id, fixture.id); assert.equal(calls, 1);
});

test('review keeps existing skills and rows and never invents month precision', () => {
  const profile = emptyProfile('Existing Name');
  profile.skills = ['python', 'SQL'];
  const source = structuredClone(fixture.draft) as ResumeDraft;
  const fact = (value: string) => ({ value, evidence: [{ page: 1, quote: value }] });
  source.experience = [{ company: fact('Example Co'), role: fact('Engineer'), location: fact('Pune'),
    startDate: fact('2020'), endDate: fact('Present'), description: fact('Built APIs'), achievements: [fact('Reduced latency')] }];
  const review = DraftReview.suggest(source, profile);
  assert.deepEqual(review.skills, ['python', 'SQL']);
  assert.equal(review.fullName, 'Resume Tester');
  assert.equal(review.experience[0].startDate, '');
  assert.equal(review.experience[0].current, true);
  assert.equal(review.experience[0].description, 'Built APIs\nReduced latency');
  assert.equal(DraftReview.month('March 2020'), '2020-03');
  assert.equal(DraftReview.month('2020'), '');
  profile.experience = review.experience;
  assert.equal(DraftReview.suggest(source, profile).experience.length, 1);
});

test('saved-draft lookup forwards the exact reviewed ID in trusted internal headers', async () => {
  let expectedAnalysisId = fixture.id;
  const client = new IntelligenceClient({ url: 'http://intelligence.test', token: 'ab'.repeat(32) }, async (url, init) => {
    assert.equal(String(url), `http://intelligence.test/internal/v1/resumes/${fixture.source.resumeId}/draft`);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Analysis-Id'), expectedAnalysisId);
    assert.equal(headers.get('X-Owner-Id'), 'trusted-owner');
    assert.equal(headers.get('X-Resume-Version'), '1');
    assert.equal(headers.get('X-Source-Sha256'), fixture.source.sha256);
    return Response.json(fixture);
  });
  assert.equal((await client.draft('trusted-owner', fixture.source, undefined, fixture.id)).id, fixture.id);
  expectedAnalysisId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await assert.rejects(client.draft('trusted-owner', fixture.source, undefined, expectedAnalysisId), code('INTELLIGENCE_RESPONSE_INVALID'));
});
