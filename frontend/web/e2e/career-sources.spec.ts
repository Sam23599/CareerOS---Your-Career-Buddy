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
  await page.getByRole('link', { name: 'Career sources', exact: true }).click(); await page.getByRole('button', { name: 'Add job source' }).click();
  await page.getByLabel('Company name').fill(company); await page.getByLabel('Career page URL').fill(`https://boards.greenhouse.io/${board}`); await page.getByLabel('Keywords', { exact: true }).fill('C++'); await page.getByLabel('Locations', { exact: true }).fill('India'); await page.getByLabel('Check frequency').selectOption('0'); await page.getByRole('button', { name: 'Save job source', exact: true }).click();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: company, exact: true }) });
  await expect(card).toContainText('Greenhouse · job source'); await card.getByRole('button', { name: 'Check now' }).click(); await expect(card.getByRole('status')).toContainText('cached import'); await expect(card).toContainText('1 matches, 1 newly found');
  await card.getByRole('button', { name: 'Check now' }).click(); await expect(card).toContainText('1 matches, 0 newly found');
  await expect(card.getByLabel('Keywords for this check', { exact: true })).toHaveValue('C++'); await expect(card.getByLabel('Locations for this check', { exact: true })).toHaveValue('India');
  await card.getByLabel('Locations for this check', { exact: true }).fill(''); await card.getByRole('button', { name: 'Check now' }).click(); await expect(card.getByRole('status')).toContainText('2 matching jobs for this check'); await expect(card).toContainText('1 matches, 0 newly found');
  await card.getByRole('button', { name: 'Reset to saved filters', exact: true }).click(); await expect(card.getByLabel('Locations for this check', { exact: true })).toHaveValue('India'); await expect(card.getByRole('link', { name: 'View matching jobs', exact: true })).toBeVisible();
  await card.getByLabel('Locations for this check', { exact: true }).fill(''); await card.getByRole('button', { name: 'Check now' }).click(); await expect(card.getByRole('status')).toContainText('2 matching jobs for this check'); await card.getByRole('link', { name: 'View matches for this check', exact: true }).click();
  await expect(page.getByText('2 matching jobs', { exact: true })).toBeVisible(); await expect(page.getByText(/^Matching filters for this check:/)).toContainText('all locations');
  const onePerPage = new URL(page.url()); onePerPage.searchParams.set('limit', '1'); await page.goto(onePerPage.href); await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Next', exact: true }).click(); await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible(); expect(new URL(page.url()).searchParams.get('locations')).toBe('[]'); await page.reload(); await expect(page.getByText('2 matching jobs', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Use saved filters', exact: true }).click(); await expect(page.getByText('1 matching job', { exact: true })).toBeVisible();
  await page.goto('/career-sources'); await expect(card.getByLabel('Locations for this check', { exact: true })).toHaveValue('India');
  await card.getByLabel('Keywords for this check', { exact: true }).fill('Engineer'); await card.getByLabel('Locations for this check', { exact: true }).fill(''); await card.getByRole('button', { name: 'Update saved filters', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Saved filters updated for ${company}. Future checks and alerts will use them.`); await expect(card).toContainText('Saved filters · Keywords: Engineer · Locations: All locations'); await expect(card).toContainText('No checks with saved filters yet.'); await page.reload();
  await expect(card.getByLabel('Keywords for this check', { exact: true })).toHaveValue('Engineer'); await expect(card.getByLabel('Locations for this check', { exact: true })).toHaveValue('');
  await card.getByRole('link', { name: 'View matching jobs', exact: true }).click(); await expect(page.getByText('2 matching jobs', { exact: true })).toBeVisible(); await expect(page.getByText(/^Matching your saved source filters:/)).toContainText('Engineer · all locations'); await page.goto('/career-sources');
  await card.getByLabel('Keywords for this check', { exact: true }).fill('invalid'.repeat(15)); await card.getByRole('button', { name: 'Update saved filters', exact: true }).click(); await expect(card.getByRole('alert')).toContainText('keywords must contain up to 30 short values'); await expect(card.getByLabel('Keywords for this check', { exact: true })).toHaveValue('invalid'.repeat(15)); await expect(card).toContainText('Saved filters · Keywords: Engineer · Locations: All locations');
  await card.getByRole('button', { name: 'Reset to saved filters', exact: true }).click(); await expect(card.getByLabel('Keywords for this check', { exact: true })).toHaveValue('Engineer'); await expect(card.getByLabel('Locations for this check', { exact: true })).toHaveValue(''); await expect(card.getByRole('alert')).toHaveCount(0);
  await card.getByRole('button', { name: 'Edit source', exact: true }).click(); await expect(page.getByLabel('Keywords', { exact: true })).toHaveValue('Engineer'); await expect(page.getByLabel('Locations', { exact: true })).toHaveValue(''); await expect(page.getByLabel('Check frequency')).toHaveValue('0'); await expect(page.getByLabel('Enabled', { exact: true })).toBeChecked(); await expect(page.getByLabel('Company name')).toHaveValue(company); await expect(page.getByLabel('Career page URL')).toHaveValue(`https://job-boards.greenhouse.io/${board}`); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await card.getByLabel('Keywords for this check', { exact: true }).fill('C++'); await card.getByLabel('Locations for this check', { exact: true }).fill('India'); await card.getByRole('button', { name: 'Update saved filters', exact: true }).click(); await expect(card).toContainText('Saved filters · Keywords: C++ · Locations: India');
  await card.getByRole('link', { name: 'View matching jobs' }).click(); await expect(page.getByText('1 matching job', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Save job', exact: true }).click(); await expect(page.getByRole('button', { name: 'Unsave job', exact: true })).toBeVisible();
  await page.goto(`/jobs?source=${encodeURIComponent(source)}`); await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue(source); await expect(page.getByText('2 jobs found', { exact: true })).toBeVisible();
  await page.goto('/notifications'); await expect(page.getByText('1 unread · 1 notifications in this view', { exact: true })).toBeVisible();
  const notice = page.getByRole('article'); await notice.getByRole('button', { name: 'Mark as read', exact: true }).click(); await expect(page.getByText('0 unread · 1 notifications in this view', { exact: true })).toBeVisible(); await notice.getByRole('button', { name: 'Mark as unread', exact: true }).click(); await expect(page.getByText('1 unread · 1 notifications in this view', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click(); await page.getByRole('button', { name: 'Show unread only' }).click(); await expect(page.getByRole('article')).toHaveCount(0); await page.getByRole('button', { name: 'Show all notifications' }).click(); await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('New matching jobs', { exact: true }).uncheck(); await page.getByRole('button', { name: 'Save notification preferences' }).click(); await expect(page.getByRole('status')).toHaveText('Notification preferences saved.'); await page.reload(); await expect(page.getByLabel('New matching jobs', { exact: true })).not.toBeChecked();
  await page.goto('/career-sources'); await card.getByRole('button', { name: 'Edit source' }).click(); await page.getByLabel('Keywords', { exact: true }).fill('Designer'); await page.getByRole('button', { name: 'Save source changes' }).click(); await expect(card).toContainText('Keywords: Designer'); await page.reload(); await expect(card).toContainText('Keywords: Designer');
  await page.getByRole('button', { name: 'Add job source' }).click(); await page.getByLabel('Company name').fill('Link-only Company'); await page.getByLabel('Career page URL').fill('https://example.com/careers');
  await expect(page.getByRole('button', { name: 'Save as bookmark', exact: true })).toBeEnabled(); await expect(page.getByLabel('Check frequency')).toHaveCount(0); await expect(page.getByLabel('Keywords', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save as bookmark', exact: true }).click(); await expect(page).toHaveURL(/kind=bookmark/);
  const link = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Link-only Company', exact: true }) }); await expect(link).toContainText('Career bookmark'); await expect(link).toContainText('Job tracking is not supported'); await expect(link.getByRole('button', { name: 'Check now' })).toHaveCount(0); await expect(link.getByRole('button', { name: 'Enable job tracking' })).toHaveCount(0);
  await page.getByLabel('Search companies').fill('Link-only'); await page.getByRole('button', { name: 'Filter bookmarks' }).click(); await expect(page.getByRole('article')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept()); await link.getByRole('button', { name: 'Remove bookmark' }).click(); await expect(page.getByRole('article')).toHaveCount(0);
  await page.goto('/career-sources'); page.once('dialog', dialog => dialog.accept()); await card.getByRole('button', { name: 'Remove source' }).click(); await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Bookmark career page', exact: true }).click();
  await page.getByLabel('Company name').fill('Manual career bookmark'); await page.getByLabel('Career page URL').fill(`https://boards.greenhouse.io/${board}`);
  await expect(page.getByLabel('Keywords', { exact: true })).toHaveCount(0); await expect(page.getByLabel('Check frequency')).toHaveCount(0); await page.getByRole('button', { name: 'Save bookmark', exact: true }).click();
  await expect(page).toHaveURL(/kind=bookmark/);
  const nativeBookmark = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Manual career bookmark', exact: true }) });
  await expect(nativeBookmark).toContainText('Greenhouse supports job tracking'); await expect(nativeBookmark.getByRole('button', { name: 'Check now' })).toHaveCount(0); await expect(nativeBookmark.getByRole('link', { name: 'View matching jobs' })).toHaveCount(0);
  await page.reload(); await expect(nativeBookmark).toContainText('Career bookmark');
  await nativeBookmark.getByRole('button', { name: 'Edit bookmark' }).click(); await expect(page.getByLabel('Locations', { exact: true })).toHaveCount(0); await page.getByLabel('Career page URL').fill(`https://boards.greenhouse.io/${board}#jobs`); await page.getByRole('button', { name: 'Save bookmark changes' }).click();
  await expect(nativeBookmark.getByRole('link', { name: 'Open career page' })).toHaveAttribute('href', `https://boards.greenhouse.io/${board}`);
  await nativeBookmark.getByRole('button', { name: 'Enable job tracking', exact: true }).click(); await expect(page.getByLabel('Check frequency')).toHaveValue('0'); await expect(page.getByLabel('Enabled', { exact: true })).toBeChecked(); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(nativeBookmark).toContainText('Career bookmark');
  await nativeBookmark.getByRole('button', { name: 'Enable job tracking', exact: true }).click(); await page.getByLabel('Keywords', { exact: true }).fill('C++'); await page.getByLabel('Locations', { exact: true }).fill('India'); await page.getByRole('button', { name: 'Enable job tracking', exact: true }).click();
  await expect(page).toHaveURL(/kind=job-source/); await expect(nativeBookmark).toContainText('Greenhouse · job source'); await nativeBookmark.getByRole('button', { name: 'Check now' }).click(); await expect(nativeBookmark.getByRole('status')).toContainText('cached import'); await expect(nativeBookmark).toContainText('1 matches, 1 newly found');
  page.once('dialog', dialog => dialog.accept()); await nativeBookmark.getByRole('button', { name: 'Remove source' }).click(); await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('link', { name: 'Career bookmarks', exact: true }).click(); await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add job source' }).click();
  await page.getByLabel('Company name').fill('Google Browser Company'); await page.getByLabel('Career page URL').fill('https://careers.google.com/');
  await expect(page.getByRole('status').filter({ hasText: 'first 20 unfiltered public results' })).toBeVisible();
  await expect(page.getByLabel('Check frequency')).toBeEnabled(); await page.getByLabel('Check frequency').selectOption('0'); await page.getByRole('button', { name: 'Save job source', exact: true }).click();
  const google = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Google Browser Company', exact: true }) });
  await expect(google).toContainText('Google Careers · job source'); await expect(google).toContainText('Limited coverage'); await expect(google.getByRole('button', { name: 'Check now' })).toBeEnabled();
  await google.getByRole('link', { name: 'View matching jobs' }).click(); await expect(page.getByRole('heading', { name: 'Google Browser Company jobs', exact: true })).toBeVisible(); await expect(page.getByText(/^Limited coverage:/)).toBeVisible();
  await page.goto('/career-sources'); page.once('dialog', dialog => dialog.accept()); await google.getByRole('button', { name: 'Remove source' }).click(); await expect(page.getByRole('article')).toHaveCount(0);
  await page.goto('/dashboard'); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
});
