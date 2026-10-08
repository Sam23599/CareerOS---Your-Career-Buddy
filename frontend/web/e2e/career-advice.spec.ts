import { test, expect } from '@playwright/test';
import cv from '../../../backend/platform/test/fixtures/resume-draft.json' with { type: 'json' };
import jd from '../../../backend/platform/test/fixtures/job-analysis.json' with { type: 'json' };
import match from '../../../backend/platform/test/fixtures/matching.json' with { type: 'json' };
import review from '../../../backend/platform/test/fixtures/resume-review.json' with { type: 'json' };
import planFixture from '../../../backend/platform/test/fixtures/preparation-roadmap.json' with { type: 'json' };
import cadyFixture from '../../../backend/platform/test/fixtures/cady.json' with { type: 'json' };

const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Advice Tester', email: 'advice@example.com', roles: ['USER'], hasPassword: true, passwordPromptPending: false };
const fields = Object.fromEntries(jd.source.sections.map(section => [section.id, section.text]));
const job = { id: jd.source.jobId, ...fields, source: 'fixture', sourceUrl: 'https://example.com/job', skills: [], employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', metadata: {}, postedAt: null, expiresAt: null, updatedAt: jd.createdAt };
const models = { available: true, provider: 'openai', models: [{ id: 'gpt-6-luna', reasoningOptions: ['low', 'medium', 'high'] }, { id: 'gpt-4.1', reasoningOptions: [] }], defaultModel: 'gpt-6-luna', defaultReasoning: 'medium' };

test('preparation requires explicit generation, survives navigation and preserves reviewed versions without new AI', async ({ page }) => {
  let generated = 0, succeeded = false, accepted = false, edited = false;
  const plan = structuredClone(planFixture);
  const task = { id: '33333333-3333-4333-8333-333333333333', kind: 'preparation', jobId: job.id, sourceHash: jd.source.sha256,
    createdAt: plan.createdAt, updatedAt: plan.createdAt, state: 'running', analysisId: null as string | null, errorCode: null };
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (/\/auth\/(restore|refresh)$/.test(path)) return route.fulfill({ json: { user, accessToken: 'mock-advice-session', expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/users/me')) return route.fulfill({ json: { user } });
    if (path.endsWith('/notifications')) return route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, limit: 20 } });
    if (path === `/api/v1/jobs/${job.id}`) return route.fulfill({ json: { job } });
    if (path === `/api/v1/saved-jobs/${job.id}`) return route.fulfill({ json: { savedJob: null } });
    if (path === '/api/v1/resumes') return route.fulfill({ json: { resumes: [{ id: cv.source.resumeId, name: 'My CV.pdf', version: cv.source.resumeVersion, active: true, size: 1024, uploadedAt: cv.createdAt }] } });
    if (path.endsWith('/drafts')) return route.fulfill({ json: { versions: [{ id: cv.id, version: cv.version, model: cv.model, reasoning: cv.reasoning, createdAt: cv.createdAt }], nextBeforeVersion: null } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: models });
    if (path.endsWith('/analyses')) return route.fulfill({ json: { versions: [{ id: jd.id, version: jd.version, model: jd.model, reasoning: jd.reasoning, createdAt: jd.createdAt, sourceHash: jd.source.sha256, stale: false }], nextBeforeVersion: null } });
    if (path.endsWith('/analysis')) return route.fulfill({ json: { analysis: jd, sourceStatus: { stale: false, expired: false } } });
    if (path.endsWith('/review') && route.request().method() === 'POST') return route.fulfill({ json: { report: { ...review, match }, sourceStatus: { expired: false } } });
    if (path.endsWith('/tasks')) return route.fulfill({ json: { tasks: accepted ? [{ ...task, state: succeeded ? 'succeeded' : 'running', analysisId: succeeded ? plan.id : null }] : [] } });
    if (path.endsWith('/preparation-plans')) {
      if (route.request().method() === 'POST') {
        generated++; accepted = true;
        const input = route.request().postDataJSON();
        expect(input.draftId).toBe(cv.id); expect(input.jobAnalysisId).toBe(jd.id); expect(input.profileVersion).toBeNull(); expect(input.goals.choices.find((item: { matchIndex: number }) => item.matchIndex === 1).classification).toBe('want_to_learn');
        return route.fulfill({ status: 202, json: { taskId: task.id } });
      }
      return route.fulfill({ json: { versions: succeeded ? [{ id: plan.id, version: plan.version, source: plan.source, model: plan.model, reasoning: plan.reasoning, createdAt: plan.createdAt, reviewRevision: plan.review.revision }] : [], nextBeforeVersion: null } });
    }
    if (path.endsWith('/review') && route.request().method() === 'PATCH') {
      edited = true; const input = route.request().postDataJSON(); expect(input.revision).toBe(0);
      plan.review = { revision: 1, actions: input.actions };
      return route.fulfill({ json: { record: plan, match, sourceStatus: { stale: false, expired: false, profileChanged: false } } });
    }
    if (path.includes('/preparation-plans/')) return route.fulfill({ json: { record: plan, match, sourceStatus: { stale: false, expired: false, profileChanged: false } } });
    return route.fulfill({ status: 404, json: { error: { message: 'Unconfigured endpoint.' } } });
  });
  await page.goto(`/jobs/${job.id}`);
  const section = page.getByRole('region', { name: 'Personalized AI preparation', exact: true });
  await expect(section.getByRole('button', { name: 'Create AI preparation plan' })).toBeDisabled(); expect(generated).toBe(0);
  await page.getByRole('button', { name: 'Review fit & gaps', exact: true }).click();
  await section.getByRole('button', { name: 'Create AI preparation plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Personalized preparation' });
  await expect(dialog.getByRole('button', { name: 'Generate preparation plan' })).toBeDisabled(); expect(generated).toBe(0);
  await dialog.getByLabel('Your view of TypeScript', { exact: true }).selectOption('want_to_learn');
  await dialog.getByRole('checkbox', { name: /I have reviewed/ }).check();
  await dialog.getByRole('button', { name: 'Generate preparation plan' }).click();
  await expect(dialog.getByRole('status')).toContainText('continues');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await page.reload(); await expect(section.getByRole('status')).toContainText('running');
  succeeded = true;
  await expect(section.getByRole('button', { name: 'Review plan version 1' })).toBeVisible({ timeout: 12000 });
  await section.getByRole('button', { name: 'Review plan version 1' }).click();
  await expect(dialog.getByRole('navigation', { name: 'Roadmap weeks' }).getByRole('button')).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: /^Week 2/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue preparation', exact: true }).click();
  await expect(dialog.locator('.roadmap-session').first()).toBeFocused();
  await expect(dialog.getByRole('heading', { name: /^Week 1/ })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Progress', exact: true }).first()).toHaveValue('planned');
  expect(edited).toBe(false);
  await dialog.getByText('Customize session', { exact: true }).first().click();
  await dialog.getByLabel('Action title').first().fill('My typed API practice');
  await dialog.getByRole('combobox', { name: 'Progress', exact: true }).first().selectOption('done');
  await dialog.getByRole('button', { name: 'Save reviewed plan' }).click();
  await expect(dialog.getByText(/Review revision 1/)).toBeVisible(); expect(edited).toBe(true); expect(generated).toBe(1);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/careeros-preparation-mobile.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(dialog).toHaveCount(0);
});

