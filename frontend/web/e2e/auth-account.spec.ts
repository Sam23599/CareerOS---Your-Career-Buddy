import { test, expect, type Page } from '@playwright/test';
import { type User } from '../src/auth/session';

// Browser interactions use simulated API responses; MongoDB tests verify persistence/security.
async function accountApi(page: Page, pending = false, hasPassword = false) {
  const model = {
    authenticated: true, passwordRequests: 0, reauth: false, dismissed: 0, starts: 0,
    user: { id: 'github-test-user', name: 'Test User', email: 'tester@example.com', username: null, roles: ['USER'],
      hasPassword, oauthProvider: 'github', passwordPromptPending: pending } as User,
  };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const session = () => ({ user: model.user, accessToken: 'simulated-access-token', expiresAt: new Date(Date.now() + 900_000).toISOString() });
    if (path === '/auth/providers') return route.fulfill({ json: { providers: [{ id: 'github', name: 'GitHub', url: `${url.origin}/api/v1/auth/oauth/github/start` }] } });
    if (path === '/auth/logout') { model.authenticated = false; return route.fulfill({ status: 204 }); }
    if (path === '/auth/oauth/github/start') {
      model.starts++;
      if (url.searchParams.get('select_account') === 'true') expect(model.authenticated).toBe(false);
      return route.fulfill({ contentType: 'text/html', body: '<h1>GitHub sign-in required</h1>' });
    }
    if (!model.authenticated) return route.fulfill({ status: 401, json: { error: { message: 'Please sign in again.' } } });
    if (['/auth/restore', '/auth/refresh'].includes(path)) return route.fulfill({ json: session() });
    if (path === '/users/me') return route.fulfill({ json: { user: model.user } });
    if (path === '/auth/username') {
      model.user.username = route.request().postDataJSON().username.toLowerCase() || null;
      return route.fulfill({ json: { user: model.user } });
    }
    if (path === '/notifications') return route.fulfill({ json: { unreadCount: 0 } });
    if (path === '/auth/password-prompt/dismiss') {
      model.dismissed++; model.user.passwordPromptPending = false;
      return route.fulfill({ json: { user: model.user } });
    }
    if (path === '/auth/password') {
      model.passwordRequests++;
      if (model.reauth) return route.fulfill({ status: 403, json: { error: { code: 'REAUTH_REQUIRED', message: 'Sign in again with your provider before adding a password.' } } });
      expect(route.request().postDataJSON()).toEqual({ password: 'a CareerOS test passphrase' });
      model.user.hasPassword = true; model.user.passwordPromptPending = false;
      return route.fulfill({ json: { user: model.user } });
    }
    if (path === '/profiles/me') return route.fulfill({ json: { profile: {
      version: 0, updatedAt: null, fullName: 'Test User', headline: '', summary: '', location: '', phone: '',
      skills: [], experience: [], education: [], certifications: [], links: [],
      preferences: { roles: [], locations: [], workModes: [], experienceLevel: '', salaryMin: null, salaryMax: null, currency: 'USD', salaryPeriod: 'YEAR', interests: [] },
    } } });
    return route.fulfill({ status: 404, json: { error: { message: 'Unexpected simulated API request.' } } });
  });
  return model;
}

test('the first OAuth signup suggests a password once and remembers skipping across reloads', async ({ page }) => {
  const model = await accountApi(page, true);
  await page.goto('/dashboard');
  const dialog = page.getByRole('dialog', { name: 'Make your next login easier' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(model.dismissed).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome, Test User.' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'About your CareerOS password' }).click();
  await expect(page.getByText('A CareerOS password lets you use email and password on the login page.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add optional password' })).toBeVisible();
});

test('password setup checks confirmation and enables direct login on the same account', async ({ page }) => {
  const model = await accountApi(page, true);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Set a password' }).click();
  await page.getByLabel('New CareerOS password').fill('a CareerOS test passphrase');
  await page.getByLabel('Confirm password').fill('a mismatched passphrase');
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
  expect(model.passwordRequests).toBe(0);
  await page.getByLabel('Confirm password').fill('a CareerOS test passphrase');
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/profile');
  await expect(page.getByText('Password is set. You can sign in with your email and password.')).toBeVisible();
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: /^Continue as Test User/ }).click();
  await expect(page.getByLabel('Email or username', { exact: true })).toHaveValue('tester@example.com');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  expect(model.authenticated).toBe(false);
});

test('a restored session continues directly and switching requests GitHub account selection after logout', async ({ page }) => {
  const model = await accountApi(page);
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /^Continue as Test User/ })).toBeVisible();
  await page.getByRole('button', { name: /^Continue as Test User/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(model.starts).toBe(0);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with another GitHub account' }).click();
  await expect(page).toHaveURL(/\/auth\/oauth\/github\/start\?select_account=true$/);
  await expect(page.getByRole('heading', { name: 'GitHub sign-in required' })).toBeVisible();
  expect(model.starts).toBe(1);
  expect(model.authenticated).toBe(false);
});

test('remembered details survive sign-out but do not authorize protected pages or direct continuation', async ({ page }) => {
  const model = await accountApi(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Continue as Test User/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Sign in again to continue with this account.')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('careeros_last_account')!)))).toEqual(['id', 'name', 'email', 'hasPassword', 'oauthProvider']);
  await page.getByRole('button', { name: /^Continue as Test User/ }).click();
  await expect(page.getByRole('heading', { name: 'GitHub sign-in required' })).toBeVisible();
  expect(model.authenticated).toBe(false);
});

test('password setup in an older session offers provider confirmation and stays optional', async ({ page }) => {
  const model = await accountApi(page);
  model.reauth = true;
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Add optional password' }).click();
  await page.getByLabel('New CareerOS password').fill('a CareerOS test passphrase');
  await page.getByLabel('Confirm password').fill('a CareerOS test passphrase');
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Sign in again with your provider before adding a password.');
  await page.getByRole('button', { name: 'Confirm with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub sign-in required' })).toBeVisible();
  expect(model.user.hasPassword).toBe(false);
});
