import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { createApp } from '../src/app.js';
import { AuthStore } from '../src/auth/store.js';
import { AuthService } from '../src/auth/service.js';
import { Tokens } from '../src/auth/tokens.js';
import { ResumeStore } from '../src/resumes/store.js';
import { LocalResumeStorage } from '../src/resumes/storage.js';
import { IntelligenceClient } from '../src/intelligence/client.js';

if (!process.env.TEST_MONGODB_URI) throw new Error('Set TEST_MONGODB_URI to run integration tests.');
const mongo = new MongoClient(process.env.TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
const db = mongo.db(`careeros_intelligence_test_${randomUUID().replaceAll('-', '')}`);
const authStore = new AuthStore(db);
const auth = new AuthService(authStore, new Tokens(randomBytes(32).toString('hex')));
const serviceToken = randomBytes(32).toString('hex');
const pdf = Buffer.from('%PDF-1.4\nfixture bytes\n%%EOF');
const extraction = { schemaVersion: 1, parser: { name: 'pypdf', version: '6.19.0' }, status: 'extracted', pageCount: 1, pages: [{ number: 1, text: 'Engineer Ω' }], text: 'Engineer Ω', warnings: [] };
let directory: string;
let resumes: ResumeStore;
let upstream: Server;
let server: Server;
let base: string;
let upstreamBase: string;
let calls = 0;
let mode: 'ok' | 'credentials' | 'invalid' | 'busy' = 'ok';
let beforeReply: (() => Promise<void>) | undefined;
let cancellationObserved = false;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'careeros-extraction-'));
  resumes = new ResumeStore(db, new LocalResumeStorage(directory));
  await authStore.initialize();
  upstream = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${serviceToken}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/internal/v1/ready') { res.end(JSON.stringify({ status: 'ready' })); return; }
    calls++;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), pdf);
    assert.equal(req.headers['content-type'], 'application/pdf');
    assert.match(String(req.headers['x-request-id']), /^[a-f0-9-]{36}$/);
    res.on('close', () => { if (!res.writableEnded) cancellationObserved = true; });
    if (beforeReply) await beforeReply();
    res.statusCode = mode === 'credentials' ? 401 : mode === 'busy' ? 503 : 200;
    res.end(JSON.stringify(mode === 'credentials' ? { error: { code: 'UNAUTHENTICATED', message: 'secret' } } : mode === 'busy' ? { error: { code: 'INTELLIGENCE_BUSY', message: 'secret' } } : mode === 'invalid' ? { ...extraction, text: 'inconsistent' } : extraction));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  server = createApp(async () => {}, { service: auth, allowedOrigins: ['http://localhost:5173'], secureCookie: false }, undefined, resumes, undefined, undefined, undefined,
    new IntelligenceClient({ url: upstreamBase, token: serviceToken })).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(async () => {
  for (const instance of [server, upstream]) if (instance) await new Promise<void>(resolve => { instance.close(() => resolve()); instance.closeAllConnections(); });
  await db.dropDatabase(); await mongo.close(); await rm(directory, { recursive: true, force: true });
});
async function account() {
  const login = await auth.register({ name: 'Extraction Tester', email: `${randomUUID()}@example.com`, password: 'an extraction test password' });
  const library = await resumes.upload(login.user.id, 'resume.pdf', pdf);
  return { ...login, id: library.resumes[0].id };
}
function request(token: string, id: string, body: unknown = {}, options: RequestInit = {}) {
  return fetch(`${base}/intelligence/resumes/${id}/extract`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options });
}

test('extraction requires a valid live session and rejects foreign/deleting/missing resumes before calling Python', async () => {
  const owner = await account(); const other = await account();
  await authStore.users.updateOne({ _id: other.user.id }, { $set: { roles: ['ADMIN'] } });
  const initial = calls;
  assert.equal((await request('', owner.id)).status, 401);
  assert.equal((await request(other.accessToken, owner.id)).status, 404);
  assert.equal((await request(owner.accessToken, randomUUID())).status, 404);
  await db.collection<{ _id: string }>('resume_libraries').updateOne({ _id: owner.user.id }, { $set: { 'items.0.deleting': true } });
  assert.equal((await request(owner.accessToken, owner.id)).status, 404);
  await auth.logout(other.refreshToken);
  assert.equal((await request(other.accessToken, other.id)).status, 401);
  assert.equal(calls, initial);
});

test('gateway rejects caller data and binds a validated result to the owned immutable PDF', async () => {
  const owner = await account();
  for (const body of [{ ownerId: owner.user.id }, { url: upstreamBase }, { text: 'pretend resume' }, [], null]) assert.equal((await request(owner.accessToken, owner.id, body)).status, 400);
  const response = await request(owner.accessToken, owner.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ...extraction, source: { resumeId: owner.id, resumeVersion: 1, sha256: createHash('sha256').update(pdf).digest('hex') } });
  assert.deepEqual((await resumes.download(owner.user.id, owner.id)).data, pdf);
});

test('feature availability, bad internal credentials, busy and invalid responses leave the core app usable', async () => {
  const owner = await account();
  const status = await fetch(`${base}/intelligence/status`, { headers: { Authorization: `Bearer ${owner.accessToken}` } });
  assert.deepEqual(await status.json(), { resumeExtraction: { configured: true, available: true } });
  for (const [nextMode, statusCode, code] of [['credentials', 503, 'INTELLIGENCE_UNAVAILABLE'], ['invalid', 502, 'INTELLIGENCE_RESPONSE_INVALID'], ['busy', 503, 'INTELLIGENCE_BUSY']] as const) {
    mode = nextMode;
    const response = await request(owner.accessToken, owner.id);
    assert.equal(response.status, statusCode);
    const body = await response.json();
    assert.equal(body.error.code, code); assert.equal(body.error.requestId, response.headers.get('x-request-id'));
    assert.equal(JSON.stringify(body).includes('secret'), false);
    if (nextMode === 'busy') assert.equal(response.headers.get('retry-after'), '5');
  }
  mode = 'ok';
  assert.equal((await fetch(`${base}/ready`)).status, 200);
  assert.equal((await fetch(`${base}/users/me`, { headers: { Authorization: `Bearer ${owner.accessToken}` } })).status, 200);
});

test('deleting the source during extraction suppresses the stale result', async () => {
  const owner = await account();
  beforeReply = async () => { await resumes.remove(owner.user.id, owner.id); };
  try { assert.equal((await request(owner.accessToken, owner.id)).status, 404); }
  finally { beforeReply = undefined; }
});

test('browser cancellation aborts the upstream request', async () => {
  const owner = await account();
  cancellationObserved = false;
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  beforeReply = async () => { started(); await pending; };
  const controller = new AbortController();
  const response = request(owner.accessToken, owner.id, {}, { signal: controller.signal });
  await begun;
  controller.abort();
  await assert.rejects(response);
  for (let i = 0; i < 100 && !cancellationObserved; i++) await new Promise(resolve => setTimeout(resolve, 10));
  release(); beforeReply = undefined;
  assert.equal(cancellationObserved, true);
});

test('extraction throttles per user and includes a retry delay', async () => {
  const owner = await account();
  for (let i = 0; i < 10; i++) assert.equal((await request(owner.accessToken, owner.id)).status, 200);
  const limited = await request(owner.accessToken, owner.id);
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  const other = await account();
  assert.equal((await request(other.accessToken, other.id)).status, 200);
});
