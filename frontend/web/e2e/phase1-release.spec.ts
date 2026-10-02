import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { type Job } from '../../../backend/platform/src/jobs/model.js';
import { test, expect } from '@playwright/test';

const marker = randomUUID(), email = `e2e-release-${marker}@example.com`;
const id = createHash('sha256').update(`phase1-release:${marker}`).digest('hex');
const title = `Release journey engineer ${marker}`, password = 'a release verification passphrase';
let client: MongoClient;
test.beforeAll(async () => {
  const uri = process.env.E2E_MONGODB_URI || readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^MONGODB_URI=(.+)$/m)?.[1]?.trim();
  if (!uri) throw new Error('Configure the application MongoDB URI for release browser tests.');
  client = new MongoClient(uri); const now = new Date();
  await client.db().collection<Job>('jobs').insertOne({ _id: id, sourceId: marker, source: 'fixture', title, company: 'Release Test Company', description: 'Temporary job for the complete Phase 1 journey.', location: 'India', employmentType: 'FULL_TIME', remoteType: 'REMOTE', skills: ['TypeScript'], sourceUrl: 'https://example.com/jobs/release-test', postedAt: now, expiresAt: null, metadata: {}, createdAt: now, updatedAt: now });
});
test.afterAll(async () => {
  if (!client) return;
  try { await client.db().collection<{ _id: string }>('jobs').deleteOne({ _id: id }); await client.db().collection('saved_jobs').deleteMany({ jobId: id }); }
  finally { await client.close(); }
});

test('Phase 1 journey persists profile, preferences, resume and saved job across sign-in', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Release Tester');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'View career profile', exact: true }).click();
  await page.getByRole('link', { name: 'Edit profile', exact: true }).click();
  await page.getByLabel('Headline').fill('Backend engineer');
  await page.getByLabel('Your skills').fill('TypeScript, MongoDB');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved.');

  await page.goto('/resumes');
  const document = await page.context().newPage();
  await document.setContent('<h1>Release Tester</h1><p>Backend engineer: TypeScript and MongoDB.</p>');
  const buffer = await document.pdf(); await document.close();
  await page.getByLabel('Resume file').setInputFiles({ name: 'release-resume.pdf', mimeType: 'application/pdf', buffer });
  await page.getByRole('button', { name: 'Upload resume', exact: true }).click();
  await expect(page.getByRole('article')).toContainText('Active resume');

  await page.goto('/profile/edit');
  await page.getByLabel('Preferred roles').fill('Backend engineer');
  await page.getByLabel('Preferred locations').fill('India');
  await page.getByLabel('Remote', { exact: true }).check();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved.');

  await page.goto('/jobs');
  await page.getByLabel('Search jobs', { exact: true }).fill(title);
  await page.getByLabel('Location', { exact: true }).fill('India');
  await page.getByLabel('Work mode').selectOption('REMOTE');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unsave job', exact: true })).toBeVisible();
  await page.goto('/saved-jobs');
  const savedCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await savedCard.getByLabel('Private notes').fill('Follow up after reviewing the role.');
  await savedCard.getByLabel('Interest status').selectOption('INTERESTED');
  await savedCard.getByLabel('Priority').selectOption('HIGH');
  await savedCard.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(savedCard.getByRole('status')).toHaveText('Changes saved.');

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: /^Continue as / }).click();
  await page.getByLabel('Email or username', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/profile/edit');
  await expect(page.getByLabel('Headline')).toHaveValue('Backend engineer');
  await expect(page.getByLabel('Your skills')).toHaveValue('TypeScript, MongoDB');
  await expect(page.getByLabel('Preferred roles')).toHaveValue('Backend engineer');
  await expect(page.getByLabel('Preferred locations')).toHaveValue('India');
  await expect(page.getByLabel('Remote', { exact: true })).toBeChecked();
  await page.goto('/resumes');
  await expect(page.getByRole('heading', { name: 'release-resume.pdf', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toContainText('Active resume');
  await page.goto('/saved-jobs');
  await expect(savedCard.getByRole('link', { name: title, exact: true })).toBeVisible();
  await page.reload();
  await expect(savedCard.getByRole('link', { name: title, exact: true })).toBeVisible();
  await expect(savedCard.getByLabel('Private notes')).toHaveValue('Follow up after reviewing the role.');
  await expect(savedCard.getByLabel('Interest status')).toHaveValue('INTERESTED');
  await expect(savedCard.getByLabel('Priority')).toHaveValue('HIGH');

  await page.goto('/resumes'); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No resumes uploaded yet.', { exact: true })).toBeVisible();
  await page.goto('/dashboard'); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
