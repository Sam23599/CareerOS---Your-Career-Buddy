import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('registration, protected dashboard, restoration, cross-tab logout, and login', async ({ page, context }) => {
  const email = `e2e-${randomUUID()}@example.com`;
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
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });

  await page.reload();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto('/dashboard');
  await expect(second.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(second).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
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
