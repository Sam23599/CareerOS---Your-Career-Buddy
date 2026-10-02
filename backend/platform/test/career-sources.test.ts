import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GreenhouseSource, greenhouseBoard, normalizeGreenhouse } from '../src/career-sources/greenhouse.js';
import { parseSource, parseCheckFilters } from '../src/career-sources/store.js';
import { parsePreferences } from '../src/notifications/store.js';
import { GoogleCareersSource, googleCareersUrl, normalizeGoogle } from '../src/career-sources/google.js';
import { sourceSupport } from '../src/career-sources/registry.js';

const input = { kind: 'job-source', company: ' Dream Co ', careerUrl: 'https://boards.greenhouse.io/dream/', keywords: [' Engineer ', 'Engineer'], locations: ['India'], scanHours: 4, enabled: true };
test('job-source validation requires native support and canonicalizes supported boards', () => {
  const source = parseSource(input);
  assert.equal(source.company, 'Dream Co'); assert.equal(source.connection?.key, 'dream'); assert.equal(source.careerUrl, 'https://job-boards.greenhouse.io/dream'); assert.deepEqual(source.keywords, ['Engineer']);
  for (const url of ['https://boards.greenhouse.io.attacker.com/dream', 'https://boards.greenhouse.io/dream/jobs/42', 'https://boards.greenhouse.io/dream?x=1']) assert.equal(greenhouseBoard(new URL(url)), null);
  for (const changes of [{ kind: undefined }, { kind: 'unknown' }, { careerUrl: 'javascript:alert(1)' }, { careerUrl: 'https://user:pass@example.com/careers' }, { careerUrl: 'https://example.com/careers', scanHours: 0 }, { scanHours: 3 }, { enabled: 'yes' }, { keywords: [''] }, { locations: Array(31).fill('India') }, { ownerId: 'someone-else' }]) assert.throws(() => parseSource({ ...input, ...changes }));
});
test('bookmarks need only a name and HTTPS URL and cannot accept tracking settings', () => {
  const body = { kind: 'bookmark', company: ' Dream Co ', careerUrl: 'https://example.com/careers?q=Engineer#jobs' };
  const source = parseSource(body);
  assert.equal(source.kind, 'bookmark'); assert.equal(source.company, 'Dream Co'); assert.equal(source.careerUrl, 'https://example.com/careers?q=Engineer'); assert.equal(source.connection, null);
  assert.equal(source.enabled, false); assert.equal(source.scanHours, 0); assert.deepEqual(source.keywords, []);
  const native = parseSource({ ...body, careerUrl: 'https://careers.google.com/' }); assert.equal(native.kind, 'bookmark'); assert.equal(native.connection?.provider, 'google-careers'); assert.equal(native.careerUrl, 'https://careers.google.com/');
  for (const changes of [{ keywords: [] }, { locations: [] }, { scanHours: 4 }, { enabled: true }, { ownerId: 'other' }, { careerUrl: 'http://example.com/careers' }]) assert.throws(() => parseSource({ ...body, ...changes }));
});
test('optional check filters validate bounded literal tags without accepting source settings', () => {
  for (const body of [undefined, {}, { filters: {} }]) assert.equal(parseCheckFilters(body), undefined);
  assert.deepEqual(parseCheckFilters({ filters: { keywords: [' C++ ', 'C++'], locations: [] } }), { keywords: ['C++'], locations: [] });
  assert.deepEqual(parseCheckFilters({ filters: { locations: ['India'] } }), { locations: ['India'] });
  for (const body of [null, [], { keywords: ['Engineer'] }, { ownerId: 'other' }, { filters: null }, { filters: [] }, { filters: { enabled: true } }, { filters: { keywords: 'Engineer' } }, { filters: { keywords: [''] } }, { filters: { locations: Array(31).fill('India') } }, { filters: { keywords: ['x'.repeat(101)] } }]) assert.throws(() => parseCheckFilters(body));
});
test('source detection shares canonical identities and clearly distinguishes limited and link coverage', () => {
  for (const url of [googleCareersUrl, 'https://careers.google.com/', 'https://www.google.com/about/careers/applications/jobs/results?page=9&q=Engineer#jobs']) {
    const support = sourceSupport(url);
    assert.equal(support.sourceId, 'google-careers'); assert.equal(support.careerUrl, googleCareersUrl); assert.equal(support.coverage, 'limited'); assert.equal(support.canRefresh, true); assert.match(support.message, /first 20 unfiltered/);
    assert.equal(parseSource({ ...input, careerUrl: url }).connection?.provider, 'google-careers');
  }
  for (const url of ['https://www.google.com.attacker.com/about/careers', 'https://example.com/careers', `${googleCareersUrl}123-job`, 'https://www.google.com:8443/about/careers']) {
    assert.equal(sourceSupport(url).canRefresh, false); assert.equal(sourceSupport(url).coverage, 'link');
  }
  assert.equal(sourceSupport(input.careerUrl).coverage, 'complete');
  for (const value of [undefined, ['https://example.com'], 'javascript:alert(1)', 'https://user:secret@example.com']) assert.throws(() => sourceSupport(value));
  assert.throws(() => parseSource({ ...input, connection: { sourceId: 'injected' } }));
});

