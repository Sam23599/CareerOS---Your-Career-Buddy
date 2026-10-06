import { test, expect, type Page } from '@playwright/test';
import cv from '../../../backend/platform/test/fixtures/resume-draft.json' with { type: 'json' };
import { type RankingResponse } from '../../../backend/platform/src/intelligence/ranking';

const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Ranking Tester', email: 'ranking@example.com', roles: ['USER'],
  username: null, hasPassword: true, oauthProvider: null, passwordPromptPending: false };
const id = 'a'.repeat(64), newest = '00000000-0000-4000-8000-000000000002';
const savedJob = { jobId: id, status: 'SAVED', priority: 'MEDIUM', notes: '', revision: '11111111-1111-4111-8111-111111111111',
  savedAt: cv.createdAt, updatedAt: cv.createdAt, available: true,
  job: { title: 'Python Engineer', company: 'Example', location: 'London', source: 'fixture', sourceUrl: 'https://example.com/job',
    remoteType: 'REMOTE', employmentType: 'FULL_TIME', expiresAt: null } };
type State = { rankings: number; analyses: number; fail: boolean; empty: boolean; inputs: unknown[] };
async function mock(page: Page, state: State) {
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (/\/auth\/(restore|refresh)$/.test(path)) return route.fulfill({ json: { user, accessToken: 'mock-ranking-session', expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/users/me')) return route.fulfill({ json: { user } });
    if (path.endsWith('/notifications')) return route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, limit: 20 } });
    if (path === '/api/v1/saved-jobs') return route.fulfill({ json: { savedJobs: [savedJob], total: 8, page: 1, limit: 20 } });
    if (path === `/api/v1/saved-jobs/${id}`) return route.fulfill({ json: { savedJob: { ...savedJob, ...route.request().postDataJSON() } } });
    if (path === '/api/v1/resumes') return route.fulfill({ json: { resumes: state.empty ? [] : [{ id: cv.source.resumeId,
      version: cv.source.resumeVersion, name: 'Ranking CV.pdf', active: true, size: 1024, uploadedAt: cv.createdAt }] } });
    if (path.endsWith('/drafts')) return route.fulfill({ json: { versions: url.searchParams.has('beforeVersion')
      ? [{ id: cv.id, version: 1, model: cv.model, reasoning: cv.reasoning, createdAt: cv.createdAt }]
      : [{ id: newest, version: 2, model: cv.model, reasoning: cv.reasoning, createdAt: cv.createdAt }],
      nextBeforeVersion: url.searchParams.has('beforeVersion') ? null : 2 } });
    if (path.endsWith('/saved-jobs/rank')) {
      state.rankings++; const input = route.request().postDataJSON(); state.inputs.push(input);
      if (state.fail) return route.fulfill({ status: 413, json: { error: { message: 'Rank up to 50 saved jobs at once. Narrow the status or priority filters and try again.' } } });
      const result: RankingResponse = { rankingVersion: 'saved-skill-coverage-v1', createdAt: cv.createdAt,
        total: 8, filters: input.filters, source: { resume: cv.source, draftId: input.draftId,
          draftVersion: input.draftId === cv.id ? 1 : 2, profileVersion: input.usePreferences || input.includeProfileSkills ? 5 : null },
        ranked: Array.from({ length: 6 }, (_, index) => ({ jobId: index ? String(index).repeat(64) : id,
          title: `Python opportunity ${index + 1}`, company: 'Example', location: 'London', priority: 'MEDIUM',
          savedAt: cv.createdAt, rank: index + 1, score: input.includeProfileSkills ? 100 : 75,
          matchedWeight: input.includeProfileSkills ? 4 : 3, totalWeight: 4,
          jobAnalysisId: newest, jobAnalysisVersion: 2, matchedSkills: ['Python'],
          profileOnlySkills: input.includeProfileSkills ? ['TypeScript'] : [],
          missingSkills: input.includeProfileSkills ? [] : [{ value: 'TypeScript', priority: 'preferred' }], reviewCount: 2,
          preferenceMatches: input.usePreferences ? 1 : 0, preferences: input.usePreferences
            ? [{ kind: 'work_mode', wanted: ['REMOTE'], actual: 'REMOTE', status: 'matched' }] : [],
        })), unranked: ['analysis_required', 'stale_analysis'].map((reason, index) => ({ jobId: String(index + 7).repeat(64),
          title: `Pending job ${index + 1}`, company: 'Example', location: '', priority: 'LOW', savedAt: cv.createdAt,
          reason: reason as 'analysis_required' | 'stale_analysis' })) };
      return route.fulfill({ json: result });
    }
    if (path.endsWith('/analyze')) state.analyses++;
    return route.fulfill({ status: 404, json: { error: { message: 'No test endpoint.' } } });
  });
}
const state = (): State => ({ rankings: 0, analyses: 0, fail: false, empty: false, inputs: [] });

