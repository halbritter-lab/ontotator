import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, loginExisting, mentionWithOffsets } from './helpers';

test.setTimeout(90_000);
async function recordGeometry(page: Page, label: string) {
  const data = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    surfaces: [...document.querySelectorAll('.text-container, .compare-controls, .pane-toolbar, .sidebar, .inspector-pane, .tree-host')].map(element => ({
      className: element.className, rect: element.getBoundingClientRect().toJSON(),
      scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
    })),
    selection: window.getSelection()?.toString(),
  }));
  await test.info().attach(label, { body: Buffer.from(JSON.stringify(data)), contentType: 'application/json' });
}
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    await recordGeometry(page, 'failure-geometry-selection');
    await info.attach('failure-viewport', { body: await page.screenshot(), contentType: 'image/png' });
  }
});
type Ref = components['schemas']['VersionRef'];
type Workspace = components['schemas']['AssignmentOpenResponse'];
type Scenario = {
  project: string; case_id: string; import_job_id: number;
  children: { id: number; status: string; result: { sets: number; carried: number; needs_review: number } }[];
  documents: Record<'source' | 'target' | 'other' | 'corrected', string>;
  texts: Record<'source' | 'target', string>;
  users: Record<'alice' | 'bob' | 'reader' | 'lead', string>;
  assignments: Record<'alice' | 'alice_source' | 'bob' | 'reader', number>;
};
const refToken = (ref: Ref) => JSON.stringify([ref.kind, ref.id]);
const path = (s: Scenario, doc: string, suffix: string) =>
  `/api/v1/projects/${encodeURIComponent(s.project)}/documents/${encodeURIComponent(doc)}/${suffix}`;
const caseUrl = (s: Scenario, doc = s.documents.target) =>
  `/#/projects/${encodeURIComponent(s.project)}/cases/${encodeURIComponent(s.case_id)}?${new URLSearchParams({ variant: doc, annotations: 'text' })}`;
const comparison = (page: Page) => page.getByRole('region', { name: 'Comparison', exact: true });
const comparisonControls = (page: Page) => page.getByRole('toolbar', { name: 'Comparison controls', exact: true });
const comparisonStatus = (page: Page) => page.locator('.comparison-global-controls');
const rightText = (page: Page) => comparison(page).locator('.text-container');
const viewerLeft = (page: Page) => page.locator('.comparison-reading > .readonly-annotation-view .text-container');
const editorLeft = (page: Page) => page.locator('.app-layout > .center-pane .text-container');
/** Top of the first rendered character of the text, relative to the text sheet (page scrolling does not count). */
const firstLineOffset = (surface: Locator) => surface.evaluate(el => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: node => node.textContent!.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
  const node = walker.nextNode()!; const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 1);
  return range.getBoundingClientRect().top - el.getBoundingClientRect().top;
});

