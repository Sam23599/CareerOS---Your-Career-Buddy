import { test, expect } from '@playwright/test';
import cv from '../../../backend/platform/test/fixtures/resume-draft.json' with { type: 'json' };
import jd from '../../../backend/platform/test/fixtures/job-analysis.json' with { type: 'json' };
import review from '../../../backend/platform/test/fixtures/resume-review.json' with { type: 'json' };
import match from '../../../backend/platform/test/fixtures/matching.json' with { type: 'json' };

test('CV matching selects saved versions, explains evidence, supplements profile skills and handles stale inputs without AI', async ({ page }) => {
  const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Match Tester', email: 'match@example.com', roles: ['USER'],
    username: null, hasPassword: true, oauthProvider: null, passwordPromptPending: false };
  const fields = Object.fromEntries(jd.source.sections.map(section => [section.id, section.text]));
  const job = { id: jd.source.jobId, ...fields, source: 'fixture', sourceUrl: 'https://example.com/job', skills: [],
    employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', metadata: {}, postedAt: null, expiresAt: null, updatedAt: jd.createdAt };
  const cvVersions = Array.from({ length: 20 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(21 - index).padStart(12, '0')}`,
    version: 21 - index, model: cv.model, reasoning: cv.reasoning, createdAt: cv.createdAt }));
  let comparisons = 0, generated = 0, stale = false;
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (/\/auth\/(restore|refresh)$/.test(path)) return route.fulfill({ json: { user, accessToken: 'mock-matching-session', expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/users/me')) return route.fulfill({ json: { user } });
    if (path.endsWith('/notifications')) return route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, limit: 20 } });
    if (path === `/api/v1/jobs/${job.id}`) return route.fulfill({ json: { job } });
    if (path === `/api/v1/saved-jobs/${job.id}`) return route.fulfill({ json: { savedJob: null } });
    if (path === '/api/v1/resumes') return route.fulfill({ json: { resumes: [{ id: cv.source.resumeId, version: cv.source.resumeVersion,
      name: 'My saved CV.pdf', active: true, size: 1024, uploadedAt: cv.createdAt }] } });
    if (path.endsWith('/drafts')) return route.fulfill({ json: url.searchParams.has('beforeVersion')
      ? { versions: [{ id: cv.id, version: 1, model: cv.model, reasoning: cv.reasoning, createdAt: cv.createdAt }], nextBeforeVersion: null }
      : { versions: cvVersions, nextBeforeVersion: 2 } });
    if (path.endsWith('/jobs/capabilities')) return route.fulfill({ json: { available: false, models: [{ id: 'gpt-6-luna', reasoningOptions: ['medium'] }], defaultModel: 'gpt-6-luna', defaultReasoning: 'medium' } });
    if (path.endsWith('/analyses')) return route.fulfill({ json: { versions: [{ id: jd.id, version: jd.version, model: jd.model,
      reasoning: jd.reasoning, createdAt: jd.createdAt, sourceHash: jd.source.sha256, stale }], nextBeforeVersion: null } });
    if (path.endsWith('/analysis')) return route.fulfill({ json: { analysis: jd, sourceStatus: { stale, expired: false } } });
    if (path.endsWith('/review')) {
      comparisons++;
      const input = route.request().postDataJSON();
      expect(input).toEqual({ draftId: cv.id, job: { jobId: jd.source.jobId, jobAnalysisId: jd.id, includeProfileSkills: comparisons > 1 } });
      if (stale) return route.fulfill({ status: 409, json: { error: { code: 'JOB_ANALYSIS_STALE', message: 'This listing changed. Analyze its current description before matching.' } } });
      const result = structuredClone(match);
      if (input.job.includeProfileSkills) {
        result.score = 100; result.matchedWeight = 4; result.source.profileVersion = 5;
        const item = result.items.find(row => row.status === 'not_found')!;
        item.status = 'matched'; item.candidate = { source: 'profile', field: 'skills', value: 'TypeScript', evidence: [] };
      }
      return route.fulfill({ json: { report: { ...review, match: result }, sourceStatus: { expired: false } } });
    }
    if (path.endsWith('/analyze')) generated++;
    return route.fulfill({ status: 404, json: { error: { message: 'Unconfigured test endpoint.' } } });
  });
  await page.goto(`/jobs/${job.id}`);
  const panel = page.getByRole('region', { name: 'CV-to-job matching', exact: true });
  await expect(panel.getByRole('button', { name: 'Review fit & gaps', exact: true })).toBeEnabled();
  expect(comparisons).toBe(0); expect(generated).toBe(0);
  await panel.getByRole('button', { name: 'Load older CV analyses' }).click();
  await panel.getByLabel('CV analysis version').selectOption(cv.id);
  await panel.getByRole('button', { name: 'Review fit & gaps', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('75%');
  await expect(panel.getByText('3 of 4 weighted points matched')).toBeVisible();
  await panel.getByText('Skills not found (1)', { exact: true }).click();
  await expect(panel.getByText('Not found in selected inputs', { exact: true })).toBeVisible();
  await panel.getByText('How is this score calculated?', { exact: true }).click();
  await expect(panel.getByText(/Required skills count 3 points/)).toBeVisible();
  await panel.getByText('Matched skills (1)', { exact: true }).click();
  await panel.getByText('View comparison evidence', { exact: true }).first().click();
  await expect(panel.getByText('Page 1', { exact: true })).toBeVisible();
  await panel.getByLabel('Include my saved profile skills').check();
  await expect(panel.locator('.match-result')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Review fit & gaps', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('100%');
  await panel.getByText('Matched skills (2)', { exact: true }).click();
  await expect(panel.getByText(/your profile skills \(self-reported\)/)).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  stale = true;
  await panel.getByRole('button', { name: 'Review fit & gaps', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('This listing changed. Analyze its current description before matching.');
  await expect(panel.locator('.match-result')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Refresh comparison inputs' }).click();
  await expect(panel.getByRole('button', { name: 'Review fit & gaps', exact: true })).toBeDisabled();
  expect(generated).toBe(0);
});

test('matching clearly explains missing prerequisites and remains hidden for signed-out users', async ({ page }) => {
  const fields = Object.fromEntries(jd.source.sections.map(section => [section.id, section.text]));
  const job = { id: jd.source.jobId, ...fields, source: 'fixture', sourceUrl: 'https://example.com/job', skills: [],
    employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', metadata: {}, postedAt: null, expiresAt: null, updatedAt: jd.createdAt };
  let signedIn = true;
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (/\/auth\/(restore|refresh)$/.test(path)) return signedIn
      ? route.fulfill({ json: { user: { id: cv.source.resumeId, name: 'Tester', roles: ['USER'], hasPassword: true }, accessToken: 'mock', expiresAt: '2030-01-01T00:00:00Z' } })
      : route.fulfill({ status: 401, json: { error: { message: 'Sign in required.' } } });
    if (path === `/api/v1/jobs/${job.id}`) return route.fulfill({ json: { job } });
    if (path.endsWith('/resumes')) return route.fulfill({ json: { resumes: [] } });
    if (path.endsWith('/analyses')) return route.fulfill({ json: { versions: [], nextBeforeVersion: null } });
    return route.fulfill({ status: 404, json: { error: { message: 'No saved analysis.' } } });
  });
  await page.goto(`/jobs/${job.id}`);
  const panel = page.getByRole('region', { name: 'CV-to-job matching', exact: true });
  await expect(panel.getByRole('link', { name: 'Upload and analyze a resume' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Analyze the current job description' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Review fit & gaps', exact: true })).toBeDisabled();
  signedIn = false; await page.reload();
  await expect(panel).toHaveCount(0);
});
