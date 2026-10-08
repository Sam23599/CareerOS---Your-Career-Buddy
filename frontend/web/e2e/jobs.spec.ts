import { test, expect } from '@playwright/test';

const job = { id: 'a'.repeat(64), title: 'Backend Engineer', company: 'Example', location: 'India', employmentType: 'FULL_TIME', remoteType: 'REMOTE', skills: ['TypeScript'], source: 'remotive', sourceUrl: 'https://remotive.com/remote-jobs/software-dev/example', postedAt: '2026-09-01T00:00:00Z', expiresAt: null, updatedAt: '2026-10-01T00:00:00Z', description: '<img src=x onerror=alert(1)> Build reliable services.', metadata: {} };
test('public job search preserves filters, paginates and opens safe attributed details', async ({ page }) => {
  await page.route('**/api/v1/jobs**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(job.id)) return route.fulfill({ json: { job } });
    const pageNumber = Number(url.searchParams.get('page') || 1);
    return route.fulfill({ json: { jobs: url.searchParams.get('q') === 'no-match' ? [] : [{ ...job, title: pageNumber === 2 ? 'Second role' : job.title }], total: url.searchParams.get('q') === 'no-match' ? 0 : 2, page: pageNumber, limit: 1 } });
  });
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible();
  await page.getByLabel('Location', { exact: true }).fill('India');
  await page.getByLabel('Work mode').selectOption('REMOTE');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/location=India.*remoteType=REMOTE/);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second role' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await page.getByRole('link', { name: 'Backend Engineer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backend Engineer', exact: true })).toBeVisible();
  await expect(page.getByText(job.description, { exact: true })).toBeVisible();
  await expect(page.locator('.job-detail img')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View original listing on Remotive' })).toHaveAttribute('href', job.sourceUrl);
  await page.getByRole('link', { name: 'Back to jobs', exact: false }).click();
  await expect(page.getByLabel('Location', { exact: true })).toHaveValue('India');
  await page.getByLabel('Search jobs').fill('no-match');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('No jobs match this search.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('heading', { name: 'Backend Engineer', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('job loading failures offer retry and missing detail has a clear error', async ({ page }) => {
  let failing = true;
  await page.route('**/api/v1/jobs**', route => {
    if (failing) { return route.fulfill({ status: 503, json: { error: { message: 'Service unavailable.' } } }); }
    if (new URL(route.request().url()).pathname.endsWith('/missing')) return route.fulfill({ status: 404, json: { error: { message: 'Job not found.' } } });
    return route.fulfill({ json: { jobs: [], total: 0, page: 1, limit: 20 } });
  });
  await page.goto('/jobs');
  await expect(page.getByRole('alert')).toHaveText('Service unavailable.');
  failing = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('status')).toHaveText('0 jobs found');
  await page.goto('/jobs/missing');
  await expect(page.getByRole('alert')).toHaveText('Job not found.');
});