async function openVersions(page: Page) {
  const disclosure = page.locator('details.case-version-controls, details.comparison-identity-choices');
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).toBeVisible();
  if (!await disclosure.evaluate(node => (node as HTMLDetailsElement).open)) {
    await disclosure.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
  }
}
async function scenario(page: Page): Promise<Scenario> {
  const response = await page.request.post('/__test_variants__', { params: { comparison: 'true' }, timeout: 90_000 });
  expect(response.ok()).toBeTruthy();
  const value = await response.json() as Scenario;
  for (const child of value.children) expect(child.status).toBe('succeeded');
  await test.info().attach('comparison-fixture-children', { body: Buffer.from(JSON.stringify({ project: value.project, import_job_id: value.import_job_id, children: value.children })), contentType: 'application/json' });
  return value;
}
async function openViewer(page: Page, s: Scenario, doc = s.documents.target) {
  await page.goto(caseUrl(s, doc));
  const viewer = page.getByRole('region', { name: 'Case viewer' });
  await expect(viewer).toBeVisible();
  await openVersions(page);
  await expect(viewer.locator('.variant-selectors').getByLabel('Text version', { exact: true })).toHaveValue(doc);
  await expect(viewerLeft(page)).toBeVisible();
}
async function readyEditor(page: Page, s: Scenario) {
  await openVersions(page);
  await expect(page.locator('.case-version-controls')).toBeVisible();
  await expect(page.locator('.case-version-controls').getByLabel('Text version', { exact: true })).toHaveValue(s.documents.target);
  await expect(page.locator('.status-badge')).toContainText('Saved');
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
async function openComparison(page: Page, s: Scenario) {
  await openVersions(page); await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(comparison(page).getByLabel('Text version', { exact: true })).toHaveValue(s.documents.source);
  await expect(rightText(page)).toHaveText(s.texts.source);
  await page.evaluate(() => document.fonts.ready);
}
async function markerOffset(surface: Locator, index: number) {
  return surface.evaluate((element, number) => {
    const marker = element.querySelector<HTMLElement>(`[data-paragraph="${number}"]`);
    if (!marker) throw new Error(`Missing real paragraph ${number}`);
    return marker.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientTop;
  }, index);
}
async function scrollParagraph(surface: Locator, index: number) {
  await surface.dispatchEvent('wheel');
  const range = await surface.evaluate(async (element, number) => {
    const marker = element.querySelector<HTMLElement>(`[data-paragraph="${number}"]`);
    if (!marker) throw new Error(`Missing real paragraph ${number}`);
    // One pixel beyond the boundary avoids fractional scrollTop rounding selecting
    // the preceding paragraph; geometry assertions below still measure live positions.
    const wanted = element.scrollTop + marker.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientTop + 1;
    const maximum = element.scrollHeight - element.clientHeight;
    element.scrollTop = wanted;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { wanted, maximum };
  }, index);
  expect(range.maximum).toBeGreaterThanOrEqual(range.wanted);
}
async function align(surface: Locator, index: number) {
  await expect.poll(async () => Math.abs(await markerOffset(surface, index))).toBeLessThanOrEqual(20);
}
async function characterPoint(surface: Locator, offset: number, edge: 'start' | 'end' = 'start') {
  return surface.evaluate((element, { target, edge }) => {
    for (const run of element.querySelectorAll<HTMLElement>('.run')) {
      const start = Number(run.dataset.start), node = run.firstChild;
      if (node && start <= target && target < start + (node.textContent?.length ?? 0)) {
        const range = document.createRange(); range.setStart(node, target - start); range.setEnd(node, target - start + 1);
        const rect = range.getBoundingClientRect(); return { x: edge === 'end' ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 };
      }
    }
    throw new Error(`No real character at UTF16 offset ${target}`);
  }, { target: offset, edge });
}
async function dragEndTo(page: Page, surface: Locator, offset: number) {
  const point = await characterPoint(surface, offset);
  const edge = (await surface.locator('.resize-handle--end').boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down(); await page.mouse.move(point.x, point.y, { steps: 8 }); await page.mouse.up();
}
async function afterEchoWindow(page: Page) {
  // Wait beyond the former echo timer to exercise persistent ownership.
  await page.waitForTimeout(175);
}
async function exactText(surface: Locator, text: string) {
  await expect.poll(() => surface.textContent()).toBe(text);
  const markers = await surface.locator('[data-paragraph]').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, hidden: node.getAttribute('aria-hidden') })));
  expect(markers.every(marker => marker.text === '' && marker.hidden === 'true')).toBe(true);
}
async function refs(page: Page, s: Scenario, doc: string): Promise<Ref[]> {
  const response = await authenticatedRequest(page, path(s, doc, 'annotation-versions'));
  expect(response.ok()).toBeTruthy(); return await response.json() as Ref[];
}
async function annotation(page: Page, s: Scenario, submit = false) {
  const response = await authenticatedRequest(page, `/api/v1/assignments/${s.assignments.alice}/open`, 'POST');
  expect(response.ok()).toBeTruthy(); const opened = await response.json() as Workspace;
  const endpoint = `/api/v1/workspaces/${encodeURIComponent(opened.workspace_id)}`;
  const created = await authenticatedRequest(page, `${endpoint}/commands`, 'POST', {
    mutation_id: randomUUID(), expected_revision: opened.view.draft.revision,
    payload: { command: 'create_annotation', annotation_id: randomUUID(), evidence_id: randomUUID(), layer_id: 'hpo', type_id: 'phenotype', term_id: 'HP:0001252',
      segments: [{ start: 0, end: 9 }], axes_values: { assertion: 'present', experiencer: 'patient', temporality: 'current' } },
  });
  expect(created.ok()).toBeTruthy(); const draft = await created.json() as components['schemas']['Draft'];
  if (submit) {
    const result = await authenticatedRequest(page, `${endpoint}/submit`, 'POST', { mutation_id: randomUUID(), expected_revision: draft.revision,
      payload: { command: 'submit_workspace', document_checked: true, checked_layer_ids: ['hpo'] } });
    expect(result.ok()).toBeTruthy();
  }
  return { opened, draft };
}
async function manage(browser: Browser, s: Scenario, assignment: number, operation: 'revoke' | 'reopen') {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage(); await loginExisting(page, s.users.lead);
    const response = await authenticatedRequest(page, `/api/v1/assignments/${assignment}/${operation}`, 'POST', { reason: 'Comparison authority test' });
    expect(response.ok()).toBeTruthy();
  } finally { await context.close(); }
}

