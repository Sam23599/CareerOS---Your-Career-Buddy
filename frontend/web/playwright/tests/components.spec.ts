import { test, expect, type Page } from '@playwright/test';

const session = { user: { id: 'test-user', name: 'Tester', email: 'tester@example.com', roles: ['USER'] }, accessToken: 'test-access-token', expiresAt: new Date(Date.now() + 900_000).toISOString() };
test.beforeEach(async ({ page }) => {
  // Every component request is mocked; these tests need no running API or database.
  await page.route('**/api/v1/**', route => route.fulfill({ status: 404, json: { error: { message: 'Unexpected component request' } } }));
  await page.route(/\/api\/v1\/auth\/(restore|refresh)$/, route => route.fulfill({ json: session }));
});

test('tag input trims entries, drops blanks and reports cleared values', async ({ mount }) => {
  const component = await mount('Tags');
  await expect(component.getByLabel('Skills')).toHaveValue('TypeScript');
  await component.getByLabel('Skills').fill(' React, , TypeScript , MongoDB ');
  await expect(component.getByLabel('Saved values')).toHaveText('["React","TypeScript","MongoDB"]');
  await component.getByLabel('Skills').fill('');
  await expect(component.getByLabel('Saved values')).toHaveText('[]');
});

test('entry controls preserve other entries, enforce limits and clear dates for current roles', async ({ mount }) => {
  const component = await mount('Experience');
  await component.getByRole('button', { name: 'Add experience' }).click();
  await expect(component.getByRole('button', { name: 'Add experience' })).toBeDisabled();
  const first = component.getByRole('group', { name: 'Experience 1', exact: true });
  const second = component.getByRole('group', { name: 'Experience 2', exact: true });
  await second.getByLabel('Company').fill('Second Company');
  await first.getByLabel('Current role').check();
  await expect(first.getByLabel('End date')).toBeDisabled();
  await expect(first.getByLabel('End date')).toHaveValue('');
  await expect(second.getByLabel('Company')).toHaveValue('Second Company');
  await first.getByRole('button', { name: 'Remove experience 1' }).click();
  await expect(component.getByLabel('Company')).toHaveValue('Second Company');
  await expect(component.getByRole('button', { name: 'Add experience' })).toBeEnabled();
});

test('OAuth options show loading and enable only configured GitHub sign-in', async ({ page, mount }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/auth/providers', async route => {
    await ready;
    await route.fulfill({ json: { providers: [{ id: 'github', name: 'GitHub', url: 'http://localhost:5173/api/v1/auth/oauth/github/start' }] } });
  });
  const component = await mount('OAuth');
  try {
    await expect(component.getByRole('status')).toHaveText('Checking sign-in options…');
    await expect(component.getByRole('button', { name: 'Continue with GitHub' })).toBeDisabled();
  } finally { release(); }
  await expect(component.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute('href', 'http://localhost:5173/api/v1/auth/oauth/github/start');
  await expect(component.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
});

test('unconfigured OAuth providers remain visible with an explanation', async ({ page, mount }) => {
  await page.route('**/api/v1/auth/providers', route => route.fulfill({ json: { providers: [] } }));
  const component = await mount('OAuth');
  await expect(component.getByRole('status')).toContainText('Google and GitHub sign-in is not available yet.');
  await expect(component.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  await expect(component.getByRole('button', { name: 'Continue with GitHub' })).toBeDisabled();
});

test('OAuth lookup failure leaves email sign-in available', async ({ page, mount }) => {
  await page.route('**/api/v1/auth/providers', route => route.fulfill({ status: 503 }));
  const component = await mount('OAuth');
  await expect(component.getByRole('status')).toContainText('Refresh the page or use email.');
  await expect(component.getByRole('button', { name: 'Continue with GitHub' })).toBeDisabled();
});

async function previewRoute(page: Page) {
  await page.route('**/api/v1/resumes/test-resume/download', route => route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }));
}
test('resume preview displays a private PDF and releases its object URL on close', async ({ page, mount }) => {
  await previewRoute(page);
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = value => { document.body.dataset.revokedPreview = value; revoke.call(URL, value); };
  });
  const component = await mount('Preview');
  const dialog = component.getByRole('dialog', { name: 'Resume.pdf' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTitle('Preview of Resume.pdf')).toHaveAttribute('src', /^blob:/);
  const url = await dialog.getByTitle('Preview of Resume.pdf').getAttribute('src');
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  await expect(component.getByText('Preview closed')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-revoked-preview', url!);
});

test('resume preview reports download errors and supports Escape dismissal', async ({ page, mount }) => {
  await page.route('**/api/v1/resumes/test-resume/download', route => route.fulfill({ status: 404, json: { error: { message: 'This resume is unavailable.' } } }));
  const component = await mount('Preview');
  await expect(component.getByRole('alert')).toHaveText('This resume is unavailable.');
  await page.keyboard.press('Escape');
  await expect(component.getByText('Preview closed')).toBeVisible();
});

test('saved-job control saves once and respects cancelled removal', async ({ page, mount }) => {
  let saved = false, mutations = 0;
  await page.route('**/api/v1/saved-jobs/test-job', route => {
    if (route.request().method() !== 'GET') { mutations++; saved = route.request().method() === 'PUT'; }
    return route.fulfill({ json: { savedJob: saved ? { id: 'saved' } : null } });
  });
  const component = await mount('SavedJob');
  await component.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(component.getByRole('button', { name: 'Unsave job' })).toBeEnabled();
  await expect(component.getByRole('link', { name: 'Manage saved jobs' })).toHaveAttribute('href', '/saved-jobs');
  page.once('dialog', dialog => dialog.dismiss());
  await component.getByRole('button', { name: 'Unsave job' }).click();
  expect(mutations).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await component.getByRole('button', { name: 'Unsave job' }).click();
  await expect(component.getByRole('button', { name: 'Save job', exact: true })).toBeEnabled();
  expect(mutations).toBe(2);
});

test('saved-job control reports lookup errors and retries successfully', async ({ page, mount }) => {
  let requests = 0;
  await page.route('**/api/v1/saved-jobs/test-job', route => ++requests === 1
    ? route.fulfill({ status: 503, json: { error: { message: 'Saved jobs are temporarily unavailable.' } } })
    : route.fulfill({ json: { savedJob: null } }));
  const component = await mount('SavedJob');
  await expect(component.getByRole('alert')).toHaveText('Saved jobs are temporarily unavailable.');
  await component.getByRole('button', { name: 'Retry saved status' }).click();
  await expect(component.getByRole('button', { name: 'Save job', exact: true })).toBeEnabled();
  await expect(component.getByRole('alert')).toHaveCount(0);
});

test('anonymous users receive a sign-in link instead of save actions', async ({ page, mount }) => {
  await page.route('**/api/v1/auth/restore', route => route.fulfill({ status: 401, json: { error: { message: 'Please sign in again.' } } }));
  const component = await mount('SavedJob');
  await expect(component.getByRole('link', { name: 'Sign in to save jobs' })).toHaveAttribute('href', '/login');
  await expect(component.getByRole('button')).toHaveCount(0);
});