test('Cady waits for explicit questions, explains cited context, persists history across refresh and the quick widget, and clears changed context', async ({ page }) => {
  let calls = 0, revision = 0;
  let savedTurns: { question: string; result: typeof cadyFixture & { conversationRevision: number } }[] = [];
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (/\/auth\/(restore|refresh)$/.test(path)) return route.fulfill({ json: { user, accessToken: 'mock-cady-session', expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/users/me')) return route.fulfill({ json: { user } });
    if (path.endsWith('/notifications')) return route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, limit: 20 } });
    if (path === '/api/v1/resumes') return route.fulfill({ json: { resumes: [{ id: cv.source.resumeId, name: 'My CV.pdf', version: 1, active: true }] } });
    if (path === '/api/v1/saved-jobs') return route.fulfill({ json: { savedJobs: [{ jobId: job.id, available: true, status: 'SAVED', job }], total: 1 } });
    if (path.endsWith('/drafts')) return route.fulfill({ json: { versions: [{ id: cv.id, version: cv.version, model: cv.model }], nextBeforeVersion: null } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: models });
    if (path.endsWith('/analyses')) return route.fulfill({ json: { versions: [{ id: jd.id, version: 1, stale: false }] } });
    if (path.endsWith('/cady/conversation')) return route.fulfill({ json: { conversation: { revision, context: savedTurns.length ? { resume: cv.source, draftId: cv.id, jobs: [{ jobId: job.id, jobHash: jd.source.sha256, jobAnalysisId: jd.id }], profile: null, model: 'gpt-6-luna', reasoning: 'medium' } : null, turns: savedTurns, updatedAt: null }, unavailable: false, outdated: false } });
    if (path.endsWith('/cady/conversation/reset')) { expect(route.request().postDataJSON().revision).toBe(revision); revision++; savedTurns = []; return route.fulfill({ json: { revision, context: null, turns: [], updatedAt: null } }); }
    if (path.endsWith('/cady/ask')) {
      calls++; const input = route.request().postDataJSON();
      expect(input.resumeId).toBe(cv.source.resumeId); expect(input.jobs).toEqual([{ jobId: job.id, jobAnalysisId: jd.id }]);
      expect(input.history).toEqual([]); expect(input.revision).toBe(revision); expect(Object.keys(input)).not.toContain('owner');
      revision++; const result = { ...cadyFixture, conversationRevision: revision }; savedTurns.push({ question: input.question, result });
      return route.fulfill({ json: result });
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Unconfigured endpoint.' } } });
  });
  await page.goto('/cady');
  await expect(page.locator('.cady-context')).not.toHaveAttribute('open');
  await page.getByText('Choose context · 0 of 3 jobs selected', { exact: true }).click();
  await page.getByText('Selected & saved jobs (optional)', { exact: true }).click();
  await page.getByRole('checkbox', { name: `${job.title} · ${job.company}` }).check();
  await expect(page.getByLabel(`Job analysis for ${job.title}`)).toHaveValue(jd.id);
  expect(calls).toBe(0);
  await page.getByLabel('Your question', { exact: true }).fill('How should I prepare?');
  await page.getByRole('button', { name: 'Ask Cady', exact: true }).click();
  await expect(page.getByText('Your CV includes Python. Advice: practice TypeScript for this role.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cady', exact: true }).first()).toBeInViewport();
  await page.screenshot({ path: '/tmp/careeros-cady-desktop.png', animations: 'disabled' });
  await page.getByText('Sources (2)', { exact: true }).click(); await expect(page.getByText('Selected CV skill', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'What would you like to practice first?' }).click();
  await page.getByRole('button', { name: 'Ask Cady', exact: true }).click();
  await expect(page.locator('.cady-turn')).toHaveCount(2); expect(calls).toBe(2);
  await page.reload(); await expect(page.locator('.cady-turn')).toHaveCount(2); expect(calls).toBe(2);
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Task history' }).click();
  await page.getByRole('button', { name: 'Open Cady quick chat' }).click();
  const widget = page.getByRole('dialog', { name: 'Cady', exact: true });
  await expect(widget.locator('.cady-turn')).toHaveCount(2);
  await page.setViewportSize({ width: 375, height: 812 });
  await widget.getByLabel('Your question', { exact: true }).focus();
  await page.keyboard.press('Tab');
  expect(await widget.evaluate(element => element.contains(document.activeElement))).toBe(true);
  expect(await widget.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/careeros-cady-widget-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape'); await expect(widget).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Cady quick chat' })).toBeFocused();
  await page.getByRole('button', { name: 'Open Cady quick chat' }).click();
  await widget.getByRole('link', { name: 'Full page' }).click();
  await expect(page.locator('.cady-turn')).toHaveCount(2);
  await page.getByText('Choose context · 1 of 3 jobs selected', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include profile skills (self-reported)' }).click();
  await expect(page.getByRole('checkbox', { name: 'Include profile skills (self-reported)' })).toBeChecked();
  await expect(page.locator('.cady-turn')).toHaveCount(0); expect(calls).toBe(2);
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/careeros-cady-mobile-dark.png', fullPage: true, animations: 'disabled' });
  await page.reload(); await expect(page.locator('.cady-turn')).toHaveCount(0); expect(calls).toBe(2);
});

