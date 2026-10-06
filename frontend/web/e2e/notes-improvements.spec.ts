import { test, expect } from '@playwright/test';
import fixture from '../../../backend/platform/test/fixtures/job-analysis.json' with { type: 'json' };

test('demo settings use a persistent dark theme and disable payment controls', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('/auth/restore') ? { user: { id: '11111111-1111-4111-8111-111111111111', name: 'Demo User', email: 'demo@example.com', roles: ['USER'], hasPassword: true }, accessToken: 'mock-session', expiresAt: new Date(Date.now() + 3_600_000).toISOString() } : { unread: 0 } });
  });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Recharge — coming later' })).toBeDisabled();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/careeros-settings-dark.png', fullPage: true });
});

test('source results keep the visit boundary across live search and sorting', async ({ page }) => {
  let acknowledgements = 0;
  const queries: URLSearchParams[] = [];
  const source = { id: 'demo', company: 'Example', providerName: 'Greenhouse', keywords: [], locations: [], coverage: 'complete' };
  const jobs = [{ id: 'a'.repeat(64), title: 'New engineer', company: 'Example', location: 'India', sourceUrl: 'https://example.com/new', isNew: true }, { id: 'b'.repeat(64), title: 'Earlier engineer', company: 'Example', location: 'India', sourceUrl: 'https://example.com/old', isNew: false }];
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/auth/restore')) return route.fulfill({ json: { user: { id: '11111111-1111-4111-8111-111111111111', name: 'Demo', email: 'demo@example.com', roles: ['USER'] }, accessToken: 'mock', expiresAt: new Date(Date.now() + 3_600_000).toISOString() } });
    if (path.endsWith('/career-sources/demo/view')) { acknowledgements++; return route.fulfill({ json: { status: 'viewed' } }); }
    if (path.endsWith('/career-sources/demo/jobs')) { queries.push(url.searchParams); const rows = jobs.filter(job => job.title.toLowerCase().includes((url.searchParams.get('q') ?? '').toLowerCase())); return route.fulfill({ json: { source, filters: { keywords: [], locations: [] }, temporary: false, jobs: rows, total: rows.length, newTotal: rows.filter(job => job.isNew).length, page: 1, limit: 20, since: '2026-10-01T00:00:00.000Z', visitedAt: new Date().toISOString() } }); }
    return route.fulfill({ json: { savedJob: null, unread: 0 } });
  });
  await page.goto('/career-sources/demo/jobs');
  await expect(page.getByRole('heading', { name: 'New since your last visit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Earlier listings' })).toBeVisible();
  await page.getByLabel('Search this feed').fill('New');
  await expect(page.getByRole('heading', { name: 'Earlier listings' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('title');
  await expect.poll(() => queries.at(-1)?.get('sort')).toBe('title');
  expect(queries.at(-1)?.get('since')).toBe('2026-10-01T00:00:00.000Z');
  expect(acknowledgements).toBe(1);
  await page.getByLabel('Search this feed').fill('Earlier');
  await page.getByLabel('Location', { exact: true }).fill('India');
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('oldest');
  await expect.poll(() => queries.at(-1)?.get('q')).toBe('Earlier');
  expect(queries.at(-1)?.get('location')).toBe('India');
  expect(queries.at(-1)?.get('sort')).toBe('oldest');
  expect(acknowledgements).toBe(1);
});

test('an accepted job task survives navigation and its saved result reopens without generating again', async ({ page }) => {
  const fields = Object.fromEntries(fixture.source.sections.map(section => [section.id, section.text]));
  const job = { id: fixture.source.jobId, ...fields, source: 'remotive', sourceUrl: 'https://example.com/job', remoteType: 'REMOTE', employmentType: 'UNKNOWN', skills: [], metadata: {}, postedAt: null, expiresAt: null, updatedAt: new Date().toISOString() };
  let started = 0, completed = false;
  const task = { id: '22222222-2222-4222-8222-222222222222', jobId: job.id, sourceHash: fixture.source.sha256, state: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), analysisId: null, errorCode: null };
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/restore')) return route.fulfill({ json: { user: { id: '11111111-1111-4111-8111-111111111111', name: 'Demo', email: 'demo@example.com', roles: ['USER'] }, accessToken: 'mock', expiresAt: new Date(Date.now() + 3_600_000).toISOString() } });
    if (path === `/api/v1/jobs/${job.id}`) return route.fulfill({ json: { job } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { available: true, models: [{ id: 'gpt-6-luna', reasoningOptions: ['medium'] }], defaultModel: 'gpt-6-luna', defaultReasoning: 'medium' } });
    if (path.endsWith('/tasks')) {
      if (route.request().method() === 'POST') { started++; return route.fulfill({ json: { taskId: task.id } }); }
      return route.fulfill({ json: { tasks: started ? [{ ...task, state: completed ? 'succeeded' : 'queued', analysisId: completed ? fixture.id : null }] : [] } });
    }
    if (path.endsWith('/analysis')) return completed ? route.fulfill({ json: { analysis: fixture, sourceStatus: { stale: false, expired: false } } }) : route.fulfill({ status: 404, json: { error: { code: 'JOB_ANALYSIS_NOT_FOUND', message: 'No saved analysis.' } } });
    if (path.endsWith('/analyses')) return route.fulfill({ json: { versions: [], nextBeforeVersion: null } });
    return route.fulfill({ json: { savedJob: null, resumes: [], unread: 0 } });
  });
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole('button', { name: 'Analyze job', exact: true }).click();
  await expect(page.getByText('You can leave this page;', { exact: false })).toBeVisible();
  await page.goto('/settings'); completed = true;
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('button', { name: 'Expand all' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.locator('[data-analysis-section]').first()).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Collapse all' }).click();
  expect(await page.locator('[data-analysis-section][open]').count()).toBe(0);
  expect(started).toBe(1);
});
