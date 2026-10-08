import { expect, test, type Locator, type Page } from "@playwright/test";
import { importPackage, openCase, selectText } from "./helpers";

// The fixture's ontology (tests/fixtures/hp.json) is a single-parent tree:
// All > Phenotypic abnormality > { Abnormality of the nervous system >
// { Areflexia, Hypotonia, Seizure > { Dialeptic seizure, Status epilepticus } },
// Hearing impairment > Sensorineural hearing impairment }.
// The document is "Hypotonia and seizure. ...": "Hypotonia" at 0-9, "seizure" at 14-21.

const revision = (page: Page) => page.locator(".status-badge");
const showInTree = (page: Page) => page.getByRole("button", { name: "Show in tree" });
const treeDialog = (page: Page) => page.getByRole("dialog", { name: "Ontology tree" });
const treePanel = (page: Page) => page.getByRole("region", { name: "Ontology tree" });
const ownAnnotations = (page: Page) => page.locator(".sidebar [data-list-key^='annotation:']");

/** The tree row of a term. */
const treeItem = (page: Page, termId: string) =>
  page.getByRole("tree", { name: "Terms" }).locator(`li[role="treeitem"][data-term-id="${termId}"]`);

const SEIZURE = "HP:0001250";
const DIALEPTIC = "HP:0011146";
const STATUS_EPILEPTICUS = "HP:0002133";
const NERVOUS_SYSTEM = "HP:0000707";
const HYPOTONIA = "HP:0001252";
const HEARING = "HP:0000365";
const SENSORINEURAL = "HP:0000407";

/** Mark text, search a term and pick it; the new annotation stays selected. */
async function annotate(page: Page, start: number, end: number, query: string, termId: string, expectedRevision: number) {
  await selectText(page, start, end);
  await page.getByLabel(/Search ontology term/i).fill(query);
  await page.locator(".candidate-card").filter({ hasText: termId }).click();
  await expect(revision(page)).toHaveAttribute("title", `Revision ${expectedRevision}`);
}

/** An independent case with one annotation "Seizure" on 14..21, selected. */
async function openWithSeizure(page: Page, annotator: string, size = { width: 1280, height: 720 }) {
  await page.setViewportSize(size);
  await importPackage(page, "", "browser-fixture", annotator);
  await page.locator("#mode-select").selectOption("independent");
  await openCase(page, { identity: annotator });
  await expect(revision(page)).toHaveAttribute("title", "Revision 0");
  await annotate(page, 14, 21, "Seizure", SEIZURE, 1);
  await expect(page.locator(".inspector-pane h2")).toContainText(SEIZURE);
}

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
};