test('Cady preserves a linked CV analysis outside the first history page without generating', async ({ page }) => {
  let calls = 0, reads = 0;
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (/\/auth\/(restore|refresh)$/.test(path)) return route.fulfill({ json: { user, accessToken: 'mock-linked-cady-session', expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/users/me')) return route.fulfill({ json: { user } });
    if (path.endsWith('/notifications')) return route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, limit: 20 } });
    if (path === '/api/v1/resumes') return route.fulfill({ json: { resumes: [{ id: cv.source.resumeId, name: 'My CV.pdf', version: 1, active: true }] } });
    if (path === '/api/v1/saved-jobs') return route.fulfill({ json: { savedJobs: [], total: 0 } });
    if (path.endsWith('/drafts')) return route.fulfill({ json: { versions: [{ id: '66666666-6666-4666-8666-666666666666', version: 30, model: cv.model }], nextBeforeVersion: 30 } });
    if (path.endsWith('/draft')) { reads++; expect(url.searchParams.get('analysisId')).toBe(cv.id); return route.fulfill({ json: cv }); }
    if (path.endsWith('/capabilities')) return route.fulfill({ json: models });
    if (path.endsWith('/cady/conversation')) return route.fulfill({ json: { conversation: { revision: 0, context: null, turns: [], updatedAt: null }, unavailable: false, outdated: false } });
    if (path.endsWith('/cady/ask')) { calls++; return route.fulfill({ json: cadyFixture }); }
    return route.fulfill({ status: 404, json: { error: { message: 'Unconfigured endpoint.' } } });
  });
  await page.goto(`/cady?resumeId=${cv.source.resumeId}&draftId=${cv.id}`);
  await page.getByText('Choose context · 0 of 3 jobs selected', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'CV analysis', exact: true })).toHaveValue(cv.id);
  expect(reads).toBe(1); expect(calls).toBe(0);
});
