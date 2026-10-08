import { test, expect } from '@playwright/test';

const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Workspace Tester', email: 'workspace@example.com', roles: ['USER'], username: null, hasPassword: true, oauthProvider: null, passwordPromptPending: false };
const profile = { fullName: user.name, headline: 'Software engineer', summary: '', location: '', phone: '', skills: [], experience: [], education: [], certifications: [], links: [], version: 1, updatedAt: null,
  preferences: { roles: [], locations: [], workModes: [], experienceLevel: '', salaryMin: null, salaryMax: null, currency: 'USD', salaryPeriod: 'YEAR', interests: [] } };
const saved = { jobId: 'a'.repeat(64), status: 'SAVED', priority: 'MEDIUM', notes: '', revision: '11111111-1111-4111-8111-111111111111', savedAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', available: true,
  job: { title: 'Frontend Engineer', company: 'Example', location: 'Remote', source: 'remotive', sourceUrl: 'https://example.com/jobs/engineer', remoteType: 'REMOTE', employmentType: 'FULL_TIME', expiresAt: null } };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    if (/\/auth\/(restore|refresh)$/.test(url.pathname)) return route.fulfill({ json: { user, accessToken: 'mock-ui-session', expiresAt: '2030-01-01T00:00:00Z' } });
    if (url.pathname.endsWith('/users/me')) return route.fulfill({ json: { user } });
    if (url.pathname.endsWith('/profiles/me')) return route.fulfill({ json: { profile } });
    if (url.pathname.endsWith('/notifications')) return route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, limit: 20 } });
    if (url.pathname.endsWith('/saved-jobs')) return route.fulfill({ json: { savedJobs: [saved], total: 1, page: 1, limit: 20 } });
    if (url.pathname.endsWith('/jobs/sources')) return route.fulfill({ json: { sources: ['remotive'] } });
    if (url.pathname.endsWith('/jobs')) return route.fulfill({ json: { jobs: [], total: 0, page: 1, limit: 20 } });
    return route.fulfill({ status: 404, json: { error: { message: 'Unconfigured test endpoint.' } } });
  });
});

test('workspace navigation preserves discard confirmations for profile and saved-job edits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/profile/edit');
  await page.getByLabel('Headline', { exact: true }).fill('Unsaved profile headline');
  const overview = page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Overview', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await overview.click();
  await expect(page).toHaveURL(/\/profile\/edit$/);
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue('Unsaved profile headline');
  page.once('dialog', dialog => dialog.accept());
  await overview.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/saved-jobs?priority=HIGH');
  await page.getByLabel('Private notes').fill('Keep filtered-view notes');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Saved jobs', exact: true }).click();
  await expect(page).toHaveURL(/\/saved-jobs\?priority=HIGH$/);
  await expect(page.getByLabel('Private notes')).toHaveValue('Keep filtered-view notes');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Saved jobs', exact: true }).click();
  await expect(page).toHaveURL(/\/saved-jobs$/);
  await expect(page.getByLabel('Private notes')).toHaveValue('');
  await page.getByLabel('Private notes').fill('Keep these unsaved notes');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss());
  await overview.click();
  await expect(page).toHaveURL(/\/saved-jobs$/);
  await expect(page.getByLabel('Private notes')).toHaveValue('Keep these unsaved notes');
  page.once('dialog', dialog => dialog.accept());
  await overview.click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('mobile navigation supports keyboard dismissal and preserves all destination links', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/dashboard');
  await expect(page.locator('.workspace-sidebar')).not.toBeVisible();
  await page.getByRole('button', { name: 'Open workspace navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Mobile workspace', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(7);
  await navigation.getByRole('link', { name: 'Saved jobs', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(navigation).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open workspace navigation' })).toBeFocused();
  await page.getByRole('button', { name: 'Open workspace navigation' }).click();
  await navigation.getByRole('link', { name: 'Saved jobs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved jobs', exact: true })).toBeVisible();
  await expect(navigation).not.toBeVisible();
  await expect(page.locator('#workspace-content')).toBeFocused();
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('skip link reaches the main content and reduced motion removes transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard');
  await page.getByRole('heading', { name: `Welcome, ${user.name}.`, exact: true }).waitFor();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-content')).toBeFocused();
  expect(await page.locator('.dashboard-tool').first().evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
});
