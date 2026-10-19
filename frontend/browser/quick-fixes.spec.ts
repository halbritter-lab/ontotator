import { expect, test, type Browser, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, importPackage, loginExisting, mentionWithOffsets, openCase, selectText, submitCase } from './helpers';

// Quick-fix acceptance (Q3, Q4, Q7). Not written here, as their UI was replaced:
// Q1 (B1) by editor F8a (covered by editor F10), Q1 (B2) by problem-reports WP6 (CR-3, covered by
// problem-reports WP9), Q8 by editor F6b (RoundInputPanel deleted).

type Assignment = components['schemas']['AssignmentView'];
type Scenario = { project: string; case_id: string; assignment_id: number; documents: { source: string; target: string }; users: { lead: string; reviewer: string; other: string; consolidator: string } };
test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });
const root = (s: Scenario) => `/api/v1/projects/${encodeURIComponent(s.project)}`;
async function actor(browser: Browser, username: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage(); await loginExisting(page, username);
  return { page, close: () => context.close() };
}
async function value<T>(page: Page, path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await authenticatedRequest(page, path, method, data);
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as T;
}
async function assign(page: Page, s: Scenario, username: string) {
  const response = await value<{ created: Assignment[]; refused: unknown[] }>(page, `${root(s)}/assignments`, 'POST', {
    task: 'annotate', rows: [{ document_id: s.documents.source, username }], confirm_language: false,
  });
  expect(response.refused).toEqual([]); return response.created[0];
}
async function finding(page: Page, assignment: Assignment, note: string) {
  await page.goto(`/#/tasks/${assignment.id}`);
  await expect(page.locator('.text-container')).toBeVisible();
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/i).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  await expect(page.locator('.sidebar .doc-item')).toHaveCount(1);
  const noteField = page.getByRole('textbox', { name: 'Annotation note' });
  if (await noteField.count()) {
    await noteField.fill(note);
    await noteField.blur();
  }
  await submitCase(page);
}
async function scenario(page: Page): Promise<Scenario> {
  const response = await page.request.post('/__test_translation_review__?workflow=true', { timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as Scenario;
}

test('Q7: focused resize handle shows a focus-ring ring without moving text', async ({ page }) => {
  await importPackage(page, '', 'browser-fixture', 'quick-fix-q7');
  await openCase(page, { task: 'annotate' });
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/i).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  await expect(mentionWithOffsets(page, '[0:9]')).toBeVisible();
  const handle = page.locator('.text-container .resize-handle--end');
  await expect(handle).toHaveCount(1);
  const text = page.locator('.text-container');
  const rects = () => text.evaluate(el => [...el.querySelectorAll('.run, mark, .mention')].map(m => {
    const r = m.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
  }));
  const before = await rects();
  expect(before.length).toBeGreaterThan(0);
  await page.keyboard.press('Shift'); // keyboard modality, so programmatic focus matches :focus-visible
  await handle.focus();
  expect(await handle.evaluate(el => el.matches(':focus-visible'))).toBe(true);
  const ring = await handle.evaluate(el => getComputedStyle(el, '::before').boxShadow);
  expect(ring).toContain('rgb(29, 78, 137)'); // --focus-ring #1d4e89
  expect(await rects()).toEqual(before);
  const shot = test.info().outputPath('q7-handle-focus.png');
  await page.screenshot({ path: shot });
  await test.info().attach('q7-handle-focus', { path: shot, contentType: 'image/png' });
});

test('Q3: project picker closes on select, Escape, outside click and Tab-out; arrows and ctrl-click do not navigate', async ({ page, context }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.lead);
  await page.goto('/#/tasks');
  const trigger = page.locator('.shell-project-trigger');
  const panel = page.locator('#shell-project-panel');
  const links = panel.getByRole('link');
  // Escape returns focus to the trigger.
  await trigger.click(); await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab'); await expect(links.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden(); await expect(trigger).toBeFocused();
  // Outside pointer.
  await trigger.click(); await expect(panel).toBeVisible();
  await page.mouse.click(5, page.viewportSize()!.height - 5); await expect(panel).toBeHidden();
  // Tab-out: Tab from the last link leaves the picker and closes it.
  await trigger.click(); await expect(panel).toBeVisible();
  await links.last().focus();
  await page.keyboard.press('Tab');
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('.shell-project-selector').evaluate(el => el.contains(document.activeElement))).toBe(false);
  // Arrow keys never navigate: the URL is captured before the keypresses.
  await trigger.click(); await expect(panel).toBeVisible();
  const link = links.first();
  const url = page.url();
  await link.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await expect(panel).toBeVisible();
  expect(page.url()).toBe(url);
  // Ctrl-click opens a new tab and leaves this page and the panel as they were.
  const popup = context.waitForEvent('page');
  await link.click({ modifiers: ['Control'] });
  await (await popup).close();
  expect(page.url()).toBe(url);
  await expect(panel).toBeVisible();
  // Plain click navigates and closes.
  await link.click();
  await expect(page).not.toHaveURL(url);
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // Route change closes; the panel never stays over the page.
  await trigger.click(); await expect(panel).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL(/#\/me/);
  await expect(panel).toBeHidden();
});

test('Q4: export preflight has one primary, Cancel, and tight warning items', async ({ page, browser }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.lead);
  const task = await assign(page, s, s.users.reviewer);
  const author = await actor(browser, s.users.reviewer);
  try { await finding(author.page, task, 'Submitted without a final selection'); }
  finally { await author.close(); }
  // The submitted result has no final selection yet, so the preflight must warn.
  await page.goto(`/#/projects/${encodeURIComponent(s.project)}/export`);
  const section = page.getByRole('region', { name: 'Selected final results' });
  await expect(section.getByRole('button', { name: 'Prepare final export' })).toBeVisible();
  await expect(section.locator('.btn-primary')).toHaveCount(1);
  await page.getByRole('button', { name: 'Prepare final export' }).click();
  await expect(page.getByRole('heading', { name: 'Export preflight' })).toBeFocused();
  await expect(section.locator('.btn-primary')).toHaveCount(1);
  // Required: the scenario guarantees at least one warning; an empty list is a failure.
  const item = section.locator('.final-warning-list > li').first();
  await expect(item).toBeVisible();
  const gaps = await item.evaluate(li => {
    const p = li.querySelector('p')!.getBoundingClientRect(); const a = li.querySelector('a')!.getBoundingClientRect();
    const box = li.getBoundingClientRect(); const top = parseFloat(getComputedStyle(li).paddingTop);
    return { own: a.top - p.bottom, next: box.bottom - a.bottom + top };
  });
  expect(gaps.own).toBeLessThan(gaps.next);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Prepare final export' })).toBeFocused();
});
