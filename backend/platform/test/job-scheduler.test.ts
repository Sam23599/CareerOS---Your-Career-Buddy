import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refreshDueJobs, startJobScheduler } from '../src/jobs/scheduler.js';
import { FixtureSource, RemotiveSource } from '../src/jobs/sources.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
test('scheduler refreshes immediately when due and again after four hours, and stops cleanly', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: new Date(0) });
  const source = new RemotiveSource();
  assert.equal(source.cooldownMs, 4 * 60 * 60 * 1000);
  let calls = 0; let nextAt = new Date(0);
  const stop = startJobScheduler({ initialize: async () => {}, nextRefreshAt: async () => nextAt, ingest: async () => { calls++; nextAt = new Date(Date.now() + source.cooldownMs); return { source: source.id, imported: 1 }; } }, [source]);
  await flush(); assert.equal(calls, 1);
  context.mock.timers.tick(source.cooldownMs - 60_000); await flush(); assert.equal(calls, 1);
  context.mock.timers.tick(60_000); await flush(); assert.equal(calls, 2);
  await stop(); context.mock.timers.tick(source.cooldownMs); await flush(); assert.equal(calls, 2);
});
test('a recent persisted refresh is skipped and one failed source does not block others', async () => {
  const calls: string[] = [];
  const sources = ['recent', 'failed', 'due'].map(id => ({ ...new FixtureSource(), id, fetchJobs: async () => [] }));
  await refreshDueJobs({ initialize: async () => {}, nextRefreshAt: async source => new Date(source.id === 'recent' ? Date.now() + 60_000 : 0), ingest: async source => { calls.push(source.id); if (source.id === 'failed') throw new Error('Unavailable'); return { source: source.id, imported: 1 }; } }, sources);
  assert.deepEqual(calls, ['failed', 'due']);
});
test('scheduler does not overlap slow refreshes and shutdown waits for the running import', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const stop = startJobScheduler({ initialize: async () => {}, nextRefreshAt: async () => new Date(0), ingest: async () => { calls++; await gate; return { source: 'fixture', imported: 1 }; } }, [new FixtureSource()]);
  await flush(); context.mock.timers.tick(120_000); await flush(); assert.equal(calls, 1);
  let stopped = false; const stopping = stop().then(() => { stopped = true; });
  await flush(); assert.equal(stopped, false); release(); await stopping; assert.equal(stopped, true);
});
test('custom-source checks still run when the global source store is temporarily unavailable', async () => {
  let checks = 0;
  const stop = startJobScheduler({ initialize: async () => { throw new Error('Unavailable'); }, nextRefreshAt: async () => new Date(0), ingest: async () => ({ source: 'unused', imported: 0 }) }, [], async () => { checks++; });
  await flush(); await stop(); assert.equal(checks, 1);
});
