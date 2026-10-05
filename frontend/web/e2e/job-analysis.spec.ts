import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import fixture from '../../../backend/platform/test/fixtures/job-analysis.json' with { type: 'json' };

test('job analysis requires an explicit click, reopens versions, labels stale data and keeps saved results after failure', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Job Analysis Tester');
  await page.getByLabel('Email', { exact: true }).fill(`e2e-jd-${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a job analysis testing passphrase');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const fields = Object.fromEntries(fixture.source.sections.map(item => [item.id, item.text]));
  const job = { id: fixture.source.jobId, ...fields, source: 'remotive', sourceUrl: 'https://remotive.com/remote-jobs/example',
    employmentType: 'UNKNOWN', remoteType: 'REMOTE', skills: [], metadata: {}, postedAt: null, expiresAt: null, updatedAt: '2026-10-05T00:00:00Z' };
  let generated = 0, failing = false, stale = false;
  const versions: (typeof fixture)[] = [];
  await page.route(`**/api/v1/jobs/${job.id}`, route => route.fulfill({ json: { job } }));
  await page.route(`**/api/v1/saved-jobs/${job.id}`, route => route.fulfill({ json: { savedJob: null } }));
  await page.route('**/api/v1/intelligence/jobs/capabilities', route => route.fulfill({ json: {
    available: true, models: [{ id: 'gpt-4.1', reasoningOptions: [] }, { id: 'gpt-6-luna', reasoningOptions: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
      { id: 'gpt-6.1-sol', reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max'] }], defaultModel: 'gpt-6-luna', defaultReasoning: 'medium',
  } }));
  await page.route(/\/api\/v1\/intelligence\/jobs\/[^/]+\/analysis(?:\?.*)?$/, route => {
    const id = new URL(route.request().url()).searchParams.get('analysisId');
    const saved = id ? versions.find(item => item.id === id) : versions.at(-1);
    return saved ? route.fulfill({ json: { analysis: saved, sourceStatus: { stale, expired: false } } })
      : route.fulfill({ status: 404, json: { error: { code: 'JOB_ANALYSIS_NOT_FOUND', message: 'No saved job analysis.' } } });
  });
  await page.route(`**/api/v1/intelligence/jobs/${job.id}/analyses`, route => route.fulfill({ json: {
    versions: [...versions].reverse().map(({ id, version, model, reasoning, createdAt, source }) => ({ id, version, model, reasoning, createdAt, sourceHash: source.sha256, stale })), nextBeforeVersion: null,
  } }));
  await page.route(`**/api/v1/intelligence/jobs/${job.id}/analyze`, async route => {
    generated++; expect(route.request().postDataJSON()).toEqual({ model: 'gpt-4.1', reasoning: null });
    if (failing) return route.fulfill({ status: 504, json: { error: { code: 'LLM_TIMEOUT', message: 'Analysis took too long. Try again.' } } });
    const record = { ...fixture, id: generated === 1 ? fixture.id : randomUUID(), version: generated, model: 'gpt-4.1', reasoning: null };
    versions.push(record); await route.fulfill({ json: { analysis: record, sourceStatus: { stale: false, expired: false } } });
  });
  await page.goto(`/jobs/${job.id}`);
  const panel = page.getByRole('region', { name: 'Job analysis', exact: true });
  await expect(panel.getByRole('button', { name: 'Analyze job', exact: true })).toBeEnabled();
  expect(generated).toBe(0);
  await panel.getByLabel('AI model').selectOption('gpt-4.1');
  await expect(panel.getByLabel('Reasoning effort')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Analyze job', exact: true }).click();
  await expect(panel.getByText(/^Saved analysis · Version 1/)).toBeVisible();
  await expect(panel.getByText('Python · required', { exact: true })).toBeVisible();
  await expect(panel.getByText('TypeScript · preferred', { exact: true })).toBeVisible();
  await panel.locator('details').filter({ has: page.locator('summary', { hasText: 'Why this priority?' }) }).first().locator('summary').click();
  await expect(panel.getByText('Required qualifications:', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(job.description, { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Analyze job again', exact: true }).click();
  await expect(panel.getByLabel('Saved analysis version')).toHaveValue(versions[1].id);
  await panel.getByLabel('Saved analysis version').selectOption(fixture.id);
  await expect(panel.getByText(/^Saved analysis · Version 1/)).toBeVisible();
  expect(generated).toBe(2);
  failing = true;
  await panel.getByRole('button', { name: 'Analyze job again', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Analysis took too long. Try again.');
  await expect(panel.getByText(/^Saved analysis · Version 1/)).toBeVisible();
  expect(versions).toHaveLength(2);
  stale = true; await page.reload();
  await expect(panel.getByText(/^Saved analysis · Version 2/)).toBeVisible();
  await expect(panel.getByText('This listing changed since this analysis.', { exact: false })).toBeVisible();
  expect(generated).toBe(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
