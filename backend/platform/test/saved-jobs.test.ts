import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseSavedPatch, parseSavedQuery } from '../src/saved-jobs/store.js';

test('saved-job edits allow only bounded notes, interest status and priority with a revision', () => {
  const revision = randomUUID();
  assert.deepEqual(parseSavedPatch({ revision, notes: '', priority: 'HIGH', status: 'INTERESTED' }), { revision, changes: { notes: '', priority: 'HIGH', status: 'INTERESTED' } });
  for (const body of [{ notes: 'missing revision' }, { revision }, { revision, ownerId: 'other' }, { revision, status: 'APPLIED' }, { revision, priority: 'URGENT' }, { revision, notes: 'a'.repeat(5001) }, { revision, notes: { $set: 'bad' } }]) assert.throws(() => parseSavedPatch(body));
});
test('saved-job filters and pagination reject invalid or repeated parameters', () => {
  assert.deepEqual(parseSavedQuery({ status: 'SAVED', priority: 'LOW', page: '2', limit: '10' }), { location: '', postedFrom: '', postedTo: '', applicationStatus: '', companyHistory: '', status: 'SAVED', priority: 'LOW', page: 2, limit: 10 });
  for (const query of [{ status: 'APPLIED' }, { priority: ['HIGH'] }, { page: '0' }, { limit: '51' }, { page: 'Infinity' }]) assert.throws(() => parseSavedQuery(query));
});

test('posting-date and application filters validate real dates and preserve interest status', () => {
  for (const query of [{ postedFrom: '2026-02-30' }, { postedFrom: '2026-10-07', postedTo: '2026-10-06' }, { applicationStatus: 'UNKNOWN' }, { companyHistory: ['previously_applied'] }]) assert.throws(() => parseSavedQuery(query));
  assert.equal(parseSavedQuery({ applicationStatus: 'INTERVIEWING', location: 'India', postedFrom: '2026-10-01' }).applicationStatus, 'INTERVIEWING');
  assert.equal(parseSavedPatch({ revision: randomUUID(), applicationStatus: 'APPLIED' }).changes.applicationStatus, 'APPLIED');
});
