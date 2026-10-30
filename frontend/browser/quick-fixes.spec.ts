import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, importPackage, loginExisting, mentionWithOffsets, moreAction, openCase, selectText, submitCase } from './helpers';
import { problemReportScenario } from './problemReportHelpers';

// Quick-fix acceptance (Q1 (B1), Q1 (B2), Q3, Q4, Q7). Q1 (B1) targets the rewritten Work rounds and
// original evidence dialogs of editor F8a (written by editor F10; editor-layout.spec.ts adds the
// viewport checks). Q8 is obsolete: the round-input list it targeted was deleted with
// RoundInputPanel (editor F6b) and its rule removed by editor F4b.
// Q1 (B2) targets the problem dialog of problem-reports WP6 (written by problem-reports WP9e).

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
  await page.getByLabel("Search term", { exact: true }).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  await expect(page.locator('.sidebar .doc-item')).toHaveCount(1);
  const noteField = page.getByRole('textbox', { name: 'Note', exact: true });
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
  await importPackage(page, '', 'browser-fixture-quick-fixes', 'quick-fix-q7');
  await openCase(page, { task: 'annotate' });
  await selectText(page, 0, 9);
  await page.getByLabel("Search term", { exact: true }).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  await expect(mentionWithOffsets(page, '[0:9]')).toBeVisible();
  const handle = page.locator('.text-container .resize-handle--end');
  await expect(handle).toHaveCount(1);
  // The term label arrives after the save and re-renders every handle (its title names the term): wait for it.
  await expect(handle).toHaveAttribute('title', /the Hypotonia mention/);
  const text = page.locator('.text-container');
  const rects = () => text.evaluate(el => [...el.querySelectorAll('.run, mark, .mention')].map(m => {
    const r = m.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
  }));
  const before = await rects();
  expect(before.length).toBeGreaterThan(0);
  await page.keyboard.press('Shift'); // keyboard modality, so programmatic focus matches :focus-visible
  // Focus and read in one step: a handle replaced between two reads has an empty computed style.
  const focused = await handle.evaluate(el => {
    el.focus();
    return { visible: el.matches(':focus-visible'), ring: getComputedStyle(el, '::before').boxShadow };
  });
  expect(focused.visible).toBe(true);
  expect(focused.ring).toContain('rgb(29, 78, 137)'); // --focus-ring #1d4e89
  expect(await rects()).toEqual(before);
  const shot = test.info().outputPath('q7-handle-focus.png');
  await page.screenshot({ path: shot });
  await test.info().attach('q7-handle-focus', { path: shot, contentType: 'image/png' });
});

test('Q1 (B1): Work rounds and original evidence dialogs keep Close in a fixed footer', async ({ page }) => {
  const response = await page.request.post('/__test_carry_forward__', { params: { scenario: 't5' }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = await response.json() as { assignment_id: number; username: string };
  await loginExisting(page, s.username);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.locator('.text-container')).toBeVisible();
  /** Close is the last footer action, outside the scrolling body, below it and inside the viewport. */
  const footerClose = async (dialog: ReturnType<Page['getByRole']>, name: string, trigger: ReturnType<Page['getByRole']>) => {
    await expect(dialog).toBeVisible();
    const footer = dialog.locator('.modal-actions');
    await expect(footer.getByRole('button').last()).toHaveText(name);
    const close = footer.getByRole('button', { name, exact: true });
    await expect(close).toBeInViewport({ ratio: 1 });
    const order = await dialog.evaluate(element => {
      const body = element.querySelector('.ui-dialog-body')!;
      const actions = element.querySelector('.modal-actions')!.getBoundingClientRect();
      return { bodyBottom: body.getBoundingClientRect().bottom, footerTop: actions.top, inBody: !!element.querySelector('.ui-dialog-body .modal-actions'), overflow: getComputedStyle(body).overflowY };
    });
    expect(order.inBody).toBe(false);
    expect(order.footerTop).toBeGreaterThanOrEqual(order.bodyBottom - 1);
    expect(['auto', 'scroll']).toContain(order.overflow);
    // The header close is a second way out; Close in the footer returns focus to the trigger.
    await expect(dialog.locator('.ui-dialog-header').getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  };
  for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    // Work rounds sits in the editor's "More" menu; focus returns to the "More actions" button.
    const roundsButton = page.getByRole('button', { name: 'More actions', exact: true });
    await moreAction(page, 'Work rounds');
    const rounds = page.getByRole('dialog', { name: /^Work rounds\W/ });
    await expect(rounds.getByRole('table', { name: 'Rounds' }).or(rounds.getByRole('list', { name: 'Rounds' }))).toBeVisible();
    await footerClose(rounds, 'Close', roundsButton);
    // Select the carried finding (from the list pane on narrow screens); Details shows its section.
    const tabs = page.getByRole('navigation', { name: 'Select view' });
    if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Findings/ }).click();
    const seizure = page.locator('.sidebar [data-list-key^="annotation:"]').filter({ hasText: 'Seizure' });
    if ((await seizure.getAttribute('aria-pressed')) !== 'true') await seizure.click();
    else if (await tabs.isVisible()) await tabs.getByRole('button', { name: 'Details', exact: true }).click();
    const show = page.getByRole('region', { name: 'Carried finding', exact: true }).getByRole('button', { name: 'Show original evidence', exact: true });
    await show.click();
    await footerClose(page.getByRole('dialog', { name: 'Original finding from Round 1', exact: true }), 'Close original evidence', show);
  }
});

