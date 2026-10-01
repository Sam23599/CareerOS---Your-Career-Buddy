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
  assert.deepEqual(parseSavedQuery({ status: 'SAVED', priority: 'LOW', page: '2', limit: '10' }), { status: 'SAVED', priority: 'LOW', page: 2, limit: 10 });
  for (const query of [{ status: 'APPLIED' }, { priority: ['HIGH'] }, { page: '0' }, { limit: '51' }, { page: 'Infinity' }]) assert.throws(() => parseSavedQuery(query));
});