test('real wrapping pairs equal-count paragraphs in both directions without changing immutable text or markers', async ({ page }) => {
  const s = await scenario(page); await loginExisting(page, s.users.lead);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openViewer(page, s); await openComparison(page, s);
  const left = viewerLeft(page), right = rightText(page);
  await exactText(left, s.texts.target); await exactText(right, s.texts.source);
  await expect(left.locator('[data-paragraph]')).toHaveCount(13); await expect(right.locator('[data-paragraph]')).toHaveCount(13);
  const leftHeight = await markerOffset(left, 2) - await markerOffset(left, 1);
  const rightHeight = await markerOffset(right, 2) - await markerOffset(right, 1);
  expect(Math.abs(leftHeight - rightHeight)).toBeGreaterThan(20);
  await expect(comparisonControls(page).getByLabel('Couple scrolling')).not.toBeChecked();
  await comparisonControls(page).getByLabel('Couple scrolling').check();
  await expect(comparisonStatus(page).getByText('Paragraphs are paired by position, not by meaning', {exact:true})).toBeVisible();
  await scrollParagraph(left, 3); await align(right, 3);
  await afterEchoWindow(page);
  await scrollParagraph(right, 6); await align(left, 6);
  const stable = await left.evaluate(element => element.scrollTop);
  await afterEchoWindow(page);
  expect(Math.abs(await left.evaluate(element => element.scrollTop) - stable)).toBeLessThanOrEqual(2);
  await exactText(left, s.texts.target); await exactText(right, s.texts.source);
  // A correction compares with the original English source, not its German predecessor.
  await comparisonControls(page).getByRole('button', { name: 'Close comparison', exact: true }).click();
  await openViewer(page, s, s.documents.corrected); await openComparison(page, s);
});

