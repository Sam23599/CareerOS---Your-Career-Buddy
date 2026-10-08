import { test, expect, type Page } from '@playwright/test';
import cv from '../../../backend/platform/test/fixtures/resume-draft.json' with { type: 'json' };
import answer from '../../../backend/platform/test/fixtures/cady.json' with { type: 'json' };

const user = { id: '11111111-1111-4111-8111-111111111111', name: 'Foundation Tester', email: 'foundation@example.com', roles: ['USER'], hasPassword: true };
const resume = { id: cv.source.resumeId, name: 'Foundation CV.pdf', version: 1, active: true, size: 1024, uploadedAt: cv.createdAt };
const models = { available: true, provider: 'openai', models: [{ id: 'gpt-6-luna', reasoningOptions: ['medium'] }], defaultModel: 'gpt-6-luna', defaultReasoning: 'medium' };

async function mockAccount(page: Page) {
  // All API requests are intercepted: no account writes or paid provider requests.
  await page.route('**/api/v1/**', route => route.fulfill({ status: 404, json: { error: { message: 'Unexpected test request.' } } }));
  await page.route(/\/api\/v1\/auth\/(restore|refresh)$/, route => route.fulfill({ json: { user, accessToken: 'mock-foundation-session', expiresAt: '2030-01-01T00:00:00Z' } }));
  await page.route('**/api/v1/notifications?*', route => route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, limit: 20 } }));
  await page.route('**/api/v1/resumes', route => route.fulfill({ json: { resumes: [resume] } }));
  await page.route('**/api/v1/intelligence/capabilities', route => route.fulfill({ json: models }));
  await page.route('**/api/v1/intelligence/resumes/*/drafts', route => route.fulfill({ json: { versions: [{ id: cv.id, version: cv.version, model: cv.model, reasoning: cv.reasoning, createdAt: cv.createdAt }], nextBeforeVersion: null } }));
}

test('draft labels include the filename and cancelled backdrop/Escape dismissal preserves selected edits', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/v1/profiles/me', route => route.fulfill({ json: { profile: {
    fullName: 'Foundation Tester', headline: 'Engineer', summary: '', location: '', phone: '', skills: [], experience: [], education: [], certifications: [], links: [], version: 0,
  } } }));
  await page.route('**/api/v1/intelligence/resumes/*/draft', route => route.fulfill({ json: cv }));
  await page.goto('/resumes');
  await expect(page.getByRole('heading', { name: 'Resumes', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: 'Resumes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Resume draft — Foundation CV.pdf' });
  await expect(dialog.getByLabel('Saved draft version')).toContainText('Foundation CV.pdf · Analysis v1');
  await dialog.getByLabel('Apply Headline', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Expand all fields' }).click();
  await dialog.getByLabel('Headline', { exact: true }).fill('My reviewed headline');
  page.once('dialog', prompt => prompt.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog.getByLabel('Headline', { exact: true })).toHaveValue('My reviewed headline');
  const box = (await dialog.boundingBox())!;
  page.once('dialog', prompt => prompt.dismiss());
  await page.mouse.click(1, box.y + 30);
  await expect(dialog.getByLabel('Headline', { exact: true })).toHaveValue('My reviewed headline');
  page.once('dialog', prompt => prompt.accept());
  await page.mouse.click(1, box.y + 30);
  await expect(dialog).toHaveCount(0);
});

test('Cady preserves older-message reading during a reply and follows new turns at the ten-pair limit', async ({ page }) => {
  await mockAccount(page);
  let revision = 9, calls = 0;
  const makeTurn = (index: number) => ({ question: `Question ${index}`, result: { ...answer, conversationRevision: index,
    answer: { ...answer.answer, paragraphs: [{ text: `Reply ${index}. ` + 'Review the saved career evidence carefully. '.repeat(30), references: [] }] },
  } });
  let turns = Array.from({ length: 9 }, (_, index) => makeTurn(index + 1));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/saved-jobs?*', route => route.fulfill({ json: { savedJobs: [], total: 0 } }));
  await page.route('**/api/v1/intelligence/cady/conversation', route => route.fulfill({ json: { conversation: {
    revision, context: { resume: cv.source, draftId: cv.id, jobs: [], profile: null, model: 'gpt-6-luna', reasoning: 'medium' }, turns, updatedAt: cv.createdAt,
  }, outdated: false, unavailable: false } }));
  await page.route('**/api/v1/intelligence/cady/ask', async route => {
    calls++;
    if (calls === 1) await pending;
    revision++;
    const turn = makeTurn(revision);
    turn.question = route.request().postDataJSON().question;
    turns = [...turns, turn].slice(-10);
    await route.fulfill({ json: turn.result });
  });
  await page.goto('/cady');
  const messages = page.locator('.cady-chat-panel .cady-messages');
  await expect(messages.locator('.cady-turn')).toHaveCount(9);
  await page.getByLabel('Your question', { exact: true }).fill('Question 10');
  await page.getByRole('button', { name: 'Ask Cady', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cady is thinking…' })).toBeVisible();
  await messages.evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  release();
  await expect(messages.locator('.cady-turn')).toHaveCount(10);
  expect(await messages.evaluate(element => element.scrollTop)).toBeLessThan(50);
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect.poll(() => messages.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(48);
  await page.getByLabel('Your question', { exact: true }).fill('Question 11');
  await page.getByRole('button', { name: 'Ask Cady', exact: true }).click();
  await expect(messages.getByText('Question 11', { exact: true })).toBeVisible();
  await expect(messages.locator('.cady-turn')).toHaveCount(10);
  await expect.poll(() => messages.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(48);
  expect(calls).toBe(2);
});
