import assert from 'node:assert/strict';
import { once } from 'node:events';
import { type AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

async function withApp(checkDatabase: () => Promise<void>, run: (url: string) => Promise<void>) {
  const server = createApp(checkDatabase).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

test('liveness stays up during a database outage; readiness recovers', async () => {
  let available = false;
  await withApp(async () => { if (!available) throw new Error('private connection details'); }, async url => {
    const health = await fetch(`${url}/api/v1/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', service: 'platform' });

    const unavailable = await fetch(`${url}/api/v1/ready`);
    assert.equal(unavailable.status, 503);
    const body = await unavailable.json();
    assert.equal(body.checks.mongodb, 'down');
    assert.equal(body.error.requestId, unavailable.headers.get('x-request-id'));
    assert.equal(JSON.stringify(body).includes('private connection details'), false);
    assert.equal(unavailable.headers.get('cache-control'), 'no-store');

    available = true;
    const ready = await fetch(`${url}/api/v1/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready', checks: { mongodb: 'up' } });
  });
});

test('unknown routes and invalid JSON use structured errors and request IDs', async () => {
  await withApp(async () => {}, async url => {
    const missing = await fetch(`${url}/api/v1/missing`);
    assert.equal(missing.status, 404);
    const body = await missing.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(body.error.requestId, missing.headers.get('x-request-id'));

    const malformed = await fetch(`${url}/api/v1/health`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
    assert.notEqual(malformed.headers.get('x-request-id'), missing.headers.get('x-request-id'));

    const oversized = await fetch(`${url}/api/v1/health`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(110_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, 'PAYLOAD_TOO_LARGE');
  });
});

test('configuration requires MongoDB and rejects invalid ports', () => {
  assert.throws(() => readConfig({}), /MONGODB_URI/);
  assert.throws(() => readConfig({ MONGODB_URI: 'https://example.com' }), /MONGODB_URI/);
  for (const port of ['0', '65536', 'abc', '1.5', '']) {
    assert.throws(() => readConfig({ API_PORT: port, MONGODB_URI: 'mongodb://localhost/careeros' }), /API_PORT/);
  }
  assert.equal(readConfig({ MONGODB_URI: 'mongodb://localhost/careeros', AUTH_SECRET: 'ab'.repeat(32) }).port, 3000);
});