test('unequal counts map proportionally, toggle off and below1100 suspend coupling, resize back resumes it', async ({ page }) => {
  const s = await scenario(page); await loginExisting(page, s.users.lead);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openViewer(page, s); await openComparison(page, s);
  const pane = comparison(page), left = viewerLeft(page), right = rightText(page);
  await pane.getByLabel('Language', { exact: true }).selectOption('de');
  await pane.getByLabel('Text version', { exact: true }).selectOption(s.documents.other);
  await expect(right.locator('[data-paragraph]')).toHaveCount(9);
  await expect(comparisonStatus(page).getByText('Paragraphs differ (13 / 9); scrolling is approximate.', { exact: true })).toBeVisible();
  await comparisonControls(page).getByLabel('Couple scrolling').check();
  await scrollParagraph(left, 6); await align(right, 4);
  await afterEchoWindow(page); await scrollParagraph(right, 3); await align(left, 5);
  await comparisonControls(page).getByLabel('Couple scrolling', { exact: true }).uncheck();
  const before = await right.evaluate(element => element.scrollTop);
  await scrollParagraph(left, 2);
  expect(Math.abs(await right.evaluate(element => element.scrollTop) - before)).toBeLessThanOrEqual(1);
  await comparisonControls(page).getByLabel('Couple scrolling', { exact: true }).check();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(comparisonControls(page).getByLabel('Couple scrolling', { exact: true })).toBeDisabled();
  await expect(comparisonControls(page).getByLabel('Couple scrolling', { exact: true })).not.toBeChecked();
  await expect(comparisonStatus(page).getByText(/Widen the window/)).toBeVisible();
  const uncoupled = await right.evaluate(element => element.scrollTop);
  await scrollParagraph(left, 4);
  expect(Math.abs(await right.evaluate(element => element.scrollTop) - uncoupled)).toBeLessThanOrEqual(1);
  await recordGeometry(page, 'below1100-stack');
  const boxes = await Promise.all([left.boundingBox(), right.boundingBox()]);
  expect(boxes[0]!.x).toBeCloseTo(boxes[1]!.x, 0); expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(comparisonControls(page).getByLabel('Couple scrolling', { exact: true })).toBeEnabled();
  await expect(comparisonControls(page).getByLabel('Couple scrolling', { exact: true })).toBeChecked();
  await scrollParagraph(left, 6); await align(right, 4);
});

