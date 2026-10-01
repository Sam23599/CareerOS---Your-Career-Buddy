import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { type Job } from '../../../backend/platform/src/jobs/model.js';
import { test, expect } from '@playwright/test';

const marker = randomUUID(), board = `e2e-${marker}`, source = `greenhouse:${board}`, email = `e2e-${marker}@example.com`;
const company = `Dream Company ${marker}`, title = `C++ Engineer ${marker}`;
const ids = ['india', 'usa'].map(id => createHash('sha256').update(`${source}\0${id}`).digest('hex'));
let client: MongoClient;
test.beforeAll(async () => {
  const uri = process.env.E2E_MONGODB_URI || readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^MONGODB_URI=(.+)$/m)?.[1]?.trim();
  if (!uri) throw new Error('Configure the application MongoDB URI for browser tests.');
  client = new MongoClient(uri); const now = new Date();
  await client.db().collection<Job>('jobs').insertMany(ids.map((id, index) => ({ _id: id, sourceId: index ? 'usa' : 'india', source, title, company: 'Official Browser Company', description: 'A temporary test vacancy.', location: index ? 'USA' : 'India', employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', skills: [], sourceUrl: 'https://example.com/jobs/test', postedAt: null, expiresAt: null, metadata: {}, createdAt: now, updatedAt: now })));
  // A successful cached import exercises real matching/notification APIs without provider calls.
  await client.db().collection<{ _id: string }>('job_ingestion_runs').insertOne({ _id: source, status: 'success', startedAt: now, finishedAt: now, nextAllowedAt: new Date(now.getTime() + 3_600_000), imported: 2 });
});
test.afterAll(async () => {
  if (!client) return;
  try {
    const db = client.db(), user = await db.collection<{ _id: string; email: string }>('users').findOne({ email });
    if (user) {
      await db.collection('career_sources').deleteMany({ ownerId: user._id }); await db.collection('notifications').deleteMany({ ownerId: user._id });
      await db.collection<{ _id: string }>('notification_preferences').deleteOne({ _id: user._id });
    }
    await db.collection<Job>('jobs').deleteMany({ _id: { $in: ids } }); await db.collection('saved_jobs').deleteMany({ jobId: { $in: ids } });
    await db.collection<{ _id: string }>('job_ingestion_runs').deleteOne({ _id: source });
  } finally { await client.close(); }
});
test('manage career sources, check matches, save jobs and control in-app notifications', async ({ page }) => {
  await page.goto('/career-sources'); await expect(page).toHaveURL(/\/login$/);
  await page.goto('/notifications'); await expect(page).toHaveURL(/\/login$/);
  await page.goto('/register'); await page.getByLabel('Your name').fill('Career Sources Tester'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill('a source browser passphrase'); await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'Career sources', exact: true }).click(); await page.getByRole('button', { name: 'Add career source' }).click();
  await page.getByLabel('Company name').fill(company); await page.getByLabel('Career page URL').fill(`https://boards.greenhouse.io/${board}`); await page.getByLabel('Keywords', { exact: true }).fill('C++'); await page.getByLabel('Locations', { exact: true }).fill('India'); await page.getByLabel('Check frequency').selectOption('0'); await page.getByRole('button', { name: 'Save career source', exact: true }).click();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: company, exact: true }) });
  await expect(card).toContainText('refresh supported'); await card.getByRole('button', { name: 'Check now' }).click(); await expect(card.getByRole('status')).toContainText('cached import'); await expect(card).toContainText('1 matches, 1 newly found');
  await card.getByRole('button', { name: 'Check now' }).click(); await expect(card).toContainText('1 matches, 0 newly found');
  await card.getByRole('link', { name: 'View matching jobs' }).click(); await expect(page.getByText('1 matching job', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Save job', exact: true }).click(); await expect(page.getByRole('button', { name: 'Unsave job', exact: true })).toBeVisible();
  await page.goto(`/jobs?source=${encodeURIComponent(source)}`); await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue(source); await expect(page.getByText('2 jobs found', { exact: true })).toBeVisible();
  await page.goto('/notifications'); await expect(page.getByText('1 unread · 1 notifications in this view', { exact: true })).toBeVisible();
  const notice = page.getByRole('article'); await notice.getByRole('button', { name: 'Mark as read', exact: true }).click(); await expect(page.getByText('0 unread · 1 notifications in this view', { exact: true })).toBeVisible(); await notice.getByRole('button', { name: 'Mark as unread', exact: true }).click(); await expect(page.getByText('1 unread · 1 notifications in this view', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click(); await page.getByRole('button', { name: 'Show unread only' }).click(); await expect(page.getByRole('article')).toHaveCount(0); await page.getByRole('button', { name: 'Show all notifications' }).click(); await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('New matching jobs', { exact: true }).uncheck(); await page.getByRole('button', { name: 'Save notification preferences' }).click(); await expect(page.getByRole('status')).toHaveText('Notification preferences saved.'); await page.reload(); await expect(page.getByLabel('New matching jobs', { exact: true })).not.toBeChecked();
  await page.goto('/career-sources'); await card.getByRole('button', { name: 'Edit source' }).click(); await page.getByLabel('Keywords', { exact: true }).fill('Designer'); await page.getByRole('button', { name: 'Save source changes' }).click(); await expect(card).toContainText('Keywords: Designer'); await page.reload(); await expect(card).toContainText('Keywords: Designer');
  await page.getByRole('button', { name: 'Add career source' }).click(); await page.getByLabel('Company name').fill('Link-only Company'); await page.getByLabel('Career page URL').fill('https://example.com/careers'); await expect(page.getByLabel('Check frequency')).toBeDisabled(); await page.getByRole('button', { name: 'Save career source', exact: true }).click();
  const link = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Link-only Company', exact: true }) }); await expect(link).toContainText('refresh not supported yet'); await expect(link.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  await page.getByLabel('Search companies').fill('Link-only'); await page.getByRole('button', { name: 'Filter sources' }).click(); await expect(page.getByRole('article')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept()); await link.getByRole('button', { name: 'Remove source' }).click(); await expect(page.getByRole('article')).toHaveCount(0);
  await page.goto('/career-sources'); page.once('dialog', dialog => dialog.accept()); await card.getByRole('button', { name: 'Remove source' }).click(); await expect(page.getByRole('article')).toHaveCount(0);
  await page.goto('/dashboard'); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
});