test('ranking is explicit, uses older CV versions, compact reasons and all-page applied filters', async ({ page }) => {
  const current = state(); await mock(page, current); await page.goto('/saved-jobs?status=INTERESTED&priority=HIGH&page=2');
  const panel = page.locator('.saved-ranking'); await expect(panel.locator('form')).toHaveCount(0);
  await panel.locator(':scope > summary').click();
  await expect(panel.getByRole('button', { name: 'Rank saved jobs', exact: true })).toBeEnabled();
  expect(current.rankings).toBe(0); await panel.getByRole('button', { name: 'Load older CV analyses' }).click();
  await panel.getByLabel('CV analysis for ranking').selectOption(cv.id);
  await panel.getByRole('button', { name: 'Rank saved jobs', exact: true }).click();
  const result = panel.getByRole('region', { name: 'Saved-job ranking results' });
  await expect(result.getByRole('status')).toHaveText('6 ranked · 2 need attention or are excluded');
  expect(current.inputs[0]).toEqual({ resumeId: cv.source.resumeId, draftId: cv.id, includeProfileSkills: false, usePreferences: true,
    filters: { status: 'INTERESTED', priority: 'HIGH' } });
  await expect(result.locator('.ranking-list > li')).toHaveCount(5); await expect(result.locator('details[open]')).toHaveCount(0);
  await result.locator('.ranking-list summary').first().click();
  await expect(result.getByText(/3 of 4 weighted skill points/).first()).toBeVisible();
  await expect(result.getByText(/This does not prove you lack these skills/).first()).toBeVisible();
  await expect(result.getByText(/Preference matched/).first()).toBeVisible();
  await result.getByText('Jobs outside the ranking (2)', { exact: true }).click();
  await expect(result.getByText(/Analyze this job first/)).toBeVisible();
  await result.getByRole('button', { name: 'Show all 6 ranked jobs' }).click(); await expect(result.locator('.ranking-list > li')).toHaveCount(6);
  await page.screenshot({ path: '/tmp/careeros-ranking-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: '/tmp/careeros-ranking-mobile.png' });
  await panel.getByLabel('Include my saved profile skills').check(); await expect(result).toHaveCount(0);
  await panel.getByRole('button', { name: 'Rank saved jobs', exact: true }).click();
  await result.locator('.ranking-list summary').first().click(); await expect(result.getByText('Profile only: TypeScript. Check whether your CV supports these skills.').first()).toBeVisible();
  expect(current.analyses).toBe(0);
});

test('ranking recovers from errors and retains private-note edits and navigation protection', async ({ page }) => {
  const current = state(); await mock(page, current); await page.goto('/saved-jobs');
  const panel = page.locator('.saved-ranking'); await panel.locator(':scope > summary').click();
  await panel.getByRole('button', { name: 'Rank saved jobs', exact: true }).click();
  const result = panel.getByRole('region', { name: 'Saved-job ranking results' });
  await result.locator('.ranking-list summary').first().click();
  const notes = page.getByLabel('Private notes'); await notes.fill('Preserve my unsaved observation.');
  page.once('dialog', dialog => dialog.dismiss());
  await result.getByRole('link', { name: 'Python opportunity 1', exact: true }).click();
  await expect(page).toHaveURL(/saved-jobs$/); await expect(notes).toHaveValue('Preserve my unsaved observation.');
  current.fail = true; await panel.getByRole('button', { name: 'Rank saved jobs', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('up to 50'); await expect(panel.getByRole('alert')).toBeFocused(); await expect(result).toHaveCount(0);
  current.fail = false; await panel.getByRole('button', { name: 'Rank saved jobs', exact: true }).click(); await expect(result).toBeVisible();
  await expect(notes).toHaveValue('Preserve my unsaved observation.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible(); await expect(result).toHaveCount(0);
  await panel.getByRole('button', { name: 'Rank saved jobs', exact: true }).click(); await expect(result).toBeVisible();
  await panel.getByLabel('Use my saved role, location and work-mode preferences').uncheck(); await expect(result).toHaveCount(0);
  expect(current.analyses).toBe(0);
});

test('closing the ranking panel cancels pending work and missing CVs show a useful next step', async ({ page }) => {
  const current = state(); await mock(page, current);
  let finish: (() => void) | undefined, cancelled = false;
  const held = new Promise<void>(resolve => { finish = resolve; });
  page.on('requestfailed', request => { if (request.url().endsWith('/rank')) cancelled = true; });
  await page.route('**/api/v1/intelligence/saved-jobs/rank', async route => {
    await held; await route.fulfill({ json: {} }).catch(() => {});
  });
  await page.goto('/saved-jobs'); const panel = page.locator('.saved-ranking'); await panel.locator(':scope > summary').click();
  await panel.getByRole('button', { name: 'Rank saved jobs', exact: true }).click(); await expect(panel.getByRole('status')).toHaveText('Reading saved analyses…');
  await panel.locator(':scope > summary').click(); await expect.poll(() => cancelled).toBe(true); finish!();
  current.empty = true; await panel.locator(':scope > summary').click();
  await expect(panel.getByRole('link', { name: 'Open resumes', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Rank saved jobs', exact: true })).toHaveCount(0);
});
