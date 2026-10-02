import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

for (const navigation of ['reload', 'navigate'] as const) {
  test(`session restoration survives ${navigation} after the server responds but delivery is interrupted`, async ({ page, context }) => {
    const email = `e2e-interrupted-${randomUUID()}@example.com`;
    await page.goto('/register');
    await page.getByLabel('Your name').fill('Interrupted Restore Tester');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('an interrupted browser passphrase');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    const cookie = (await context.cookies()).find(value => value.name === 'careeros_refresh')!.value;
    let markProcessed!: () => void, release!: () => void;
    const processed = new Promise<void>(resolve => { markProcessed = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    await page.route(/\/api\/v1\/auth\/(restore|refresh)$/, async route => {
      if (intercepted) return route.continue();
      intercepted = true;
      // Send to the real API, then discard its response instead of delivering it to the browser.
      const request = route.request();
      // Node fetch has no browser cookie jar, so Set-Cookie cannot reach the interrupted page.
      const response = await fetch(request.url(), { method: request.method(), headers: await request.allHeaders(), body: request.postData() });
      expect(response.status).toBe(200);
      await response.text();
      markProcessed();
      await held;
      await route.abort().catch(() => { /* Navigation may have already cancelled this request. */ });
    });
    try {
      await page.goto('/saved-jobs', { waitUntil: 'domcontentloaded' });
      await processed;
      if (navigation === 'reload') await page.reload();
      else await page.goto('/dashboard');
      release();
      if (navigation === 'reload') await expect(page.getByRole('heading', { name: 'Saved jobs', exact: true })).toBeVisible();
      else await expect(page.getByText(email, { exact: true })).toBeVisible();
      expect((await context.cookies()).find(value => value.name === 'careeros_refresh')!.value === cookie).toBe(true);
      await page.goto('/dashboard');
      await expect(page.getByText(email, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
    } finally { release(); }
  });
}

test('registration, protected dashboard, restoration, cross-tab logout, and login', async ({ page, context }) => {
  const email = `e2e-${randomUUID()}@example.com`;
  const username = `browser_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const password = 'a browser test passphrase';
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.request.get('/api/v1/users/me')).status()).toBe(401);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Browser Tester');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const cookie = (await context.cookies()).find(value => value.name === 'careeros_refresh');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => ({ local: JSON.parse(localStorage.getItem('careeros_last_account')!), session: sessionStorage.length }))).toEqual({
    local: { id: expect.any(String), name: 'Browser Tester', email, hasPassword: true, oauthProvider: null }, session: 0,
  });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Add username', exact: true }).click();
  await page.getByLabel('CareerOS username').fill(username);
  await page.getByRole('button', { name: 'Save username', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Username saved.');
  await page.goto('/login');
  await page.getByRole('button', { name: /^Continue as Browser Tester/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.reload();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const second = await context.newPage();
  await Promise.all([page.reload(), second.goto('/dashboard')]);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(second.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(second).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Continue as Browser Tester' }).click();
  await page.getByLabel('Email or username', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Your sign-in details are incorrect.');
  await page.getByLabel('Email or username', { exact: true }).fill(username.toUpperCase());
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('an expired access response refreshes once before retrying the protected API', async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Refresh Tester');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('another browser passphrase');
  let calls = 0;
  await page.route('**/api/v1/users/me', async route => {
    calls++;
    if (calls === 1) await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"Expired"}}' });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(calls).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
