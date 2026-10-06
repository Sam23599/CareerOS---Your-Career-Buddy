import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JobMetadataNormalizer } from '../src/jobs/normalizer.js';
import { type JobInput } from '../src/jobs/model.js';
const input: JobInput = { sourceId: '1', title: 'Engineer', company: 'Example', description: '', location: '', employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', skills: [], sourceUrl: 'https://example.com/job', postedAt: null, expiresAt: null, metadata: {} };
test('missing metadata is derived conservatively and retains provenance', () => {
  const job = new JobMetadataNormalizer().normalize({ ...input, description: 'Full-time role. Fully remote. TypeScript and C++ required.' });
  assert.equal(job.employmentType, 'FULL_TIME'); assert.equal(job.remoteType, 'REMOTE');
  assert.deepEqual(job.skills, ['TypeScript', 'C++']); assert.equal(job.skills.includes('Java'), false);
  assert.deepEqual(job.metadata.inferredFields, ['skills', 'employmentType', 'remoteType']);
  assert.deepEqual(new JobMetadataNormalizer().normalize(job), job);
});
test('explicit values win and conflicting work modes stay unknown', () => {
  const normalizer = new JobMetadataNormalizer();
  assert.equal(normalizer.normalize({ ...input, remoteType: 'ONSITE', description: 'Fully remote work available elsewhere.' }).remoteType, 'ONSITE');
  assert.equal(normalizer.normalize({ ...input, description: 'Hybrid work and remote work options.' }).remoteType, 'UNKNOWN');
  assert.equal(normalizer.normalize({ ...input, description: 'Not remote work. This role is not remote.' }).remoteType, 'UNKNOWN');
  assert.equal(normalizer.normalize({ ...input, description: 'Competitive benefits. Flexible working.' }).employmentType, 'UNKNOWN');
});

test('contact discovery uses published listing emails without inventing recruiter identity', () => {
  const job = new JobMetadataNormalizer().normalize({ ...input, description: 'Contact jobs@example.com. Alternatively jobs@example.com.' });
  assert.deepEqual(job.metadata.contactEmails, ['jobs@example.com']);
  assert.deepEqual(new JobMetadataNormalizer().normalize(input).metadata.contactEmails, []);
});