test('Q1 (B2): the problem dialog keeps New report and Close in a fixed footer', async ({ page }) => {
  const s = await problemReportScenario(page, 'base');
  const task = s.tasks.reporter;
  await loginExisting(page, s.users.reporter);
  await page.goto(`/#/tasks/${task}`);
  await expect(page.locator('.text-container')).toBeVisible();
  // The entry is a "More" menu item; focus returns to the "More actions" button.
  const entry = page.getByRole('button', { name: 'More actions', exact: true });
  const openEntry = () => moreAction(page, /^Report a text problem…/);
  // No report yet: the entry opens the new report form directly.
  await openEntry();
  const form = page.getByRole('dialog', { name: 'New problem report', exact: true });
  await form.getByRole('textbox', { name: /What is the problem\?/ }).fill('The German text misses a sentence.');
  await form.locator('.modal-actions').getByRole('button', { name: 'Report and pause my task', exact: true }).click();
  const reports = page.getByRole('dialog', { name: `Problems with Task ${task}`, exact: true });
  await expect(reports).toBeVisible();
  await reports.locator('.modal-actions').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(reports).toBeHidden();
  for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await openEntry();
    await expect(reports).toBeVisible();
    const footer = reports.locator('.modal-actions');
    await expect(footer.getByRole('button')).toHaveText(['New report', 'Close']);
    const close = footer.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeEnabled();
    // The footer sits below the scrolling body and stays inside the viewport.
    await expect(close).toBeInViewport({ ratio: 1 });
    const box = (await close.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    const order = await reports.evaluate(dialog => {
      const body = dialog.querySelector('.ui-dialog-body')!.getBoundingClientRect();
      const actions = dialog.querySelector('.modal-actions')!.getBoundingClientRect();
      return { bodyBottom: body.bottom, footerTop: actions.top, inBody: !!dialog.querySelector('.ui-dialog-body .modal-actions') };
    });
    expect(order.inBody).toBe(false);
    expect(order.footerTop).toBeGreaterThanOrEqual(order.bodyBottom - 1);
    await close.click();
    await expect(reports).toBeHidden();
    await expect(entry).toBeFocused();
  }
});

