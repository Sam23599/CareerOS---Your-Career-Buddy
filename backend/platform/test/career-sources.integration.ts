import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { type Server } from 'node:http';
import { MongoClient } from 'mongodb';
import { createApp } from '../src/app.js';
import { AuthStore } from '../src/auth/store.js';
import { AuthService } from '../src/auth/service.js';
import { Tokens } from '../src/auth/tokens.js';
import { CareerSourceStore, parseSource } from '../src/career-sources/store.js';
import { JobStore } from '../src/jobs/store.js';
import { type JobInput, type JobSource } from '../src/jobs/model.js';
import { type Notice, NotificationService, NotificationStore } from '../src/notifications/store.js';

const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error('Set TEST_MONGODB_URI to run MongoDB integration tests.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
const db = client.db(`careeros_sources_test_${randomUUID().replaceAll('-', '')}`);
const authStore = new AuthStore(db), auth = new AuthService(authStore, new Tokens(randomBytes(32).toString('hex')));
const jobs = new JobStore(db), notifications = new NotificationStore(db);
let deliveryFails = false;
const service = new NotificationService(notifications, { deliver: async (owner, notice) => { if (deliveryFails) throw new Error('Delivery unavailable'); await notifications.deliver(owner, notice); } });
const feeds = new Map<string, JobInput[]>(), failed = new Set<string>(), calls = new Map<string, number>();
let gate: Promise<void> | undefined;
const adapter = (board: string): JobSource => ({ id: `greenhouse:${board}`, name: 'Test board', cooldownMs: ['cached', 'shared-failure'].includes(board) ? 3_600_000 : 0, reconcileMissing: true, fetchJobs: async () => {
  calls.set(board, (calls.get(board) ?? 0) + 1); if (board.startsWith('slow')) await gate;
  if (failed.has(board)) throw new Error('Provider unavailable'); return feeds.get(board) ?? [];
} });
const sources = new CareerSourceStore(db, jobs, service, adapter);
let first: Awaited<ReturnType<AuthService['register']>>, second: typeof first, server: Server, base: string;
before(async () => {
  await Promise.all([authStore.initialize(), jobs.initialize(), sources.initialize(), notifications.initialize()]);
  first = await auth.register({ name: 'First', email: 'first@example.com', password: 'a test passphrase' });
  second = await auth.register({ name: 'Second', email: 'second@example.com', password: 'a test passphrase' });
  server = createApp(async () => {}, { service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false }, undefined, undefined, { store: jobs, sources: [] }, undefined, { careerSources: sources, notifications }).listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(async () => { if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await db.dropDatabase(); await client.close(); });
function request(path: string, token = first.accessToken, method = 'GET', body?: unknown) { return fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
const sourceBody = (board: string, changes = {}) => ({ company: 'Dream Company', careerUrl: `https://boards.greenhouse.io/${board}`, keywords: ['C++'], locations: ['India'], scanHours: 0, enabled: true, ...changes });
const settings = (board: string, changes = {}) => parseSource(sourceBody(board, changes));
const job = (id: string, changes = {}): JobInput => ({ sourceId: id, title: 'C++ Engineer', company: 'Official Company', description: 'Work on the database.', location: 'India', remoteType: 'UNKNOWN', employmentType: 'UNKNOWN', skills: [], sourceUrl: `https://example.com/jobs/${id}`, postedAt: null, expiresAt: null, metadata: {}, ...changes });
test('private source endpoints enforce ownership, validate input and prevent duplicate URLs', async () => {
  assert.equal((await request('/career-sources', '', 'GET')).status, 401);
  assert.equal((await request('/notifications', '', 'GET')).status, 401);
  const result = await request('/career-sources', first.accessToken, 'POST', sourceBody('private')); assert.equal(result.status, 201);
  const { source } = await result.json(); assert.equal(source.ownerId, undefined); assert.equal(source.seenIds, undefined);
  assert.equal((await request('/career-sources', first.accessToken, 'POST', sourceBody('private'))).status, 409);
  assert.equal((await (await request('/career-sources', second.accessToken)).json()).total, 0);
  assert.equal((await request(`/career-sources/${source.id}/jobs`, second.accessToken)).status, 404);
  assert.equal((await request(`/career-sources/${source.id}/refresh`, second.accessToken, 'POST', {})).status, 404);
  assert.equal((await request(`/career-sources/${source.id}`, second.accessToken, 'PATCH', { ...sourceBody('private'), revision: source.revision })).status, 404);
  assert.equal((await request(`/career-sources/${source.id}`, second.accessToken, 'DELETE')).status, 204);
  assert.equal((await (await request('/career-sources?q=Dream')).json()).total, 1);
  assert.equal((await request('/career-sources?page=0')).status, 400);
  assert.equal((await request('/career-sources', first.accessToken, 'POST', sourceBody('other', { ownerId: second.user.id }))).status, 400);
});
test('source edits use revisions and link-only pages cannot be fetched or scheduled', async () => {
  const source = await sources.create(first.user.id, settings('editing'));
  const edited = await sources.update(first.user.id, source.id, { ...settings('editing', { company: 'Edited' }), revision: source.revision }); assert.equal(edited.company, 'Edited');
  await assert.rejects(sources.update(first.user.id, source.id, { ...settings('editing'), revision: source.revision }), { status: 409 });
  const link = await sources.create(first.user.id, settings('unused', { careerUrl: 'https://example.com/careers' }));
  assert.equal(link.provider, null); await assert.rejects(sources.refresh(first.user.id, link.id), { status: 400 }); assert.equal(calls.get('unused'), undefined);
  const paused = await sources.create(first.user.id, settings('paused', { enabled: false })); await assert.rejects(sources.refresh(first.user.id, paused.id), { status: 400 });
  await sources.remove(first.user.id, link.id); assert.equal((await sources.list(first.user.id, { filter: 'reference' })).total, 0);
});
test('matching combines literal keyword and location groups, caches provider imports and avoids repeat alerts', async () => {
  feeds.set('cached', [job('one'), job('two', { title: 'Designer' }), job('three', { location: 'UK' })]);
  const source = await sources.create(first.user.id, settings('cached'));
  const refreshed = await sources.refresh(first.user.id, source.id); assert.equal(refreshed.source.matchingCount, 1); assert.equal(refreshed.source.newCount, 1);
  const rows = await sources.matchingJobs(first.user.id, source.id, {}); assert.equal(rows.total, 1); assert.equal(rows.jobs[0].source, 'greenhouse:cached');
  const firstCount = (await notifications.list(first.user.id, {})).total;
  const again = await sources.refresh(first.user.id, source.id); assert.equal(again.cached, true); assert.equal(again.source.newCount, 0); assert.equal(calls.get('cached'), 1); assert.equal((await notifications.list(first.user.id, {})).total, firstCount);
  assert.equal((await jobs.list({ q: '', location: '', company: '', skill: '', source: 'greenhouse:cached', employmentType: '', remoteType: '', page: 1, limit: 20 })).total, 3);
  const publicSources = await (await request('/jobs/sources', '')).json(); assert.deepEqual(publicSources.sources, ['greenhouse:cached']);
});
test('missing jobs expire only after complete successful imports, and restored jobs regain their identity', async () => {
  feeds.set('reconcile', [job('old'), job('kept')]); const source = await sources.create(first.user.id, settings('reconcile'));
  await sources.refresh(first.user.id, source.id); const previous = await sources.matchingJobs(first.user.id, source.id, {}), old = previous.jobs.find(row => row.sourceId === 'old')!;
  feeds.set('reconcile', [job('kept'), job('new')]); const refresh = await sources.refresh(first.user.id, source.id); assert.equal(refresh.source.newCount, 1); assert.equal((await sources.matchingJobs(first.user.id, source.id, {})).total, 2); assert.ok((await jobs.get(old.id)).expiresAt);
  feeds.set('reconcile', [job('malformed', { company: '' })]); assert.equal((await sources.refresh(first.user.id, source.id)).failed, true); assert.equal((await sources.matchingJobs(first.user.id, source.id, {})).total, 2);
  feeds.set('reconcile', [job('old')]); await sources.refresh(first.user.id, source.id); assert.equal((await jobs.get(old.id)).expiresAt, null); assert.equal((await sources.matchingJobs(first.user.id, source.id, {})).jobs[0].id, old.id);
});
test('source failures notify once until recovery and preferences suppress future notices', async () => {
  const source = await sources.create(first.user.id, settings('failure')); failed.add('failure');
  const count = (await notifications.list(first.user.id, {})).total;
  assert.equal((await sources.refresh(first.user.id, source.id)).failed, true); await sources.refresh(first.user.id, source.id); assert.equal((await notifications.list(first.user.id, {})).total, count + 1);
  failed.delete('failure'); await sources.refresh(first.user.id, source.id); failed.add('failure'); await sources.refresh(first.user.id, source.id); assert.equal((await notifications.list(first.user.id, {})).total, count + 2);
  await notifications.updatePreferences(second.user.id, { newJobs: false, sourceErrors: false });
  feeds.set('muted', [job('muted')]); const muted = await sources.create(second.user.id, settings('muted')); await sources.refresh(second.user.id, muted.id); failed.add('muted'); await sources.refresh(second.user.id, muted.id);
  assert.equal((await notifications.list(second.user.id, {})).total, 0); assert.equal((await notifications.preferences(first.user.id)).newJobs, true);
});
test('notification retries persist across service restarts and deliveries are idempotent', async () => {
  deliveryFails = true; feeds.set('outbox', [job('outbox')]); const source = await sources.create(first.user.id, settings('outbox'));
  const beforeCount = (await notifications.list(first.user.id, {})).total; await sources.refresh(first.user.id, source.id); assert.equal((await notifications.list(first.user.id, {})).total, beforeCount);
  deliveryFails = false;
  const restarted = new CareerSourceStore(db, new JobStore(db), new NotificationService(new NotificationStore(db)), adapter);
  await restarted.refreshDue(); assert.equal((await notifications.list(first.user.id, {})).total, beforeCount + 1);
  const notice: Notice = { key: 'idempotent', type: 'NEW_JOBS', title: 'Test', message: 'Test message', href: '/career-sources' };
  await Promise.all([notifications.deliver(first.user.id, notice), notifications.deliver(first.user.id, notice)]);
  assert.equal((await notifications.list(first.user.id, {})).total, beforeCount + 2);
});
test('notification APIs keep counts, read state and preferences private', async () => {
  const list = await (await request('/notifications')).json(), id = list.notifications[0].id;
  assert.equal(list.notifications[0].ownerId, undefined); assert.equal(list.notifications[0].key, undefined);
  assert.equal((await request(`/notifications/${id}`, second.accessToken, 'PATCH', { read: true })).status, 404);
  assert.equal((await request(`/notifications/${id}`, first.accessToken, 'PATCH', { read: true })).status, 204);
  assert.equal((await (await request('/notifications?unread=true')).json()).unreadCount, list.unreadCount - 1);
  assert.equal((await request(`/notifications/${id}`, first.accessToken, 'PATCH', { read: false })).status, 204);
  assert.equal((await request(`/notifications/${id}`, first.accessToken, 'PATCH', { read: true, ownerId: second.user.id })).status, 400);
  assert.equal((await request('/notifications/preferences', first.accessToken, 'PATCH', { sourceErrors: false })).status, 200);
  assert.deepEqual(await notifications.preferences(first.user.id), { sourceErrors: false, newJobs: true });
  assert.equal((await request('/notifications/read-all', first.accessToken, 'POST', {})).status, 204); assert.equal((await (await request('/notifications')).json()).unreadCount, 0);
  assert.equal((await request('/notifications?limit=51')).status, 400);
});
test('a shared failed import reports failure to every subscriber instead of treating old data as fresh', async () => {
  const firstSource = await sources.create(first.user.id, settings('shared-failure'));
  const secondSource = await sources.create(second.user.id, settings('shared-failure'));
  failed.add('shared-failure');
  assert.equal((await sources.refresh(first.user.id, firstSource.id)).failed, true);
  assert.equal((await sources.refresh(second.user.id, secondSource.id)).failed, true);
  assert.equal(calls.get('shared-failure'), 1);
});
test('scheduled checks use persisted due times and skip paused/manual sources', async () => {
  const scheduled = await sources.create(first.user.id, settings('scheduled', { scanHours: 4 }));
  await sources.create(first.user.id, settings('scheduled-paused', { scanHours: 4, enabled: false }));
  await sources.refreshDue(); assert.equal(calls.get('scheduled'), 1); assert.equal(calls.get('scheduled-paused'), undefined);
  await sources.refreshDue(); assert.equal(calls.get('scheduled'), 1);
  await db.collection<{ _id: string; nextScanAt: Date }>('career_sources').updateOne({ _id: scheduled.id }, { $set: { nextScanAt: new Date(0) } });
  await sources.refreshDue(); assert.equal(calls.get('scheduled'), 2);
  assert.equal(calls.get('private'), undefined);
});
test('per-source leases block overlapping checks and discard results for changed settings', async () => {
  let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; });
  feeds.set('slow', [job('one')]); const source = await sources.create(first.user.id, settings('slow')); const started = sources.refresh(first.user.id, source.id);
  for (let i = 0; i < 100; i++) { if (calls.get('slow')) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  await assert.rejects(sources.refresh(first.user.id, source.id), { status: 409 });
  const newer = await sources.update(first.user.id, source.id, { ...settings('slow', { keywords: ['Designer'] }), revision: source.revision });
  const rejected = assert.rejects(started, { status: 409 }); release(); await rejected;
  assert.equal((await sources.matchingJobs(first.user.id, newer.id, {})).source.lastCheckedAt, null);
});
