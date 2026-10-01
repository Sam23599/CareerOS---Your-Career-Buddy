import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GreenhouseSource, greenhouseBoard, normalizeGreenhouse } from '../src/career-sources/greenhouse.js';
import { parseSource } from '../src/career-sources/store.js';
import { parsePreferences } from '../src/notifications/store.js';

const input = { company: ' Dream Co ', careerUrl: 'https://boards.greenhouse.io/dream/', keywords: [' Engineer ', 'Engineer'], locations: ['India'], scanHours: 4, enabled: true };
test('career-source validation canonicalizes supported boards and keeps other pages as links', () => {
  const source = parseSource(input);
  assert.equal(source.company, 'Dream Co'); assert.equal(source.board, 'dream'); assert.equal(source.careerUrl, 'https://job-boards.greenhouse.io/dream'); assert.deepEqual(source.keywords, ['Engineer']);
  assert.equal(parseSource({ ...input, careerUrl: 'https://example.com/careers', scanHours: 0 }).board, null);
  for (const url of ['https://boards.greenhouse.io.attacker.com/dream', 'https://boards.greenhouse.io/dream/jobs/42', 'https://boards.greenhouse.io/dream?x=1']) assert.equal(greenhouseBoard(new URL(url)), null);
  for (const changes of [{ careerUrl: 'javascript:alert(1)' }, { careerUrl: 'https://user:pass@example.com/careers' }, { careerUrl: 'https://example.com/careers' }, { scanHours: 3 }, { enabled: 'yes' }, { keywords: [''] }, { locations: Array(31).fill('India') }, { ownerId: 'someone-else' }]) assert.throws(() => parseSource({ ...input, ...changes }));
});
const raw = { id: 42, title: ' Engineer ', absolute_url: 'https://job-boards.greenhouse.io/dream/jobs/42', location: { name: 'India' }, content: '&lt;p&gt;Build &amp;amp; test&lt;/p&gt;' };
test('Greenhouse normalization rejects partial feeds and leaves unavailable job fields unknown', () => {
  const [job] = normalizeGreenhouse({ jobs: [raw], meta: { total: 1 } }, 'Dream Co');
  assert.equal(job.title, 'Engineer'); assert.equal(job.description, 'Build & test'); assert.equal(job.sourceId, '42'); assert.equal(job.location, 'India');
  assert.equal(job.postedAt, null); assert.equal(job.remoteType, 'UNKNOWN'); assert.equal(job.employmentType, 'UNKNOWN'); assert.deepEqual(job.skills, []);
  for (const payload of [{ jobs: [raw] }, { jobs: [raw], meta: { total: 2 } }, { jobs: [{ ...raw, id: -1 }], meta: { total: 1 } }, { jobs: [{ ...raw, absolute_url: 'javascript:alert(1)' }], meta: { total: 1 } }]) assert.throws(() => normalizeGreenhouse(payload, 'Dream Co'));
});
test('Greenhouse uses a fixed public endpoint, forbids redirects and rejects provider errors', async () => {
  const calls: string[] = [];
  const adapter = new GreenhouseSource('dream', async (url, options) => {
    calls.push(String(url)); assert.equal(options?.redirect, 'error'); assert.ok(options?.signal);
    return new Response(JSON.stringify(String(url).includes('/jobs?') ? { jobs: [raw], meta: { total: 1 } } : { name: 'Official Co' }));
  });
  assert.equal((await adapter.fetchJobs())[0].company, 'Official Co');
  assert.deepEqual(calls, ['https://boards-api.greenhouse.io/v1/boards/dream', 'https://boards-api.greenhouse.io/v1/boards/dream/jobs?content=true']);
  assert.throws(() => new GreenhouseSource('../invalid'));
  await assert.rejects(new GreenhouseSource('dream', async () => new Response('{}', { status: 404 })).fetchJobs());
  await assert.rejects(new GreenhouseSource('dream', async () => new Response('not json')).fetchJobs());
});
test('notification preferences accept only the supported boolean settings', () => {
  assert.deepEqual(parsePreferences({ newJobs: false }), { newJobs: false });
  for (const value of [{}, [], null, { newJobs: 1 }, { sourceErrors: 'true' }, { ownerId: 'other' }]) assert.throws(() => parsePreferences(value));
});
