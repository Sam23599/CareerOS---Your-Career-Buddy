import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  // Only this test's authenticated library is touched, including after an assertion fails.
  const origin = new URL(page.url()).origin;
  const restored = await page.request.post('/api/v1/auth/restore', { headers: { Origin: origin, 'X-CareerOS-Client': 'web' }, data: {} });
  if (!restored.ok()) return;
  const session = await restored.json();
  if (!session.user.email.startsWith('e2e-extract-')) return;
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const library = await page.request.get('/api/v1/resumes', { headers });
  if (library.ok()) for (const resume of (await library.json()).resumes) await page.request.delete(`/api/v1/resumes/${resume.id}`, { headers });
});

test('owned PDF text preview, recoverable warnings, retry, cancellation and empty-text states', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Extraction Tester');
  await page.getByLabel('Email', { exact: true }).fill(`e2e-extract-${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('an extraction testing passphrase');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('link', { name: 'Manage resumes' }).click();
  const document = await page.context().newPage();
  await document.setContent('<h1>Resume Tester Ω</h1><p>Software engineer</p><div style="break-before:page"><h2>Skills</h2><p>Python and TypeScript</p></div>');
  const buffer = await document.pdf();
  // Trigger a real, recoverable xref warning without changing page/object bytes.
  const original = buffer.toString('latin1');
  const repaired = original.replace(/xref\n0 (\d+)\n0000000000 65535 f[ \t]*\n/, (_match, count) => `xref\n1 ${Number(count) - 1}\n`);
  expect(repaired !== original).toBe(true);
  await document.setContent('<html><body></body></html>');
  const blank = await document.pdf();
  await document.close();
  const upload = async (name: string, bytes: Buffer) => {
    await page.getByLabel('Resume file').setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
    await page.getByRole('button', { name: 'Upload resume' }).click();
    await expect(page.getByRole('status')).toHaveText('Resume uploaded.');
  };
  await upload('text.pdf', Buffer.from(repaired, 'latin1'));
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'text.pdf', exact: true }) });
  await card.getByRole('button', { name: 'Extract text', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Text from text.pdf' });
  await expect(preview.getByRole('heading', { name: 'Page 2', exact: true })).toBeVisible();
  await expect(preview.locator('pre').first()).toContainText('Resume Tester Ω');
  await expect(preview.locator('pre').nth(1)).toContainText('Python and TypeScript');
  await expect(preview.getByRole('region', { name: 'Extraction warnings' }).getByRole('status')).toHaveText('Minor PDF structure issues were corrected during extraction. Review the text against your original PDF.');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(card).toContainText('Active resume');
  const routePattern = '**/api/v1/intelligence/resumes/*/extract';
  await page.route(routePattern, route => route.fulfill({ status: 503, json: { error: { code: 'INTELLIGENCE_UNAVAILABLE', message: 'Resume text extraction is temporarily unavailable.' } } }));
  await card.getByRole('button', { name: 'Extract text', exact: true }).click();
  await expect(preview.getByRole('alert')).toHaveText('Resume text extraction is temporarily unavailable.');
  await page.unroute(routePattern);
  await preview.getByRole('button', { name: 'Retry extraction' }).click();
  await expect(preview.locator('pre').first()).toContainText('Resume Tester Ω');
  await preview.getByRole('button', { name: 'Close text preview' }).click();

  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(routePattern, async route => { await pending; await route.abort().catch(() => {}); });
  const failed = page.waitForEvent('requestfailed', request => request.url().includes('/intelligence/resumes/'));
  await card.getByRole('button', { name: 'Extract text', exact: true }).click();
  await expect(preview.getByRole('status')).toHaveText('Extracting text…');
  await preview.getByRole('button', { name: 'Close text preview' }).click();
  await failed;
  release();
  await page.unroute(routePattern);
  await expect(preview).toHaveCount(0);

  await upload('blank.pdf', blank);
  const blankCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'blank.pdf', exact: true }) });
  await blankCard.getByRole('button', { name: 'Extract text', exact: true }).click();
  const blankPreview = page.getByRole('dialog', { name: 'Text from blank.pdf' });
  await expect(blankPreview.getByRole('status')).toContainText('No readable text was found.');
  await expect(blankPreview.getByText('No readable text on this page.')).toBeVisible();
  await blankPreview.getByRole('button', { name: 'Close text preview' }).click();
  page.on('dialog', dialog => dialog.accept());
  await blankCard.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(blankCard).toHaveCount(0);
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No resumes uploaded yet.')).toBeVisible();
});
