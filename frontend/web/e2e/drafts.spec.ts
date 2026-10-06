import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import fixture from '../../../backend/platform/test/fixtures/resume-draft.json' with { type: 'json' };

test.afterEach(async ({ page }) => {
  const origin = new URL(page.url()).origin;
  const restored = await page.request.post('/api/v1/auth/restore', { headers: { Origin: origin, 'X-CareerOS-Client': 'web' }, data: {} });
  if (!restored.ok()) return;
  const session = await restored.json();
  if (!session.user.email.startsWith('e2e-draft-')) return;
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const library = await page.request.get('/api/v1/resumes', { headers });
  if (library.ok()) for (const resume of (await library.json()).resumes) await page.request.delete(`/api/v1/resumes/${resume.id}`, { headers });
});

test('draft generation is explicit, shows evidence, keeps review edits on conflict and requires confirmation', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Draft Tester');
  await page.getByLabel('Email', { exact: true }).fill(`e2e-draft-${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a draft testing passphrase');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('link', { name: 'Manage resumes' }).click();
  const document = await page.context().newPage();
  await document.setContent('<h1>Resume Tester</h1><p>Software engineer</p><p>Python</p>');
  const buffer = await document.pdf(); await document.close();
  await page.getByLabel('Resume file').setInputFiles({ name: 'draft.pdf', mimeType: 'application/pdf', buffer });
  await page.getByRole('button', { name: 'Upload resume' }).click();
  await expect(page.getByRole('status')).toHaveText('Resume uploaded.');
  let generated = 0; let applies = 0;
  const versions: (typeof fixture)[] = [];
  await page.route('**/api/v1/intelligence/capabilities', route => route.fulfill({ json: {
    available: true, models: [{ id: 'gpt-4.1', reasoningOptions: [] }, { id: 'gpt-6-luna', reasoningOptions: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
      { id: 'gpt-6.1-sol', reasoningOptions: ['low', 'medium', 'high', 'xhigh', 'max'] }], defaultModel: 'gpt-6-luna', defaultReasoning: 'medium',
  } }));
  await page.route(/\/api\/v1\/intelligence\/resumes\/[^/]+\/draft(?:\?.*)?$/, route => {
    const id = new URL(route.request().url()).searchParams.get('analysisId');
    const saved = id ? versions.find(item => item.id === id) : versions.at(-1);
    return saved ? route.fulfill({ json: saved }) : route.fulfill({ status: 404, json: { error: { code: 'ANALYSIS_NOT_FOUND', message: 'No saved draft.' } } });
  });
  await page.route('**/api/v1/intelligence/resumes/*/drafts', route => route.fulfill({ json: {
    versions: [...versions].reverse().map(({ id, version, model, reasoning, createdAt }) => ({ id, version, model, reasoning, createdAt })), nextBeforeVersion: null,
  } }));
  await page.route('**/api/v1/intelligence/resumes/*/analyze', async route => {
    generated++; expect(route.request().postDataJSON()).toEqual({ model: 'gpt-4.1', reasoning: null });
    const record = { ...fixture, id: generated === 1 ? fixture.id : randomUUID(), version: generated, model: 'gpt-4.1', reasoning: null };
    versions.push(record); await route.fulfill({ json: record });
  });
  await page.route('**/api/v1/intelligence/resumes/*/draft/apply', async route => {
    applies++;
    const body = route.request().postDataJSON();
    expect(body.analysisId).toBe(fixture.id);
    expect(Object.keys(body.patch).sort()).toEqual(['headline', 'skills', 'version']);
    expect(body.patch.headline).toBe('Reviewed engineer');
    if (applies === 1) {
      await route.fulfill({ status: 409, json: { error: { code: 'PROFILE_CONFLICT', message: 'Your profile changed in another tab.' } } }); return;
    }
    const profile = await page.request.get('/api/v1/profiles/me', { headers: { Authorization: `Bearer ${(await (await page.request.post('/api/v1/auth/restore', { headers: { Origin: new URL(page.url()).origin, 'X-CareerOS-Client': 'web' }, data: {} })).json()).accessToken}` } });
    await route.fulfill({ json: { profile: { ...(await profile.json()).profile, ...body.patch, version: 1 } } });
  });
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Resume draft — draft.pdf' });
  await expect(dialog.getByRole('button', { name: 'Analyze resume', exact: true })).toBeEnabled();
  expect(generated).toBe(0);
  await dialog.getByLabel('AI model').selectOption('gpt-4.1');
  await expect(dialog.getByLabel('Reasoning effort')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Analyze resume', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review profile fields', exact: true })).toBeVisible();
  expect(generated).toBe(1); expect(applies).toBe(0);
  await expect(dialog.getByLabel('Saved draft version')).toContainText('Version 1');
  await dialog.getByRole('button', { name: 'Analyze with selected settings', exact: true }).click();
  await expect(dialog.getByLabel('Saved draft version')).toHaveValue(versions[1].id);
  expect(generated).toBe(2);
  await dialog.getByLabel('Saved draft version').selectOption(versions[0].id);
  await expect(dialog.getByLabel('Saved draft version')).toHaveValue(fixture.id);
  await expect(dialog.getByText(/^Saved draft · Version 1/)).toBeVisible();
  expect(generated).toBe(2);
  await dialog.getByText('All extracted details and source evidence', { exact: true }).click();
  await expect(dialog.locator('.draft-fact').filter({ hasText: /^Resume Tester$/ })).toBeVisible();
  await dialog.locator('summary').filter({ hasText: /^Source evidence$/ }).first().click();
  await expect(dialog.getByText('Page 1', { exact: true }).first()).toBeVisible();
  await dialog.getByLabel('Apply Headline', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Expand all fields' }).click();
  await dialog.getByLabel('Headline', { exact: true }).fill('Reviewed engineer');
  await dialog.getByLabel('Apply Skills', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Preview selected changes', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Profile change preview' })).toContainText('Reviewed engineer');
  expect(applies).toBe(0);
  await dialog.getByRole('button', { name: 'Confirm and apply to profile', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed in another tab');
  await expect(dialog.getByLabel('Headline', { exact: true })).toHaveValue('Reviewed engineer');
  await dialog.getByRole('button', { name: 'Reload latest profile' }).click();
  await dialog.getByRole('button', { name: 'Preview selected changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm and apply to profile', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Selected fields applied');
  await dialog.getByRole('button', { name: 'Close draft review' }).click();
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review profile fields', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Saved draft version')).toHaveValue(versions[1].id);
  await expect(dialog.getByLabel('Saved draft version').locator('option')).toHaveCount(2);
  expect(generated).toBe(2);
});
