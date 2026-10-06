import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SavedJobRanker, type RankedJob } from '../src/intelligence/ranking.js';
import { emptyProfile } from '../src/profiles/model.js';
import { type MatchResult } from '../src/intelligence/matching.js';
import fixture from './fixtures/resume-review.json' with { type: 'json' };

const ranker = new SavedJobRanker();
const input = { resumeId: fixture.source.resume.resumeId, draftId: fixture.source.draftId,
  includeProfileSkills: false, usePreferences: true, filters: { status: '', priority: '' } };
const job = { jobId: 'a'.repeat(64), title: 'Senior Software Engineer', company: 'Example', location: 'London, UK',
  remoteType: 'REMOTE', priority: 'MEDIUM', savedAt: '2026-10-01T00:00:00Z' };

test('ranking accepts only explicit owned-source references, options and valid filters', () => {
  assert.deepEqual(SavedJobRanker.input(input), input);
  for (const value of [null, { ...input, owner: 'other' }, { ...input, resumeId: 'bad' },
    { ...input, usePreferences: 'true' }, { ...input, includeProfileSkills: null },
    { ...input, filters: { status: '', priority: '', page: '2' } }, { ...input, filters: { status: 'applied', priority: '' } }]) {
    assert.throws(() => SavedJobRanker.input(value));
  }
});
test('preference tie-breakers use normalized literal phrases and treat missing work mode as unknown', () => {
  const preferences = { ...emptyProfile('Tester').preferences, roles: ['software engineer'], locations: ['UK'], workModes: ['REMOTE'] as const };
  const mutable = { ...preferences, workModes: [...preferences.workModes] };
  assert.deepEqual(ranker.preferences(job, mutable).map(item => item.status), ['matched', 'matched', 'matched']);
  assert.equal(ranker.preferences({ ...job, location: 'Ukraine', remoteType: 'UNKNOWN' }, mutable)[1].status, 'not_matched');
  assert.equal(ranker.preferences({ ...job, remoteType: 'UNKNOWN' }, mutable)[2].status, 'unknown');
  assert.deepEqual(ranker.preferences(job, null), []);
  assert.deepEqual(ranker.preferences(job, emptyProfile('Tester').preferences), []);
  for (const role of ['C++', 'C#', 'Node.js', '(lead)']) {
    assert.equal(ranker.preferences({ ...job, title: `${role} developer` }, { ...mutable, roles: [role] })[0].status, 'matched');
  }
});
test('compact summaries preserve existing coverage, gap priorities and profile-only evidence labels', () => {
  const match = structuredClone(fixture.match) as MatchResult;
  const summary = ranker.summarize(job, match, []);
  assert.ok('score' in summary);
  assert.equal(summary.score, 75); assert.equal(summary.matchedWeight, 3); assert.equal(summary.totalWeight, 4);
  assert.deepEqual(summary.missingSkills, [{ value: 'TypeScript', priority: 'preferred' }]);
  match.items[0].candidate!.source = 'profile';
  assert.deepEqual((ranker.summarize(job, match, []) as RankedJob).profileOnlySkills, ['Python']);
  match.score = null; match.totalWeight = 0;
  assert.equal((ranker.summarize(job, match, []) as { reason: string }).reason, 'no_scorable_skills');
});
test('coverage leads ranking; preferences, saved priority, date and stable ID break ties', () => {
  const base = ranker.summarize(job, fixture.match as MatchResult, []) as RankedJob;
  const values = [
    { ...base, jobId: 'a', score: 100, priority: 'LOW' },
    { ...base, jobId: 'b', preferenceMatches: 1, priority: 'LOW' },
    { ...base, jobId: 'c', priority: 'HIGH' },
    { ...base, jobId: 'd', savedAt: '2026-10-02T00:00:00Z' },
    { ...base, jobId: 'f' }, { ...base, jobId: 'e' },
  ];
  const sorted = ranker.sort(values.reverse());
  assert.deepEqual(sorted.map(item => item.jobId), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(sorted.map(item => item.rank), [1, 2, 3, 4, 5, 6]);
});