test('open editor has two equal reading surfaces and reachable lower controls; close restores original floors and focus', async ({ page }) => {
  const s = await scenario(page); await loginExisting(page, s.users.alice); await annotation(page, s);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/#/tasks/${s.assignments.alice}`);
  await page.locator('.sidebar [data-list-key^="annotation:"]').first().click();
  await page.getByRole('button', { name: 'Show in tree', exact: true }).click();
  await expect(page.getByRole('tree', { name: 'Terms' })).toBeVisible();
  const original = await editorLeft(page).elementHandle();
  await openVersions(page); await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(rightText(page)).toHaveText(s.texts.source); await page.evaluate(() => document.fonts.ready);
  await recordGeometry(page, 'wide-reading-pair');
  const left = await editorLeft(page).boundingBox(), right = await rightText(page).boundingBox();
  expect(left).not.toBeNull(); expect(right).not.toBeNull();
  expect(Math.abs(left!.width - right!.width)).toBeLessThanOrEqual(2);
  expect(left!.width).toBeGreaterThanOrEqual(500); expect(right!.width).toBeGreaterThanOrEqual(500);
  expect(left!.height).toBeGreaterThanOrEqual(500); expect(right!.height).toBeGreaterThanOrEqual(500);
  expect(Math.abs(left!.y - right!.y)).toBeLessThanOrEqual(50);
  // Exercise the existing attach banner in both layouts without replacing the text owner.
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    const before = (await editorLeft(page).boundingBox())!;
    const lineBefore = await firstLineOffset(editorLeft(page));
    await page.getByRole('button', { name: 'Add mention', exact: true }).click();
    const banner = page.locator('.app-layout > .center-pane > .attach-mention-banner');
    await expect(banner).toBeVisible();
    const during = (await editorLeft(page).boundingBox())!;
    // The marking line overlays the top of the text sheet: the text does not move ...
    expect(Math.abs(during.width - before.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.height - before.height)).toBeLessThanOrEqual(1);
    expect(Math.abs((await firstLineOffset(editorLeft(page))) - lineBefore)).toBeLessThanOrEqual(1);
    // ... the line stays inside the text pane, and the first line of text stays clear of it (one layout read, no scroll in between).
    const overlay = await editorLeft(page).evaluate((el, line) => {
      const sheet = el.getBoundingClientRect(), pane = el.closest('.center-pane')!.getBoundingClientRect();
      const notice = document.querySelector('.app-layout > .center-pane > .attach-mention-banner')!.getBoundingClientRect();
      return { left: notice.left - pane.left, right: pane.right - notice.right, clear: sheet.top + line - notice.bottom };
    }, lineBefore);
    expect(overlay.left).toBeGreaterThanOrEqual(-1);
    expect(overlay.right).toBeGreaterThanOrEqual(-1);
    expect(overlay.clear).toBeGreaterThanOrEqual(-1);
    expect(await editorLeft(page).evaluate((element, previous) => element === previous, original)).toBe(true);
    await recordGeometry(page, `attach-banner-${width}`);
    if (width === 1280) {
      await banner.getByRole('button', { name: 'Cancel (Esc)', exact: true }).click();
      await expect(banner).toHaveCount(0);
      await expect(page.locator('.status-badge')).toHaveAttribute('title', 'Revision 1');
    } else {
      // Real native pointer selection adds a second mention to the existing annotation.
      await editorLeft(page).scrollIntoViewIfNeeded();
      const from = await characterPoint(editorLeft(page), 10);
      const to = await characterPoint(editorLeft(page), 12, 'end');
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
      await expect(banner).toHaveCount(0);
      await mentionWithOffsets(page, '[10:13]').scrollIntoViewIfNeeded();
      await expect(mentionWithOffsets(page, '[10:13]')).toHaveText(/und/);
      await expect(mentionWithOffsets(page, '[0:9]')).toBeVisible();
      await expect(page.locator('.status-badge')).toHaveAttribute('title', 'Revision 2');
      await expect(editorLeft(page).locator('[data-paragraph]')).toHaveCount(13);
      expect(await editorLeft(page).evaluate((element, previous) => element === previous, original)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const selector of ['.app-layout > .sidebar', '.inspector-pane', '.tree-host']) {
    const control = page.locator(selector); await control.scrollIntoViewIfNeeded(); await expect(control).toBeInViewport({ ratio: 0.2 });
    const rect = await control.boundingBox(); expect(rect!.width).toBeGreaterThanOrEqual(300);
  }
  await comparisonControls(page).getByRole('button', { name: 'Close comparison', exact: true }).click();
  await expect(comparison(page)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeFocused();
  expect(await editorLeft(page).evaluate((element, previous) => element === previous, original)).toBe(true);
  const text = await page.locator('.app-layout > .center-pane').boundingBox();
  const inspector = await page.locator('.inspector-pane').boundingBox(), tree = await page.locator('.tree-host').boundingBox();
  expect(text!.width).toBeGreaterThanOrEqual(500); expect(text!.height).toBeGreaterThanOrEqual(500);
  expect(tree!.height).toBeGreaterThanOrEqual(300); expect(tree!.width).toBeGreaterThanOrEqual(300);
  expect(Math.abs(tree!.x - inspector!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tree!.y - inspector!.y - inspector!.height)).toBeLessThanOrEqual(1);
  expect(tree!.x + tree!.width).toBeLessThanOrEqual(1281); expect(tree!.y + tree!.height).toBeLessThanOrEqual(721);
});

test('Unicode pointer and native Shift-click selections with keyboard edge resize keep exact codepoint offsets through marker redraws', async ({ page }) => {
  const s = await scenario(page); await loginExisting(page, s.users.alice);
  await page.goto(`/#/tasks/${s.assignments.alice}`); await expect(editorLeft(page)).toHaveText(s.texts.target);
  await readyEditor(page, s);
  const text = s.texts.target, astral = '\u{1F600}';
  const start16 = text.indexOf(astral);
  expect(start16).toBeGreaterThanOrEqual(0);
  expect(text.slice(start16, start16 + astral.length + 1)).toBe(`${astral}\u00e9`);
  const start = Array.from(text.slice(0, start16)).length;
  const from = await characterPoint(editorLeft(page), start16);
  const to = await characterPoint(editorLeft(page), start16 + astral.length, 'end');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
  await recordGeometry(page, 'native-unicode-selection');
  await expect(page.getByLabel('New finding', { exact: true })).toBeVisible();
  await page.getByLabel("Search term", { exact: true }).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  await expect(mentionWithOffsets(page, `[${start}:${start + 2}]`)).toBeVisible();
  await expect(editorLeft(page).locator('[data-paragraph]')).toHaveCount(13);
  await editorLeft(page).locator('.resize-handle--end').focus();
  // Stay on visible characters: the existing resize contract skips outward whitespace.
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
  await expect(mentionWithOffsets(page, `[${start}:${start + 1}]`)).toBeVisible();
  await expect(editorLeft(page).locator('[data-paragraph]')).toHaveCount(13);
  await expect(editorLeft(page).locator('.resize-handle--end')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(mentionWithOffsets(page, `[${start}:${start + 2}]`)).toBeVisible();
  await expect(editorLeft(page).locator('[data-paragraph]')).toHaveCount(13);
  // Cross a real paragraph marker by pointer; offsets remain source codepoints.
  const end16 = text.indexOf('\n\n') + 2 + 5, end = Array.from(text.slice(0, end16)).length;
  await dragEndTo(page, editorLeft(page), end16);
  await expect(mentionWithOffsets(page, `[${start}:${end}]`)).toBeVisible();
  await expect(editorLeft(page).locator('[data-paragraph]')).toHaveCount(13);
  // Chromium's non-editable text uses native Shift-click to extend a selection;
  // a collapsed script caret does not enable browser caret-browsing arrows.
  await expect(page.locator('.status-badge')).toHaveAttribute('title', 'Revision 4');
  await expect(page.locator('.status-badge')).toContainText('Saved');
  const anchor = await characterPoint(editorLeft(page), 0);
  const endpoint = await characterPoint(editorLeft(page), 8, 'end');
  await page.mouse.click(anchor.x, anchor.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(endpoint.x, endpoint.y);
  await page.keyboard.up('Shift');
  await expect(page.getByLabel('New finding', { exact: true })).toBeVisible();
  await page.getByLabel("Search term", { exact: true }).fill('Hypotonia');
  await page.locator('.candidate-card').filter({ hasText: 'HP:0001252' }).click();
  await expect(mentionWithOffsets(page, '[0:9]')).toBeVisible();
  await expect(page.locator('.status-badge')).toHaveAttribute('title', 'Revision 5');
  await exactText(editorLeft(page), text);
  await expect(editorLeft(page).locator('[data-paragraph]')).toHaveCount(13);
});

test('read-only comparison selection and keyboard leave the editable left draft unchanged and expose no resize', async ({ page }) => {
  const s = await scenario(page); await loginExisting(page, s.users.alice); await annotation(page, s);
  await page.goto(`/#/tasks/${s.assignments.alice}`); await readyEditor(page, s);
  await page.locator('.sidebar [data-list-key^="annotation:"]').first().click();
  await expect(mentionWithOffsets(page, '[0:9]')).toBeVisible();
  await openVersions(page); await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(rightText(page)).toHaveText(s.texts.source);
  await expect(page.locator('.status-badge')).toHaveAttribute('title', 'Revision 1');
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST' && /\/workspaces\/.+\/(commands|decisions|submit)/.test(request.url())) writes.push(request.url()); });
  await rightText(page).focus();
  await rightText(page).evaluate(element => {
    const node = element.querySelector('.run')!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 9);
    const selected = window.getSelection()!; selected.removeAllRanges(); selected.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift');
  await expect(comparison(page).locator('.resize-handle')).toHaveCount(0);
  await expect(comparison(page).getByLabel('Annotations', { exact: true }).locator('option[value="draft"]')).toHaveCount(0);
  await expect(page.getByLabel('New finding', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  await expect(page.locator('.status-badge')).toHaveAttribute('title', 'Revision 1');
  await mentionWithOffsets(page, '[0:9]').scrollIntoViewIfNeeded();
  await expect(mentionWithOffsets(page, '[0:9]')).toBeVisible();
});

test('manual right variant/ref/coupling survive real left retry, then current exact revocation conceals history while text remains', async ({ page, browser }) => {
  const s = await scenario(page); await loginExisting(page, s.users.alice); await annotation(page, s, true);
  const own = (await refs(page, s, s.documents.target)).find(ref => ref.kind === 'own')!;
  await page.route('**/api/v1/me/tasks', route => route.abort('failed'));
  await openViewer(page, s, s.documents.source); await openVersions(page); await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const pane = comparison(page);
  await pane.getByLabel('Language', { exact: true }).selectOption('de');
  await pane.getByLabel('Text version', { exact: true }).selectOption(s.documents.target);
  await pane.getByLabel('Annotations', { exact: true }).selectOption(refToken(own));
  await expect(pane.locator('.readonly-annotations')).toContainText('HP:0001252');
  await comparisonControls(page).getByLabel('Couple scrolling', { exact: true }).uncheck();
  const owner = await pane.elementHandle();
  await page.unroute('**/api/v1/me/tasks');
  let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
  const pattern = `**/documents/${encodeURIComponent(s.documents.source)}/text`;
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let continued!: () => void; const done = new Promise<void>(resolve => { continued = resolve; });
  await page.route(pattern, async route => { entered(); await paused; try { await route.continue(); } finally { continued(); } });
  try {
    await page.getByRole('button', { name: 'Retry', exact: true }).click(); await started;
    await expect(pane.getByLabel('Text version', { exact: true })).toHaveValue(s.documents.target);
    await expect(pane.locator('.readonly-annotations')).toHaveCount(0);
    expect(await pane.evaluate((element, previous) => element === previous, owner)).toBe(true);
  } finally { release(); await done; await page.unroute(pattern); }
  await expect(pane.locator('.readonly-annotations')).toContainText('HP:0001252');
  await expect(pane.getByLabel('Annotations', { exact: true })).toHaveValue(refToken(own));
  await expect(comparisonControls(page).getByLabel('Couple scrolling', { exact: true })).not.toBeChecked();
  await manage(browser, s, s.assignments.alice, 'revoke');
  await pane.getByLabel('Annotations', { exact: true }).selectOption('text');
  const denied = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/annotation-versions/own/') && response.status() === 404);
  await pane.getByLabel('Annotations', { exact: true }).selectOption(refToken(own));
  await denied;
  await expect(pane.locator('.readonly-annotations')).toHaveCount(0); await exactText(rightText(page), s.texts.target);
  await pane.getByRole('button', { name: 'Retry comparison', exact: true }).click();
  await expect.poll(async () => (await refs(page, s, s.documents.target)).length).toBe(0);
  await expect(pane.getByLabel('Text version', { exact: true })).toHaveValue(s.documents.target);
  const forged = await authenticatedRequest(page, path(s, s.documents.target, `annotation-versions/own/${encodeURIComponent(own.id)}`));
  expect(forged.status()).toBe(404);
});

for (const width of [800, 600]) test(`comparison stacks with reachable independent selectors and close control at ${width}px`, async ({ page }) => {
  const s = await scenario(page); await loginExisting(page, s.users.alice); await page.setViewportSize({ width, height: 800 });
  await openViewer(page, s); await openComparison(page, s);
  await rightText(page).scrollIntoViewIfNeeded(); await expect(rightText(page)).toBeInViewport({ ratio: 0.2 });
  await expect(comparison(page).getByLabel('Text version', { exact: true })).toBeDisabled();
  await comparison(page).getByLabel('Language', { exact: true }).selectOption('de');
  await expect(comparison(page).getByLabel('Text version', { exact: true })).toBeEnabled();
  for (const name of ['Language', 'Text version', 'Annotations']) {
    const select = comparison(page).getByLabel(name, { exact: true }); await select.scrollIntoViewIfNeeded(); await select.focus(); await expect(select).toBeFocused();
    const rect = await select.boundingBox(); expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await comparisonControls(page).getByRole('button', { name: 'Close comparison', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeFocused(); await expect(comparison(page)).toHaveCount(0);
});

test('equal-count merged and split paragraphs show positional partners and continuous progress without feedback', async ({page}) => {
  await page.setViewportSize({width:1280,height:720});
  const response=await page.request.post('/__test_variants__?comparison=true&merge_split=true');
  expect(response.ok()).toBeTruthy(); const s=await response.json() as Scenario;
  await loginExisting(page,s.users.lead); await openViewer(page,s); await openComparison(page,s);
  const left=viewerLeft(page),right=rightText(page),box=comparisonControls(page).getByLabel('Couple scrolling');
  await expect(box).not.toBeChecked(); const before=await left.evaluate(el=>el.scrollHeight);
  await box.focus(); await page.keyboard.press('Space');
  await expect(comparisonStatus(page).getByText('Paragraphs are paired by position, not by meaning',{exact:true})).toBeVisible();
  expect(await left.evaluate(el=>el.scrollHeight)).toBe(before);
  for(const fraction of [0.25,0.5,0.75]) {
    await left.dispatchEvent('wheel');
    const position=await left.evaluate((el,fraction)=>{
      const rows=el.querySelectorAll('[data-paragraph]'); const top=(i:number)=>el.scrollTop+rows[i].getBoundingClientRect().top-el.getBoundingClientRect().top-el.clientTop;
      el.scrollTop=top(1)+(top(2)-top(1))*fraction; return el.scrollTop;
    },fraction);
    await expect.poll(()=>right.evaluate(el=>{const rows=el.querySelectorAll('[data-paragraph]'); const top=(i:number)=>el.scrollTop+rows[i].getBoundingClientRect().top-el.getBoundingClientRect().top-el.clientTop; return (el.scrollTop-top(1))/(top(2)-top(1));})).toBeCloseTo(fraction,2);
    await right.dispatchEvent('scroll'); await page.waitForTimeout(180); await right.dispatchEvent('scroll');
    expect(await left.evaluate(el=>el.scrollTop)).toBe(position);
    await expect(comparisonStatus(page).getByLabel('Paragraph pairing')).toHaveText('Current text paragraph 2 ↔ Comparison paragraph 2');
  }
  await expect(left.locator('[data-paragraph-number="2"]')).toHaveAttribute('data-coupled-active','true');
  await expect(right.locator('[data-paragraph-number="2"]')).toHaveAttribute('data-coupled-active','true');
  const selected=await left.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!; selection.removeAllRanges();selection.addRange(range);return selection.toString();});
  expect(selected).toBe(s.texts.target);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.keyboard.press('Control+c');
  // Windows native copy uses CRLF; compare the canonical LF fixture after that platform conversion.
  expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe(s.texts.target);
  await left.evaluate(()=>window.getSelection()?.removeAllRanges());
  await scrollParagraph(left,1);
  await page.screenshot({path:test.info().outputPath('coupling-desktop.png')});
  await page.setViewportSize({width:1099,height:768});
  await expect(left.locator('[data-paragraph-number]')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('coupling-narrow.png')});
});
