import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRemotive, plainText, RemotiveSource } from '../src/jobs/sources.js';
import { parseSearch } from '../src/jobs/store.js';

const raw = { id: 42, url: 'https://remotive.com/remote-jobs/software-dev/example-42', title: ' Engineer ', company_name: 'Example', description: '<p>Build &amp; test</p><script>alert(1)</script>', publication_date: '2026-09-01T10:00:00', candidate_required_location: 'India', tags: ['Node.js', 'Node.js'], job_type: 'full_time' };
test('live-source normalization preserves provenance and maps fields without inventing missing values', () => {
  const job = normalizeRemotive({ jobs: [raw] })[0];
  assert.equal(job.sourceId, '42'); assert.equal(job.title, 'Engineer'); assert.equal(job.description, 'Build & test');
  assert.equal(job.employmentType, 'FULL_TIME'); assert.equal(job.remoteType, 'REMOTE');
  assert.deepEqual(job.skills, ['Node.js']); assert.equal(job.postedAt?.toISOString(), '2026-09-01T10:00:00.000Z');
  assert.equal(job.expiresAt, null);
  assert.equal(normalizeRemotive({ jobs: [{ ...raw, job_type: 'new_type' }] })[0].employmentType, 'UNKNOWN');
});
test('malformed feeds, invalid dates and unsafe links reject the whole batch', () => {
  for (const payload of [{}, { jobs: [{}] }, { jobs: [{ ...raw, url: 'javascript:alert(1)' }] }, { jobs: [{ ...raw, publication_date: 'invalid' }] }, { jobs: [{ ...raw, company_name: '' }] }]) assert.throws(() => normalizeRemotive(payload));
  assert.equal(plainText('<p>&#x41; &lt;img onerror=alert(1)&gt;</p>'), 'A <img onerror=alert(1)>');
});
test('search rejects unbounded pagination, repeated parameters and unknown filter values', () => {
  assert.equal(parseSearch({ page: '2', limit: '10', q: ' node ' }).q, 'node');
  for (const query of [{ page: '-1' }, { limit: '51' }, { page: '1e2' }, { q: ['a', 'b'] }, { remoteType: 'teleport' }, { q: 'a'.repeat(101) }]) assert.throws(() => parseSearch(query));
});
test('source adapter rejects HTTP failures and malformed JSON', async () => {
  await assert.rejects(new RemotiveSource(async () => new Response('{}', { status: 503 })).fetchJobs());
  await assert.rejects(new RemotiveSource(async () => new Response('not json')).fetchJobs());
  assert.equal((await new RemotiveSource(async () => new Response(JSON.stringify({ jobs: [raw] }))).fetchJobs()).length, 1);
});
