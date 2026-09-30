import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyProfile } from '../src/profiles/model.js';
import { parseProfilePatch } from '../src/profiles/validation.js';

const experience = { company: 'Company', role: 'Engineer', location: '', startDate: '2024-01', endDate: '', current: true, description: '' };

test('profile validation trims fields, deduplicates skills, and preserves explicit clearing', () => {
  const result = parseProfilePatch({ version: 0, headline: ' Engineer ', skills: [' Python ', 'python', 'React'], links: [], summary: '' });
  assert.deepEqual(result, { version: 0, changes: { headline: 'Engineer', skills: ['Python', 'React'], links: [], summary: '' } });
  assert.equal('fullName' in result.changes, false);
});

test('profile validation rejects ownership, authentication, update operators, and unknown nested fields', () => {
  for (const body of [null, [], {}, { version: 0 }, { version: -1, headline: '' }, { version: 0, userId: 'other' }, { version: 0, roles: ['ADMIN'] }, { version: 0, email: 'other@example.com' }, { version: 0, $set: { headline: 'bad' } }, { version: 0, preferences: { ...emptyProfile('Name').preferences, admin: true } }]) {
    assert.throws(() => parseProfilePatch(body));
  }
});

test('profile validation enforces required names, bounded lists, and valid date ranges', () => {
  for (const body of [
    { fullName: ' ' }, { skills: Array(51).fill('skill') }, { experience: [{ ...experience, startDate: '2024-13' }] },
    { experience: [{ ...experience, current: false }] }, { experience: [{ ...experience, endDate: '2025-01' }] },
    { experience: [{ ...experience, current: false, endDate: '2023-01' }] },
    { education: [{ institution: 'School', qualification: '', field: '', startDate: '2020-01', endDate: '' }] },
  ]) assert.throws(() => parseProfilePatch({ version: 0, ...body }));
  assert.equal(parseProfilePatch({ version: 0, experience: [experience] }).changes.experience![0].current, true);
});

test('salary validation rejects inverted ranges, non-numbers, and missing currency', () => {
  const base = emptyProfile('Name').preferences;
  for (const change of [{ salaryMin: 20, salaryMax: 10, currency: 'USD' }, { salaryMin: -1 }, { salaryMin: 100 }, { salaryMin: '100' }, { workModes: ['ANYWHERE'] }]) {
    assert.throws(() => parseProfilePatch({ version: 0, preferences: { ...base, ...change } }));
  }
  const result = parseProfilePatch({ version: 0, preferences: { ...base, salaryMin: 0, salaryMax: 5000, currency: 'inr', workModes: ['REMOTE', 'REMOTE'] } });
  assert.equal(result.changes.preferences!.currency, 'INR');
  assert.deepEqual(result.changes.preferences!.workModes, ['REMOTE']);
});

test('professional links and credentials accept only HTTP(S) URLs without embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'https://user:password@example.com', 'not a url']) {
    assert.throws(() => parseProfilePatch({ version: 0, links: [{ label: 'Portfolio', url }] }));
  }
  const result = parseProfilePatch({ version: 0, links: [{ label: 'GitHub', url: 'https://github.com/example' }] });
  assert.equal(result.changes.links![0].url, 'https://github.com/example');
});
