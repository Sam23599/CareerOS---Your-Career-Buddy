import { test, expect, type Page } from '@playwright/test';
import cv from '../../../backend/platform/test/fixtures/resume-draft.json' with { type: 'json' };
import jd from '../../../backend/platform/test/fixtures/job-analysis.json' with { type: 'json' };
import fixture from '../../../backend/platform/test/fixtures/resume-review.json' with { type: 'json' };
import { type ReviewReport } from '../../../backend/platform/src/intelligence/reviews';

const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Review Tester', email: 'review@example.com', roles: ['USER'],
  username: null, hasPassword: true, oauthProvider: null, passwordPromptPending: false };
const fields = Object.fromEntries(jd.source.sections.map(section => [section.id, section.text]));
const job = { id: jd.source.jobId, ...fields, source: 'fixture', sourceUrl: 'https://example.com/job', skills: [],
  employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', metadata: {}, postedAt: null, expiresAt: null, updatedAt: jd.createdAt };

async function mock(page: Page, state: { reviews: number; generated: number; stale: boolean; empty: boolean; fail: boolean }) {
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (/\/auth\/(restore|refresh)$/.test(path)) return route.fulfill({ json: { user, accessToken: 'mock-review-session', expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/users/me')) return route.fulfill({ json: { user } });
    if (path.endsWith('/notifications')) return route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, limit: 20 } });
    if (path === `/api/v1/jobs/${job.id}`) return route.fulfill({ json: { job } });
    if (path === `/api/v1/saved-jobs/${job.id}`) return route.fulfill({ json: { savedJob: null } });
    if (path === '/api/v1/resumes') return route.fulfill({ json: { resumes: [{ id: cv.source.resumeId, version: cv.source.resumeVersion,
      name: 'Review CV.pdf', active: true, size: 1024, uploadedAt: cv.createdAt }] } });
    if (path.endsWith('/drafts')) return route.fulfill({ json: { versions: state.empty ? [] : url.searchParams.has('beforeVersion')
      ? [{ id: cv.id, version: 1, model: cv.model, reasoning: cv.reasoning, createdAt: cv.createdAt }]
      : [{ id: '00000000-0000-4000-8000-000000000002', version: 2, model: cv.model, reasoning: cv.reasoning, createdAt: cv.createdAt }],
      nextBeforeVersion: !state.empty && !url.searchParams.has('beforeVersion') ? 2 : null } });
    if (path.endsWith('/jobs/capabilities')) return route.fulfill({ json: { available: false, models: [{ id: 'gpt-6-luna', reasoningOptions: ['medium'] }], defaultModel: 'gpt-6-luna', defaultReasoning: 'medium' } });
    if (path.endsWith('/analyses')) return route.fulfill({ json: { versions: [{ id: jd.id, version: jd.version, model: jd.model,
      reasoning: jd.reasoning, createdAt: jd.createdAt, sourceHash: jd.source.sha256, stale: state.stale }], nextBeforeVersion: null } });
    if (path.endsWith('/analysis')) return route.fulfill({ json: { analysis: jd, sourceStatus: { stale: state.stale, expired: false } } });
    if (path.endsWith('/review')) {
      state.reviews++; const input = route.request().postDataJSON();
      expect(input.draftId).toBe(cv.id);
      if (state.stale || state.fail) return route.fulfill({ status: state.stale ? 409 : 503, json: { error: { message: state.stale ? 'This listing changed. Analyze its current description before reviewing gaps.' : 'Review is temporarily unavailable. Please retry.' } } });
      const report = structuredClone(fixture) as ReviewReport;
      if (!input.job) { report.match = null; report.preparation = []; report.keywords = []; }
      else {
        expect(input.job).toEqual({ jobId: job.id, jobAnalysisId: jd.id, includeProfileSkills: state.reviews > 1 });
        if (input.job.includeProfileSkills) {
          report.match!.score = 100; report.match!.matchedWeight = 4; report.match!.source.profileVersion = 5;
          const index = report.match!.items.findIndex(item => item.status === 'not_found');
          report.match!.items[index].status = 'matched'; report.match!.items[index].candidate = { source: 'profile', field: 'skills', value: 'TypeScript', evidence: [] };
          const action = report.preparation.find(item => item.matchIndex === index)!;
          action.kind = 'profile_only'; action.action = 'This is listed in your profile, but no skill evidence was found in this CV analysis. If accurate, add a concrete example to the CV.';
        }
      }
      return route.fulfill({ json: { report, sourceStatus: { expired: Boolean(input.job) } } });
    }
    if (path.endsWith('/analyze')) state.generated++;
    return route.fulfill({ status: 404, json: { error: { message: 'No test endpoint.' } } });
  });
}