// Minimal public-listing contract fixture, with unrelated sign-in URLs deliberately present.
const googleRow = ['123', ' Software Engineer ', 'https://www.google.com/signin?jobId=private', [null, '<p>Build tools.</p>'], [null, '<p>Qualifications</p>'], null, null, 'Google', null, [['Bengaluru, India']], [null, '<p>About the role.</p>'], null, null, null, null, null];
function googleHtml(rows = [googleRow], total = rows.length) {
  return `<script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([rows, null, total, 20])}, sideChannel: {}});</script>${rows.map(row => `<a href="jobs/results/${row[0]}-software-engineer?page=1">Role</a>`).join('')}`;
}
test('Google normalizes a partial public snapshot without guessing dates, type or availability', () => {
  const [job] = normalizeGoogle(googleHtml());
  assert.equal(job.title, 'Software Engineer'); assert.equal(job.company, 'Google'); assert.equal(job.location, 'Bengaluru, India'); assert.match(job.description, /Build tools/);
  assert.equal(job.sourceUrl, `${googleCareersUrl}123-software-engineer`); assert.equal(job.postedAt, null); assert.equal(job.expiresAt, null); assert.equal(job.employmentType, 'UNKNOWN'); assert.equal(job.remoteType, 'UNKNOWN'); assert.deepEqual(job.metadata, { coverage: 'limited' });
  assert.deepEqual(normalizeGoogle(googleHtml([], 0)), []);
  for (const html of ['<html>Consent page</html>', googleHtml().replace("'ds:1'", "'ds:2'"), googleHtml().replace('jobs/results/123', 'jobs/results/999'), googleHtml([googleRow], 100), googleHtml([[...googleRow.slice(0, 9), ['invalid location']]]), googleHtml().replace('data:[', 'data:alert(1)||[')]) assert.throws(() => normalizeGoogle(html));
});
test('Google fetches only the fixed unpaginated public page and rejects failed or oversized responses', async () => {
  const calls: string[] = [];
  const adapter = new GoogleCareersSource(async (url, options) => { calls.push(String(url)); assert.equal(options?.redirect, 'error'); assert.ok(options?.signal); return new Response(googleHtml()); });
  assert.equal((await adapter.fetchJobs()).length, 1); assert.deepEqual(calls, [googleCareersUrl]); assert.equal(adapter.reconcileMissing, false);
  await assert.rejects(new GoogleCareersSource(async () => new Response('error', { status: 403 })).fetchJobs());
  await assert.rejects(new GoogleCareersSource(async () => new Response('x'.repeat(20 * 1024 * 1024 + 1))).fetchJobs(), /too large/);
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
