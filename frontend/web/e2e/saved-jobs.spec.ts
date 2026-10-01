import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { type Job } from '../../../backend/platform/src/jobs/model.js';
import { test, expect } from '@playwright/test';

const marker = randomUUID();
const id = createHash('sha256').update(marker).digest('hex');
const title = `Saved Job Test ${marker}`;
let client: MongoClient;
test.beforeAll(async () => {
  const localUri = process.env.E2E_MONGODB_URI ? undefined : readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^MONGODB_URI=(.+)$/m)?.[1]?.trim();
  const uri = process.env.E2E_MONGODB_URI || localUri;
  if (!uri) throw new Error('Set E2E_MONGODB_URI or configure MONGODB_URI in .env for saved-job browser tests.');
  client = new MongoClient(uri);
  await client.db().collection<Job>('jobs').insertOne({ _id: id, sourceId: marker, source: 'fixture', title, company: 'Browser Test Company', description: 'Temporary browser-test vacancy.', location: 'India', employmentType: 'FULL_TIME', remoteType: 'REMOTE', skills: ['TypeScript'], sourceUrl: 'https://example.com/jobs/test', postedAt: new Date(), expiresAt: null, metadata: {}, createdAt: new Date(), updatedAt: new Date() });
});
test.afterAll(async () => {
  if (!client) return;
  try { await client.db().collection<{ _id: string }>('jobs').deleteOne({ _id: id }); await client.db().collection('saved_jobs').deleteMany({ jobId: id }); }
  finally { await client.close(); }
});
test('save from search, edit private metadata, detect conflicts and unsave from detail', async ({ page, context }) => {
  await page.goto('/saved-jobs'); await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/jobs?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole('link', { name: 'Sign in to save jobs' })).toBeVisible();
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Saved Jobs Tester');
  await page.getByLabel('Email', { exact: true }).fill(`e2e-${marker}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a saved job browser passphrase');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/jobs?q=${encodeURIComponent(title)}`);
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await page.getByRole('link', { name: 'Manage saved jobs' }).click();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });
  await card.getByLabel('Private notes').fill('Ask about the engineering team.');
  await card.getByLabel('Interest status').selectOption('INTERESTED');
  await card.getByLabel('Priority').selectOption('HIGH');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByRole('status')).toHaveText('Changes saved.');
  await page.reload();
  await expect(card.getByLabel('Private notes')).toHaveValue('Ask about the engineering team.');
  await expect(card.getByLabel('Interest status')).toHaveValue('INTERESTED');
  await expect(card.getByLabel('Priority')).toHaveValue('HIGH');
  const second = await context.newPage(); await second.goto('/saved-jobs');
  await expect(second.getByLabel('Private notes')).toHaveValue('Ask about the engineering team.');
  await card.getByLabel('Private notes').fill('Newer note');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByRole('status')).toHaveText('Changes saved.');
  await second.getByLabel('Private notes').fill('Stale draft');
  await second.getByRole('button', { name: 'Save changes' }).click();
  await expect(second.getByRole('alert')).toContainText('changed or removed');
  await expect(second.getByLabel('Private notes')).toHaveValue('Stale draft');
  second.once('dialog', dialog => dialog.accept());
  await second.getByRole('button', { name: 'Reload saved job' }).click();
  await expect(second.getByLabel('Private notes')).toHaveValue('Newer note'); await second.close();
  await page.getByLabel('Filter by priority').selectOption('HIGH');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(card).toBeVisible();
  await card.getByRole('link', { name: title, exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Unsave job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save job', exact: true })).toBeVisible();
  await page.goto('/saved-jobs');
  await expect(page.getByText('No saved jobs match this view.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard', exact: false }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
});
