import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { TaskVerifier } from '../src/intelligence/tasks.js';
test('task projection rejects private payloads and malformed status records', () => {
  const task = { id: randomUUID(), jobId: 'a'.repeat(64), sourceHash: 'b'.repeat(64), state: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), analysisId: null, errorCode: null };
  assert.deepEqual(TaskVerifier.history({ tasks: [task] }), { tasks: [task] });
  assert.throws(() => TaskVerifier.history({ tasks: [task], payload: 'private source' }));
  for (const changed of [{ ...task, payload: 'private source' }, { ...task, owner: randomUUID() }, { ...task, state: 'succeeded' }, { ...task, sourceHash: [task.sourceHash] }, { ...task, createdAt: 'invalid' }, { ...task, errorCode: 'provider body or secret' }]) assert.throws(() => TaskVerifier.history({ tasks: [changed] }));
});