test('Q3: project switcher closes on select, Escape, outside click and Tab-out; arrows and ctrl-click do not navigate', async ({ page, context }) => {
  const s = await scenario(page);
  await loginExisting(page, s.users.lead);
  const trigger = page.getByRole('navigation', { name: 'Sections' }).locator('.project-switcher');
  const dialog = page.getByRole('dialog', { name: 'Switch project' });
  const field = dialog.getByRole('combobox', { name: 'Find project' });
  const option = dialog.getByRole('option').filter({ hasText: s.project }).getByRole('link');
  // Escape returns focus to the button.
  await trigger.click(); await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  // Outside pointer.
  await trigger.click(); await expect(dialog).toBeVisible();
  await page.mouse.click(page.viewportSize()!.width - 5, page.viewportSize()!.height - 5); await expect(dialog).toBeHidden();
  // Tab-out at either end closes it: Tab from "All projects", Shift+Tab from the field.
  await trigger.click(); await expect(dialog).toBeVisible();
  await dialog.getByRole('link', { name: 'All projects' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click(); await expect(field).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog).toBeHidden();
  // Arrow keys move the active option and never navigate: the URL is captured before the keypresses.
  await trigger.click(); await expect(field).toBeFocused();
  const url = page.url();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await expect(dialog).toBeVisible();
  await expect(field).toHaveAttribute('aria-activedescendant', /.+/);
  expect(page.url()).toBe(url);
  // Ctrl-click opens a new tab and leaves this page and the popover as they were.
  const popup = context.waitForEvent('page');
  await option.click({ modifiers: ['Control'] });
  await (await popup).close();
  expect(page.url()).toBe(url);
  await expect(dialog).toBeVisible();
  // Plain click navigates and closes.
  await option.click();
  await expect(page).not.toHaveURL(url);
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // A route change closes it; the popover never stays over the page.
  await trigger.click(); await expect(dialog).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/me'; });
  await expect(page).toHaveURL(/#\/me/);
  await expect(dialog).toBeHidden();
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
  const section = page.getByRole('region', { name: 'Final results' });
  // D8: the preflight runs on opening Export; "Create final export" is the one primary, "Check again" reruns it.
  await expect(section.getByRole('region', { name: 'Export check' })).toBeVisible();
  await expect(section.locator('.btn-primary')).toHaveCount(1);
  await expect(section.locator('.btn-primary')).toHaveText('Create final export');
  await expect(section.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  // Required: the scenario guarantees a text without a final result; leaving it out needs the counted tick (#194).
  const leftOut = section.getByRole('rowgroup', { name: 'Left out: no final result' });
  await expect(leftOut.getByRole('link', { name: /^Open in Documents, / }).first()).toBeVisible();
  await expect(section.getByRole('checkbox', { name: /leave out the other / })).toBeVisible();
  await section.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(section.getByRole('region', { name: 'Export check' })).toBeVisible();
  await expect(section.locator('.btn-primary')).toHaveCount(1);
});

test('F7: status tabs switch and survive a reload', async ({ page, browser }) => {
  const response = await page.request.post('/__test_translation_review__?workflow=true&assignment=target', { timeout: 60_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = await response.json() as Scenario;
  // The reviewer has the open translation review and an annotate task, submitted through the API.
  const lead = await actor(browser, s.users.lead);
  let annotate: Assignment;
  try { annotate = await assign(lead.page, s, s.users.reviewer); }
  finally { await lead.close(); }
  await loginExisting(page, s.users.reviewer);
  const workspace = await value<components['schemas']['AssignmentOpenResponse']>(page, `/api/v1/assignments/${annotate.id}/open`, 'POST');
  const path = `/api/v1/workspaces/${encodeURIComponent(workspace.workspace_id)}`;
  const draft = await value<components['schemas']['Draft']>(page, `${path}/commands`, 'POST', {
    mutation_id: randomUUID(), expected_revision: workspace.view.draft.revision,
    payload: { command: 'create_annotation', annotation_id: randomUUID(), evidence_id: randomUUID(),
      layer_id: 'hpo', type_id: 'phenotype', term_id: 'HP:0001252', segments: [{ start: 0, end: 9 }],
      axes_values: { assertion: 'present', experiencer: 'patient', temporality: 'current' } },
  });
  await value(page, `${path}/submit`, 'POST', {
    mutation_id: randomUUID(), expected_revision: draft.revision,
    payload: { command: 'submit_workspace', document_checked: true, checked_layer_ids: ['hpo'] },
  });

  // Reload to read the submission (at "#/?status=all", so the last-used landing does not apply), then a
  // hash-only goto to "#/" keeps the reloaded task list and shows the default tab.
  await page.reload();
  // The app decides the last-used landing from the hash of its first render, which may come after "load":
  // change the hash only once it has rendered, or "#/" is taken for a fresh start and redirects to Projects.
  await expect(page.getByTestId('current-user')).toBeVisible();
  await page.goto('/#/');
  const tabs = page.getByRole('tablist', { name: 'Task status' });
  const rows = page.getByTestId('task-row');
  // D3: no status in the URL opens on All.
  await expect(tabs.getByRole('tab', { name: 'All, 2' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveCount(2);
  await tabs.getByRole('tab', { name: 'Submitted, 1' }).click();
  await expect(page).toHaveURL(/#\/\?status=submitted$/);
  await expect(tabs.getByRole('tab', { name: 'Submitted, 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Submitted');
  await page.reload();
  await expect(page).toHaveURL(/#\/\?status=submitted$/);
  await expect(tabs.getByRole('tab', { name: 'Submitted, 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'my-tasks-panel-tab-submitted');
  // Keyboard: arrows move focus, Enter selects.
  await tabs.getByRole('tab', { name: 'Submitted, 1' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.getByRole('tab', { name: 'To do, 1' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/\?status=todo$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Translation review');
});