test('job preparation stays compact, explains evidence gaps and clears reports on changes and errors', async ({ page }) => {
  const state = { reviews: 0, generated: 0, stale: false, empty: false, fail: false }; await mock(page, state);
  await page.goto(`/jobs/${job.id}`);
  const panel = page.getByRole('region', { name: 'CV-to-job matching', exact: true });
  await panel.getByRole('button', { name: 'Load older CV analyses' }).click();
  await panel.getByLabel('CV analysis version').selectOption(cv.id);
  expect(state.reviews).toBe(0);
  await panel.getByRole('button', { name: 'Review fit & gaps' }).click();
  await expect(panel.getByRole('status')).toHaveText('75%');
  const report = panel.getByRole('region', { name: 'Resume checks and preparation' });
  await expect(report.getByText('2 of 6 sections recognized', { exact: false })).toBeVisible();
  await expect(report.locator('details[open]')).toHaveCount(0);
  await report.getByText('Resume findings (4)', { exact: true }).click();
  await report.getByText('Contact details not recognized', { exact: true }).click();
  await expect(report.getByText(/current email address or phone number/)).toBeVisible();
  await report.getByText('Preferred skills not found (1)', { exact: true }).click();
  await report.locator('summary').filter({ hasText: /^TypeScript$/ }).click();
  await expect(report.getByText(/First check whether you already have this skill/)).toBeVisible();
  await expect(report.getByText('Job · Description', { exact: true }).first()).toBeVisible();
  await report.screenshot({ path: '/tmp/careeros-resume-check-report-desktop.png' });
  await page.screenshot({ path: '/tmp/careeros-resume-checks-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await report.screenshot({ path: '/tmp/careeros-resume-check-report-mobile.png' });
  await page.screenshot({ path: '/tmp/careeros-resume-checks-mobile.png', fullPage: true });
  await panel.getByLabel('Include my saved profile skills').check(); await expect(report).toHaveCount(0);
  await panel.getByRole('button', { name: 'Review fit & gaps' }).click();
  await expect(panel.getByRole('status')).toHaveText('100%');
  await report.getByText('Profile skills to support in your CV (1)', { exact: true }).click();
  await report.locator('summary').filter({ hasText: /^TypeScript$/ }).click();
  await expect(report.getByText(/If accurate, add a concrete example/)).toBeVisible();
  state.stale = true; await panel.getByRole('button', { name: 'Review fit & gaps' }).click();
  await expect(panel.getByRole('alert')).toContainText('This listing changed'); await expect(report).toHaveCount(0);
  await panel.getByRole('button', { name: 'Refresh comparison inputs' }).click();
  await expect(panel.getByRole('button', { name: 'Review fit & gaps' })).toBeDisabled();
  expect(state.generated).toBe(0);
});

test('closing resume checks cancels a pending request and keeps controls consistent', async ({ page }) => {
  const state = { reviews: 0, generated: 0, stale: false, empty: false, fail: false }; await mock(page, state);
  let finish: (() => void) | undefined;
  let cancelled = false;
  const held = new Promise<void>(resolve => { finish = resolve; });
  page.on('requestfailed', request => { if (request.url().endsWith('/review')) cancelled = true; });
  await page.route('**/api/v1/intelligence/resumes/*/review', async route => {
    await held;
    await route.fulfill({ json: { report: { ...fixture, match: null, preparation: [], keywords: [] }, sourceStatus: { expired: false } } }).catch(() => {});
  });
  await page.goto('/resumes'); await page.getByRole('button', { name: 'Check resume', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Check Review CV.pdf' });
  await dialog.getByRole('button', { name: 'Load older CV analyses' }).click();
  await dialog.getByLabel('CV analysis for checks').selectOption(cv.id);
  await dialog.getByRole('button', { name: 'Run resume checks' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Reviewing saved inputs…');
  await expect(dialog.getByLabel('CV analysis for checks')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect.poll(() => cancelled).toBe(true); finish!();
  await page.getByRole('button', { name: 'Check resume', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Run resume checks' })).toBeEnabled();
  await expect(dialog.getByRole('region', { name: 'Resume checks and preparation' })).toHaveCount(0);
  expect(state.generated).toBe(0);
});

test('resume checks select older versions, recover from failure and restore focus after Escape', async ({ page }) => {
  const state = { reviews: 0, generated: 0, stale: false, empty: false, fail: false }; await mock(page, state);
  await page.goto('/resumes'); await page.getByRole('button', { name: 'Check resume', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Check Review CV.pdf' });
  await expect(dialog.getByRole('button', { name: 'Run resume checks' })).toBeEnabled(); expect(state.reviews).toBe(0);
  await dialog.getByRole('button', { name: 'Load older CV analyses' }).click();
  await dialog.getByLabel('CV analysis for checks').selectOption(cv.id);
  await dialog.getByRole('button', { name: 'Run resume checks' }).click();
  const report = dialog.getByRole('region', { name: 'Resume checks and preparation' }); await expect(report).toBeVisible();
  await expect(report.getByRole('heading', { name: 'Skills & preparation' })).toHaveCount(0);
  await dialog.getByLabel('CV analysis for checks').selectOption('00000000-0000-4000-8000-000000000002'); await expect(report).toHaveCount(0);
  await dialog.getByLabel('CV analysis for checks').selectOption(cv.id); state.fail = true;
  await dialog.getByRole('button', { name: 'Run resume checks' }).click(); await expect(dialog.getByRole('alert')).toContainText('temporarily unavailable'); await expect(report).toHaveCount(0);
  state.fail = false; await dialog.getByRole('button', { name: 'Run resume checks' }).click(); await expect(report).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: 'Check resume', exact: true })).toBeFocused();
  state.empty = true; await page.getByRole('button', { name: 'Check resume', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Open resume draft' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Run resume checks' })).toHaveCount(0);
  expect(state.generated).toBe(0);
});
