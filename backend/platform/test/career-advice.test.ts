import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PreparationVerifier, type PreparationRecord } from '../src/intelligence/preparation.js';
import { CadyVerifier } from '../src/intelligence/cady.js';
import { type DraftRecord } from '../src/intelligence/drafts.js';
import { type JobAnalysisRecord } from '../src/intelligence/jobs.js';
import { type MatchResult } from '../src/intelligence/matching.js';
import plan from './fixtures/preparation.json' with { type: 'json' };
import answer from './fixtures/cady.json' with { type: 'json' };
import cv from './fixtures/resume-draft.json' with { type: 'json' };
import jd from './fixtures/job-analysis.json' with { type: 'json' };
import match from './fixtures/matching.json' with { type: 'json' };

test('preparation verifies source identity, time, classifications and review action IDs', () => {
  assert.deepEqual(PreparationVerifier.record(plan, jd.source.jobId), plan);
  PreparationVerifier.bound(plan as PreparationRecord, match as MatchResult);
  for (const changed of [
    { ...plan, owner: 'private' }, { ...plan, source: { ...plan.source, jobId: 'b'.repeat(64) } },
    { ...plan, plan: { ...plan.plan, actions: [{ ...plan.plan.actions[0], matchIndex: 349 }] } },
    { ...plan, plan: { ...plan.plan, actions: [{ ...plan.plan.actions[0], hours: 6 }] } },
    { ...plan, goals: { ...plan.goals, choices: [{ matchIndex: 1, classification: 'unsure' }] } },
    { ...plan, review: { revision: 1, actions: [{ id: 'action-999', title: 'Unknown', detail: 'bad', status: 'planned' }] } },
  ]) assert.throws(() => PreparationVerifier.record(changed, jd.source.jobId));
  assert.throws(() => PreparationVerifier.bound(plan as PreparationRecord, { ...match, source: { ...match.source, draftId: jd.id } } as MatchResult));
  assert.throws(() => PreparationVerifier.review({ revision: 0, actions: [], owner: 'other' }));
  assert.throws(() => PreparationVerifier.review({ revision: 0, actions: [
    { id: 'action-1', title: 'One', detail: 'one', status: 'planned' }, { id: 'action-1', title: 'Two', detail: 'two', status: 'done' },
  ] }));
});

test('Cady verifies selected source snapshots, exact reference facts and safe result projection', () => {
  const options = { model: 'gpt-6-luna', reasoning: 'medium' };
  const verify = (value: unknown) => CadyVerifier.result(value, cv as DraftRecord, [jd as JobAnalysisRecord], null, options);
  assert.deepEqual(verify(answer), answer);
  for (const changed of [{ ...answer, owner: 'foreign' }, { ...answer, draftId: jd.id }, { ...answer, sources: [] },
    { ...answer, references: [{ ...answer.references[0], text: 'Invented CV skill' }] },
    { ...answer, answer: { ...answer.answer, paragraphs: [{ text: 'Unsupported', references: ['foreign-source'] }] } },
    { ...answer, references: [{ id: 'profile-0', label: 'Profile skill (self-reported)', text: 'Python' }] },
  ]) assert.throws(() => verify(changed));
  assert.equal(CadyVerifier.clean('Python contact private@example.com +91 9876543210 https://example.com/cv'), 'Python contact [contact removed] [contact removed] [contact removed]');
});