/** What has the keyboard focus, as something two steps can be compared by. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return "none";
    return `${element.tagName}:${element.getAttribute("data-term-id") ?? element.getAttribute("aria-label") ?? element.textContent?.trim()}`;
  });

test.describe("ontology tree", () => {
  test("search a term, open the tree at it, pick a child and use it", async ({ page }) => {
    await openWithSeizure(page, "tree-pick");
    const commands: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/v1\/workspaces\/[^/]+\/commands$/.test(request.url())) {
        commands.push(String(request.postDataJSON()?.payload?.command));
      }
    });

    await showInTree(page).click();
    const dialog = treeDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    // Opened at the term: the path is open, the term selected, marked as the
    // annotation's own, focused and on screen.
    const seizure = treeItem(page, SEIZURE);
    await expect(seizure).toHaveAttribute("aria-selected", "true");
    await expect(seizure).toHaveAttribute("aria-expanded", "true");
    await expect(seizure).toHaveAttribute("aria-current", "true");
    await expect(seizure).toBeFocused();
    await expect(seizure).toBeInViewport();
    await expect(dialog.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(dialog.locator(".tree-label")).toHaveText([
      "All",
      "Phenotypic abnormality",
      "Abnormality of the nervous system",
      "Areflexia",
      "Hypotonia",
      "Seizure",
      "Dialeptic seizure",
      "Status epilepticus",
      "Hearing impairment",
    ]);
    // Leaves are neither open nor closed; the closed branch says so.
    await expect(treeItem(page, STATUS_EPILEPTICUS)).not.toHaveAttribute("aria-expanded", /.*/);
    await expect(treeItem(page, HEARING)).toHaveAttribute("aria-expanded", "false");
    await expect(dialog.locator(".tree-detail__name")).toHaveText("Seizure");
    await expect(dialog.locator(".tree-detail__id")).toHaveText(SEIZURE);
    await expect(dialog.getByRole("status")).toHaveCount(0);

    // The dialog is about 900x600 and centred, tree left of the details.
    const frame = await box(dialog);
    expect(frame.width).toBeGreaterThanOrEqual(880);
    expect(frame.height).toBeGreaterThanOrEqual(580);
    expect(Math.abs(frame.x + frame.width / 2 - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(frame.y + frame.height / 2 - 360)).toBeLessThanOrEqual(2);
    const rows = await box(dialog.getByRole("tree", { name: "Terms" }));
    const details = await box(dialog.locator(".tree-detail"));
    expect(rows.x + rows.width).toBeLessThanOrEqual(details.x + 1);
    expect(details.width).toBeGreaterThanOrEqual(300);

    // The annotation's own term cannot be "used".
    const use = dialog.getByRole("button", { name: "Use this term" });
    await expect(use).toBeDisabled();

    // A click selects and shows the details; it assigns nothing.
    await treeItem(page, STATUS_EPILEPTICUS).click();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-selected", "true");
    await expect(seizure).toHaveAttribute("aria-selected", "false");
    await expect(seizure).toHaveAttribute("aria-current", "true");
    await expect(dialog.locator(".tree-detail__name")).toHaveText("Status epilepticus");
    await expect(dialog.locator(".tree-detail__id")).toHaveText(STATUS_EPILEPTICUS);
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
    expect(commands).toEqual([]);

    await expect(use).toBeEnabled();
    await use.click();
    // The dialog closes once the term is saved.
    await expect(dialog).toHaveCount(0);
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");

    // The annotation carries the child now, in the panel and in the sidebar, and is still selected.
    await expect(page.locator(".inspector-pane h2")).toContainText("Status epilepticus");
    await expect(page.locator(".inspector-pane h2")).toContainText(STATUS_EPILEPTICUS);
    await expect(ownAnnotations(page)).toHaveCount(1);
    await expect(ownAnnotations(page)).toContainText("Status epilepticus");
    await expect(ownAnnotations(page)).toContainText(STATUS_EPILEPTICUS);
    await expect(ownAnnotations(page)).not.toContainText(SEIZURE);
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
    await expect(showInTree(page)).toBeFocused();

    // One edit, one revision: nothing else was sent, and nothing follows.
    expect(commands).toEqual(["set_term"]);
    await page.waitForTimeout(300);
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    expect(commands).toEqual(["set_term"]);

    // Opened again, the tree starts at the new term.
    await showInTree(page).click();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, SEIZURE)).not.toHaveAttribute("aria-current", "true");
  });

  test("the tree is operable by keyboard and keeps the focus inside the dialog", async ({ page }) => {
    await openWithSeizure(page, "tree-keys");
    await showInTree(page).focus();
    await page.keyboard.press("Enter");
    const dialog = treeDialog(page);
    await expect(treeItem(page, SEIZURE)).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(treeItem(page, DIALEPTIC)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(treeItem(page, SEIZURE)).toBeFocused();

    // Left closes the open branch, left again goes to the parent.
    await page.keyboard.press("ArrowLeft");
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-expanded", "false");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveCount(0);
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(treeItem(page, NERVOUS_SYSTEM)).toBeFocused();
    // Moving the focus selected nothing.
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, NERVOUS_SYSTEM)).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("Home");
    await expect(treeItem(page, "HP:0000001")).toBeFocused();

    // "Hearing impairment" is closed: opening it fetches its children.
    await page.keyboard.press("End");
    await expect(treeItem(page, HEARING)).toBeFocused();
    const fetched = page.waitForResponse((response) => response.url().endsWith("/api/v1/terms/tree/node"));
    await page.keyboard.press("ArrowRight");
    expect((await fetched).ok()).toBeTruthy();
    await expect(treeItem(page, HEARING)).toHaveAttribute("aria-expanded", "true");
    await expect(treeItem(page, SENSORINEURAL)).toBeVisible();
    // Right on an open branch goes to its first child.
    await page.keyboard.press("ArrowRight");
    await expect(treeItem(page, SENSORINEURAL)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(treeItem(page, SENSORINEURAL)).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator(".tree-detail__name")).toHaveText("Sensorineural hearing impairment");
    await expect(dialog.getByRole("button", { name: "Use this term" })).toBeEnabled();

    // Exactly one row is in the Tab order.
    await expect(dialog.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);

    // Tab goes round inside the dialog: pin, close, the tree, "Use this term",
    // and back to the pin. It never reaches the page behind.
    const forward: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      await expect(dialog.locator(":focus")).toHaveCount(1);
      forward.push(await focused(page));
    }
    expect(forward.slice(0, 4)).toEqual([
      "BUTTON:Use this term",
      "BUTTON:Keep open",
      "BUTTON:Close tree",
      `LI:${SENSORINEURAL}`,
    ]);
    expect(forward.slice(4)).toEqual(forward.slice(0, 4));
    const backward: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.locator(":focus")).toHaveCount(1);
      backward.push(await focused(page));
    }
    expect(backward.slice(0, 4)).toEqual([
      "BUTTON:Close tree",
      "BUTTON:Keep open",
      "BUTTON:Use this term",
      `LI:${SENSORINEURAL}`,
    ]);
    expect(backward.slice(4)).toEqual(backward.slice(0, 4));

    // Escape closes the dialog from a button as well as from the tree, and
    // only the dialog: nothing was assigned, the annotation is still selected.
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Use this term" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(showInTree(page)).toBeFocused();
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
    await expect(page.locator(".inspector-pane h2")).toContainText(SEIZURE);
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");

    // And from inside the tree.
    await page.keyboard.press("Enter");
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(showInTree(page)).toBeFocused();
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
  });

  test("pinned at 1280x720, the tree sits beside the text and follows the selection", async ({ page }) => {
    await openWithSeizure(page, "tree-pin");
    const textBefore = await box(page.locator(".center-pane"));

    await showInTree(page).click();
    const pin = treeDialog(page).getByRole("button", { name: "Keep open" });
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await treeItem(page, STATUS_EPILEPTICUS).click();
    const opens: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/terms/tree/open")) opens.push(String(request.postDataJSON()?.term_id));
    });
    await pin.click();

    const panel = treePanel(page);
    await expect(panel).toBeVisible();
    await expect(treeDialog(page)).toHaveCount(0);
    await expect(page.locator(".app-layout")).toHaveClass(/tree-pinned/);
    await expect(page.locator(".tree-host--panel")).toHaveCount(1);
    await expect(panel.getByRole("button", { name: "Keep open" })).toHaveAttribute("aria-pressed", "true");
    // The same walk, now docked: what was selected is still selected, and no second walk began.
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toBeInViewport();
    expect(opens).toEqual([]);

    // 1280x720: case text, annotation panel and tree are all on screen, none
    // covers another, and each has a usable size.
    const sidebar = await box(page.locator(".app-layout > .sidebar"));
    const text = await box(page.locator(".center-pane"));
    const inspector = await box(page.locator(".inspector-pane"));
    const tree = await box(page.locator(".tree-host--panel"));
    // The text keeps the width it had without the tree.
    expect(text.width).toBe(textBefore.width);
    expect(text.width).toBeGreaterThanOrEqual(500);
    expect(text.height).toBeGreaterThanOrEqual(500);
    expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(text.x + 1);
    expect(text.x + text.width).toBeLessThanOrEqual(inspector.x + 1);
    expect(text.x + text.width).toBeLessThanOrEqual(tree.x + 1);
    expect(inspector.width).toBeGreaterThanOrEqual(370);
    expect(inspector.height).toBeGreaterThanOrEqual(200);
    expect(tree.width).toBe(inspector.width);
    expect(tree.height).toBeGreaterThanOrEqual(300);
    expect(inspector.y + inspector.height).toBeLessThanOrEqual(tree.y + 1);
    expect(tree.x + tree.width).toBeLessThanOrEqual(1281);
    expect(tree.y + tree.height).toBeLessThanOrEqual(721);
    // Inside the tree: the rows and the details each have room for some lines.
    const rows = await box(panel.locator(".tree-browser__tree"));
    const details = await box(panel.locator(".tree-detail__body"));
    const rowHeight = (await box(treeItem(page, SEIZURE))).height;
    expect(rows.height).toBeGreaterThanOrEqual(4 * rowHeight);
    expect(details.height).toBeGreaterThanOrEqual(60);
    expect(rows.y + rows.height).toBeLessThanOrEqual(details.y + 1);
    await expect(panel.getByRole("button", { name: "Use this term" })).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole("button", { name: "Close tree" })).toBeInViewport({ ratio: 1 });
    await expect(showInTree(page)).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".text-container")).toBeInViewport();
    await expect(page.locator(".text-container .run--marked").filter({ hasText: "seizure" })).toBeInViewport({ ratio: 1 });
    // Nothing made the page itself scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBeTruthy();

    // "Use this term" keeps the panel open on the same walk and moves the "current" mark.
    await panel.getByRole("button", { name: "Use this term" }).click();
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    await expect(panel).toBeVisible();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, SEIZURE)).not.toHaveAttribute("aria-current", "true");
    await expect(panel.getByRole("button", { name: "Use this term" })).toBeDisabled();
    await expect(page.locator(".inspector-pane h2")).toContainText(STATUS_EPILEPTICUS);
    expect(opens).toEqual([]);

    // In the panel, Escape belongs to the tree only while the focus is in it.
    await treeItem(page, SEIZURE).click();
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    await panel.getByRole("button", { name: "Use this term" }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();

    // The text is still usable: a second annotation, and the tree goes to its term
    // with a walk of its own, without taking the focus.
    await selectText(page, 0, 9);
    const search = page.getByLabel(/Search ontology term/i);
    await search.fill("Hypotonia");
    // The search has less room above the tree, but it is all there: the box
    // on screen, the candidates by scrolling the annotation panel alone.
    await expect(search).toBeInViewport({ ratio: 1 });
    const candidate = page.locator(".candidate-card").filter({ hasText: HYPOTONIA });
    await expect(candidate).toBeVisible();
    const searching = await box(page.locator(".inspector-pane"));
    expect(searching.height).toBe(inspector.height);
    expect((await box(page.locator(".tree-host--panel"))).y).toBe(tree.y);
    await page.locator(".candidate-card").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".candidate-card").last()).toBeInViewport({ ratio: 1 });
    await candidate.click();
    await expect(revision(page)).toHaveAttribute("title", "Revision 3");
    await expect(ownAnnotations(page)).toHaveCount(2);
    // The annotation panel shows the new annotation from its top, not from
    // where the list of candidates had been scrolled to.
    await expect(page.locator(".inspector-pane h2")).toContainText(HYPOTONIA);
    expect(await page.locator(".inspector-pane").evaluate((pane) => pane.scrollTop)).toBe(0);
    await expect(page.locator(".inspector-pane h2")).toBeInViewport({ ratio: 1 });
    await expect(showInTree(page)).toBeInViewport({ ratio: 1 });
    await expect(treeItem(page, HYPOTONIA)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, HYPOTONIA)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, HYPOTONIA)).toBeInViewport();
    await expect(panel.locator(".tree-detail__name")).toHaveText("Hypotonia");
    await expect(panel.locator(":focus")).toHaveCount(0);
    expect(opens).toEqual([HYPOTONIA]);

    // Back to the first annotation by the sidebar: the tree follows again.
    await ownAnnotations(page).filter({ hasText: STATUS_EPILEPTICUS }).click();
    await expect(page.locator(".inspector-pane h2")).toContainText(STATUS_EPILEPTICUS);
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toBeInViewport();
    await expect(panel.locator(":focus")).toHaveCount(0);
    expect(opens).toEqual([HYPOTONIA, STATUS_EPILEPTICUS]);

    // With the focus in the tree, Escape closes the panel; the annotation stays selected.
    await treeItem(page, STATUS_EPILEPTICUS).click();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".app-layout")).not.toHaveClass(/tree-pinned/);
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
    await expect(revision(page)).toHaveAttribute("title", "Revision 3");
  });

  test("the pin survives a reload, and a narrow window has no pin", async ({ page }) => {
    await openWithSeizure(page, "tree-reload");
    await showInTree(page).click();
    const saved = page.waitForResponse(
      (response) => response.url().endsWith("/api/v1/preferences") && response.request().method() !== "GET",
    );
    await treeDialog(page).getByRole("button", { name: "Keep open" }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(treePanel(page)).toBeVisible();

    // A reload ends the page session: the dashboard comes back with the same
    // package and annotator, the mode and the identity have to be given again.
    await page.reload();
    await expect(page.locator("#package-select")).toHaveValue("browser-fixture");
    await expect(page.getByTestId("dashboard-identity")).toHaveText("tree-reload");
    await page.locator("#mode-select").selectOption("independent");
    await openCase(page, { identity: "tree-reload" });
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
    // Nothing is open until it is asked for ...
    await expect(treePanel(page)).toHaveCount(0);
    await expect(treeDialog(page)).toHaveCount(0);
    await ownAnnotations(page).first().click();
    await showInTree(page).click();
    // ... and then it is the side panel at once, not a dialog.
    await expect(treePanel(page)).toBeVisible();
    await expect(treeDialog(page)).toHaveCount(0);
    await expect(page.locator(".app-layout")).toHaveClass(/tree-pinned/);
    await expect(treePanel(page).getByRole("button", { name: "Keep open" })).toHaveAttribute("aria-pressed", "true");
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    // Opened by hand, the docked tree takes the focus.
    await expect(treeItem(page, SEIZURE)).toBeFocused();

    // Below 1100 px the same walk is a dialog, and there is no pin switch.
    const opens: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/terms/tree/open")) opens.push(String(request.postDataJSON()?.term_id));
    });
    await treeItem(page, DIALEPTIC).click();
    await page.setViewportSize({ width: 1000, height: 700 });
    const dialog = treeDialog(page);
    await expect(dialog).toBeVisible();
    await expect(treePanel(page)).toHaveCount(0);
    await expect(page.locator(".app-layout")).not.toHaveClass(/tree-pinned/);
    await expect(dialog.getByRole("button", { name: "Keep open" })).toHaveCount(0);
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, DIALEPTIC)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, DIALEPTIC)).toBeInViewport();
    // Wide again it docks again, narrow it is a dialog: one walk all along.
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(treePanel(page)).toBeVisible();
    await expect(treeItem(page, DIALEPTIC)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, DIALEPTIC)).toBeInViewport();
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(dialog).toBeVisible();
    expect(opens).toEqual([]);
    await dialog.getByRole("button", { name: "Close tree" }).click();
    await expect(dialog).toHaveCount(0);
    // Opened in the narrow window it is a dialog too, still without the switch.
    await showInTree(page).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep open" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Wide again, the stored choice still holds. Releasing the pin closes the
    // panel, and the next opening is a dialog -- also after another reload.
    await page.setViewportSize({ width: 1280, height: 720 });
    await showInTree(page).click();
    await expect(treePanel(page)).toBeVisible();
    const released = page.waitForResponse(
      (response) => response.url().endsWith("/api/v1/preferences") && response.request().method() !== "GET",
    );
    await treePanel(page).getByRole("button", { name: "Keep open" }).click();
    expect((await released).ok()).toBeTruthy();
    await expect(treePanel(page)).toHaveCount(0);
    await showInTree(page).click();
    await expect(treeDialog(page)).toBeVisible();
    await expect(treeDialog(page).getByRole("button", { name: "Keep open" })).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    await expect(page.locator("#package-select")).toHaveValue("browser-fixture");
    await page.locator("#mode-select").selectOption("independent");
    await openCase(page, { identity: "tree-reload" });
    await ownAnnotations(page).first().click();
    await showInTree(page).click();
    await expect(treeDialog(page)).toBeVisible();
    await expect(treePanel(page)).toHaveCount(0);
  });
});
