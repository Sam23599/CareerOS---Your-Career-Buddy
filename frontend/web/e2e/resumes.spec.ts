import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('upload, select, download and delete private resume versions', async ({ page }) => {
  await page.goto('/resumes'); await expect(page).toHaveURL(/\/login$/);
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Resume Tester');
  await page.getByLabel('Email', { exact: true }).fill(`e2e-${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a resume testing passphrase');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('link', { name: 'Manage resumes' }).click();
  await expect(page.getByText('No resumes uploaded yet.')).toBeVisible();
  const buffer = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
  for (const name of ['first.pdf', 'second.pdf']) {
    await page.getByLabel('Resume file').setInputFiles({ name, mimeType: 'application/pdf', buffer });
    await page.getByRole('button', { name: 'Upload resume' }).click();
    await expect(page.getByRole('status')).toHaveText('Resume uploaded.');
  }
  await page.reload();
  const second = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'second.pdf' }) });
  await second.getByRole('button', { name: 'Make active' }).click();
  await expect(second).toContainText('Active resume');
  const pending = page.waitForEvent('download');
  await second.getByRole('button', { name: 'Download' }).click();
  expect((await pending).suggestedFilename()).toBe('second.pdf');
  page.once('dialog', dialog => dialog.accept());
  await second.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(second).toHaveCount(0);
  await expect(page.getByRole('article')).not.toContainText('Active resume');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No resumes uploaded yet.')).toBeVisible();
});
