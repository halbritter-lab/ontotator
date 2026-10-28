import { expect, test, type Locator, type Page } from "@playwright/test";
import { importPackage, openCase, selectText } from "./helpers";

// The fixture's ontology (tests/fixtures/hp.json) is a single-parent tree:
// All > { Clinical modifier > { Clinical course > Onset, Severity }, Frequency,
// Phenotypic abnormality > { Abnormality of the nervous system >
// { Areflexia, Hypotonia, Seizure > { Dialeptic seizure, Status epilepticus } },
// Hearing impairment > Sensorineural hearing impairment } }.
// The document is "Hypotonia and seizure. ...": "Hypotonia" at 0-9, "seizure" at 14-21.

const revision = (page: Page) => page.locator(".status-badge");
const showInTree = (page: Page) => page.getByRole("button", { name: "Show in tree" });
/** There is one form of the tree. Nothing on the page may be a dialog while it is open. */
const anyDialog = (page: Page) => page.locator('[role="dialog"], [aria-modal], dialog');
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
  // At 700 px and below a new mark stays in the text pane; its "New finding" bar opens the term search.
  if ((page.viewportSize()?.width ?? 1280) <= 700) {
    await page.getByRole("group", { name: "New finding", exact: true }).getByRole("button", { name: "Choose term", exact: true }).click();
  }
  await page.getByLabel("Search term", { exact: true }).fill(query);
  await page.locator(".candidate-card").filter({ hasText: termId }).click();
  await expect(revision(page)).toHaveAttribute("title", `Revision ${expectedRevision}`);
}

/** An independent case with one annotation "Seizure" on 14..21, selected. */
async function openWithSeizure(page: Page, annotator: string, size = { width: 1280, height: 720 }) {
  await page.setViewportSize(size);
  await importPackage(page, "", "browser-fixture-tree", annotator);
  await openCase(page, { task: "annotate" });
  await expect(revision(page)).toHaveAttribute("title", "Revision 0");
  await annotate(page, 14, 21, "Seizure", SEIZURE, 1);
  await expect(page.locator(".inspector-pane h2")).toContainText(SEIZURE);
}

/** Every change of the workspace preferences this page stores from now on. */
function preferenceWrites(page: Page): unknown[] {
  const writes: unknown[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/v1/preferences") || request.method() === "GET") return;
    writes.push(request.postDataJSON());
  });
  return writes;
}

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
};

type Box = { x: number; y: number; width: number; height: number };
/** The same place and size. Grid tracks land on fractions of a pixel, so to the pixel. */
const expectSameBox = (actual: Box, expected: Box) => {
  for (const side of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(actual[side] - expected[side]), `${side}: ${actual[side]} for ${expected[side]}`).toBeLessThan(1);
  }
};

/**
 * At 700 px and below the header and case toolbar scroll away; the workspace (pane tabs and the
 * open pane) is then exactly one viewport, at its top, and nothing below it overflows the page.
 */
const expectWorkspaceFillsViewport = async (page: Page, size: { width: number; height: number }) => {
  expectSameBox(await box(page.locator(".case-workspace")), { x: 0, y: 0, ...size });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBeTruthy();
};

/** What has the keyboard focus, as something two steps can be compared by. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return "none";
    return `${element.tagName}:${element.getAttribute("data-term-id") ?? element.getAttribute("aria-label") ?? element.textContent?.trim()}`;
  });

test.describe("ontology tree", () => {
  test("term labels remain readable beside ids and links in the tablet tree", async ({ page }) => {
    await openWithSeizure(page, "tree-label-width", { width: 800, height: 700 });
    await showInTree(page).click();
    const label = treeItem(page, SEIZURE).locator(".tree-label");
    await expect(label).toBeVisible();
    expect((await box(label)).width).toBeGreaterThanOrEqual(70);
    await expect(treeItem(page, SEIZURE).locator(".tree-id")).toBeVisible();
    await expect(treeItem(page, SEIZURE).locator(".tree-external")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });


  test("every row shows its term id and links to hpo.jax.org without selecting", async ({ page }) => {
    await openWithSeizure(page, "tree-links");
    await showInTree(page).click();
    const row = treeItem(page, DIALEPTIC);
    await expect(row.locator(".tree-id")).toHaveText(DIALEPTIC);
    const link = row.locator("a.tree-external");
    await expect(link).toHaveAttribute("href", `https://hpo.jax.org/browse/term/${DIALEPTIC}`);
    await expect(link).toHaveAttribute("target", "_blank");

    await page.context().route("https://hpo.jax.org/**", route => route.abort());

    // Follow the link without leaving the case: the new tab is closed again.
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await popup.close();
    // The clicked link remains focusable: Enter must open its page, never select the row.
    await link.focus();
    const [keyboardPopup] = await Promise.all([page.waitForEvent("popup"), page.keyboard.press("Enter")]);
    await keyboardPopup.close();
    await expect(row).toHaveAttribute("aria-selected", "false");
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
  });

  test("open the tree at a term, pick a child and use it", async ({ page }) => {
    // Taller than the default: the monospace term IDs use the system font, which is wider
    // on Linux and wraps a row, so the start term would not fit in 720 px there.
    await openWithSeizure(page, "tree-pick", { width: 1280, height: 900 });
    const commands: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/v1\/workspaces\/[^/]+\/commands$/.test(request.url())) {
        commands.push(String(request.postDataJSON()?.payload?.command));
      }
    });

    await showInTree(page).click();
    const panel = treePanel(page);
    await expect(panel).toBeVisible();
    await expect(anyDialog(page)).toHaveCount(0);

    // Opened at the term: the path is open, the term selected, marked as the
    // annotation's own, focused and on screen.
    const seizure = treeItem(page, SEIZURE);
    await expect(seizure).toHaveAttribute("aria-selected", "true");
    await expect(seizure).toHaveAttribute("aria-expanded", "true");
    await expect(seizure).toHaveAttribute("aria-current", "true");
    await expect(seizure).toBeFocused();
    await expect(seizure).toBeInViewport({ ratio: 1 });
    await expect(panel.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(panel.locator(".tree-label")).toHaveText([
      "All",
      "Clinical modifier",
      "Frequency",
      "Phenotypic abnormality",
      "Abnormality of the nervous system",
      "Areflexia",
      "Hypotonia",
      "Seizure",
      "Dialeptic seizure",
      "Status epilepticus",
      "Hearing impairment",
    ]);
    // The start term is among the first rows, which fit: the tree is shown from its
    // top, not scrolled to put the term in the middle. "All" is the first row, whole,
    // right under the header.
    const rowsBox = panel.locator(".tree-browser__tree");
    expect(await rowsBox.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(treeItem(page, "HP:0000001")).toBeInViewport({ ratio: 1 });
    const first = await box(treeItem(page, "HP:0000001"));
    const rowsFrame = await box(rowsBox);
    const headerFrame = await box(panel.locator(".tree-browser__header"));
    expect(first.y).toBeGreaterThanOrEqual(rowsFrame.y);
    expect(first.y - (headerFrame.y + headerFrame.height)).toBeLessThanOrEqual(8);
    // Every row down to the start term is whole inside the tree's box.
    for (const termId of ["HP:0000001", "HP:0000118", NERVOUS_SYSTEM, "HP:0001284", HYPOTONIA, SEIZURE]) {
      const row = await box(treeItem(page, termId));
      expect(row.y, termId).toBeGreaterThanOrEqual(rowsFrame.y);
      expect(row.y + row.height, termId).toBeLessThanOrEqual(rowsFrame.y + rowsFrame.height + 0.5);
    }
    // Leaves are neither open nor closed; the closed branch says so.
    await expect(treeItem(page, STATUS_EPILEPTICUS)).not.toHaveAttribute("aria-expanded", /.*/);
    await expect(treeItem(page, HEARING)).toHaveAttribute("aria-expanded", "false");
    await expect(panel.locator(".tree-detail__name")).toHaveText("Seizure");
    await expect(panel.locator(".tree-detail__id")).toHaveText(SEIZURE);
    await expect(panel.getByRole("status")).toHaveCount(0);

    // The header: the title and one control, to close.
    const header = panel.locator(".tree-browser__header");
    await expect(header.getByRole("heading", { name: "Ontology tree" })).toBeVisible();
    await expect(header.getByRole("button")).toHaveCount(1);
    await expect(header.getByRole("button", { name: "Close tree" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep open" })).toHaveCount(0);

    // The annotation's own term cannot be "used".
    const use = panel.getByRole("button", { name: "Use this term" });
    await expect(use).toBeDisabled();

    // A click selects and shows the details; it assigns nothing.
    await treeItem(page, STATUS_EPILEPTICUS).click();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-selected", "true");
    await expect(seizure).toHaveAttribute("aria-selected", "false");
    await expect(seizure).toHaveAttribute("aria-current", "true");
    await expect(panel.locator(".tree-detail__name")).toHaveText("Status epilepticus");
    await expect(panel.locator(".tree-detail__id")).toHaveText(STATUS_EPILEPTICUS);
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
    expect(commands).toEqual([]);

    await expect(use).toBeEnabled();
    await use.click();
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    // The tree stays open, with the new term marked as the current one.
    await expect(panel).toBeVisible();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-current", "true");
    await expect(seizure).not.toHaveAttribute("aria-current", "true");
    await expect(use).toBeDisabled();

    // The annotation carries the child now, in the panel and in the sidebar, and is still selected.
    await expect(page.locator(".inspector-pane h2")).toContainText("Status epilepticus");
    await expect(page.locator(".inspector-pane h2")).toContainText(STATUS_EPILEPTICUS);
    await expect(ownAnnotations(page)).toHaveCount(1);
    await expect(ownAnnotations(page)).toContainText("Status epilepticus");
    await expect(ownAnnotations(page)).toContainText(STATUS_EPILEPTICUS);
    await expect(ownAnnotations(page)).not.toContainText(SEIZURE);
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);

    // One edit, one revision: nothing else was sent, and nothing follows.
    expect(commands).toEqual(["set_term"]);
    await page.waitForTimeout(300);
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    expect(commands).toEqual(["set_term"]);

    // Closed with its button, the focus is back on "Show in tree"; nothing else changed.
    await panel.getByRole("button", { name: "Close tree" }).click();
    await expect(panel).toHaveCount(0);
    await expect(showInTree(page)).toBeFocused();
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");

    // Opened again, the tree starts at the new term.
    await showInTree(page).click();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toBeFocused();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toBeInViewport({ ratio: 1 });
    await expect(treeItem(page, SEIZURE)).not.toHaveAttribute("aria-current", "true");
  });

  test("the tree is operable by keyboard and never holds the focus", async ({ page }) => {
    await openWithSeizure(page, "tree-keys");
    await showInTree(page).focus();
    await page.keyboard.press("Enter");
    const panel = treePanel(page);
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
    await expect(treeItem(page, "HP:0000001")).toBeInViewport({ ratio: 1 });

    // "Hearing impairment" is closed: opening it fetches its children.
    await page.keyboard.press("End");
    await expect(treeItem(page, HEARING)).toBeFocused();
    await expect(treeItem(page, HEARING)).toBeInViewport({ ratio: 1 });
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
    await expect(panel.locator(".tree-detail__name")).toHaveText("Sensorineural hearing impairment");
    await expect(panel.getByRole("button", { name: "Use this term" })).toBeEnabled();

    // Exactly one row is in the Tab order.
    await expect(panel.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);

    // Tab is the browser's: from the row on to "Use this term" (over the details,
    // where the browser makes their scrolling box a stop), and then out of the tree.
    // Nothing brings the focus round to the tree's first control again.
    const stopsInTree = async (key: "Tab" | "Shift+Tab") => {
      const stops: string[] = [];
      for (let step = 0; step < 6; step += 1) {
        await page.keyboard.press(key);
        if ((await panel.locator(":focus").count()) === 0) return stops;
        stops.push((await focused(page)).split(":")[0] === "DIV" ? "details" : await focused(page));
      }
      throw new Error(`The focus did not leave the tree: ${stops.join(", ")}`);
    };
    const forward = await stopsInTree("Tab");
    expect(forward.filter((stop) => stop !== "details")).toEqual([
      `A:View ${SENSORINEURAL} on hpo.jax.org`,
      "BUTTON:Use this term",
    ]);
    await expect(panel).toBeVisible();
    // Backwards: "Use this term", the detail link, the row, the close button, and
    // on into the annotation panel above.
    const backward = await stopsInTree("Shift+Tab");
    expect(backward.filter((stop) => stop !== "details")).toEqual([
      "BUTTON:Use this term",
      `A:View ${SENSORINEURAL} on hpo.jax.org`,
      `LI:${SENSORINEURAL}`,
      "BUTTON:Close tree",
    ]);
    await expect(page.locator(".inspector-pane :focus")).toHaveCount(1);
    await expect(panel).toBeVisible();

    // Escape closes the tree from inside the tree widget, and only the tree:
    // nothing was assigned, the annotation is still selected, and the focus is
    // back on the button the tree was opened with.
    await treeItem(page, SENSORINEURAL).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(showInTree(page)).toBeFocused();
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
    await expect(page.locator(".inspector-pane h2")).toContainText(SEIZURE);
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");

    // Opened again with the keyboard, it is a new walk at the term, and Escape closes it again.
    await page.keyboard.press("Enter");
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(showInTree(page)).toBeFocused();
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);

    // On one of the tree's buttons Escape is the case screen's, as everywhere
    // outside the tree widget: it clears the selection, and the tree stays.
    await page.keyboard.press("Enter");
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    await panel.getByRole("button", { name: "Close tree" }).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
  });

  test("'Show in tree' docks the tree under the annotation panel at 1280x720, and it follows the selection", async ({ page }) => {
    await openWithSeizure(page, "tree-first");
    const textBefore = await box(page.locator(".center-pane"));
    const stored = preferenceWrites(page);

    // The tree does not open in a window.
    await showInTree(page).click();
    const panel = treePanel(page);
    await expect(panel).toBeVisible();
    await expect(anyDialog(page)).toHaveCount(0);
    await expect(page.locator(".app-layout")).toHaveClass(/tree-open/);
    await expect(page.locator(".tree-host")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Keep open" })).toHaveCount(0);
    await expect(panel).not.toHaveAttribute("aria-modal", /.*/);
    // Opened at the term, which has the focus and is on screen.
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    await expect(treeItem(page, SEIZURE)).toBeInViewport({ ratio: 1 });
    // The annotation panel above it shows the annotation from its top.
    expect(await page.locator(".inspector-pane").evaluate((pane) => pane.scrollTop)).toBe(0);
    await expect(page.locator(".inspector-pane h2")).toBeInViewport({ ratio: 1 });
    await expect(showInTree(page)).toBeInViewport({ ratio: 1 });
    // Opening the tree is not a setting: nothing was stored.
    expect(stored).toEqual([]);

    await treeItem(page, STATUS_EPILEPTICUS).click();
    const opens: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/terms/tree/open")) opens.push(String(request.postDataJSON()?.term_id));
    });
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toBeInViewport();

    // 1280x720: case text, annotation panel and tree are all on screen, none
    // covers another, and each has a usable size.
    const sidebar = await box(page.locator(".app-layout > .sidebar"));
    const text = await box(page.locator(".center-pane"));
    const inspector = await box(page.locator(".inspector-pane"));
    const tree = await box(page.locator(".tree-host"));
    // The text keeps the place and the size it had without the tree.
    expectSameBox(text, textBefore);
    expect(text.width).toBeGreaterThanOrEqual(500);
    expect(text.height).toBeGreaterThanOrEqual(500);
    expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(text.x + 1);
    expect(text.x + text.width).toBeLessThanOrEqual(inspector.x + 1);
    expect(inspector.width).toBeGreaterThanOrEqual(370);
    expect(inspector.height).toBeGreaterThanOrEqual(200);
    // The tree is under the annotation panel, in the same column, down to the bottom.
    expect(tree.x).toBe(inspector.x);
    expect(tree.width).toBe(inspector.width);
    expect(tree.height).toBeGreaterThanOrEqual(300);
    expect(Math.abs(inspector.y + inspector.height - tree.y)).toBeLessThanOrEqual(1);
    expect(inspector.y).toBe(text.y);
    expect(Math.abs(tree.y + tree.height - (text.y + text.height))).toBeLessThanOrEqual(1);
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

    // The focus is not held in the docked tree: Shift+Tab goes over its close
    // button and on into the annotation panel; the tree stays open.
    await treeItem(page, SEIZURE).click();
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    const back: string[] = [];
    for (let step = 0; step < 2; step += 1) {
      await page.keyboard.press("Shift+Tab");
      back.push(await focused(page));
    }
    expect(back[0]).toBe("BUTTON:Close tree");
    await expect(panel.locator(":focus")).toHaveCount(0);
    await expect(page.locator(".inspector-pane :focus")).toHaveCount(1);
    await expect(panel).toBeVisible();

    // Escape belongs to the tree only while the focus is in the tree widget.
    await treeItem(page, SEIZURE).click();
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    await panel.getByRole("button", { name: "Use this term" }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();

    // The text is still usable. A new annotation has no term yet, so there is
    // nothing for the tree to show: it makes room, and the search has the
    // whole column.
    const host = page.locator(".tree-host");
    const column = { x: inspector.x, y: inspector.y, width: inspector.width, height: text.height };
    await selectText(page, 0, 9);
    const search = page.getByLabel("Search term", { exact: true });
    await expect(search).toBeVisible();
    await expect(host).toBeHidden();
    await expect(host).toHaveCount(1);
    await expect(panel).toHaveCount(0);
    await expect(anyDialog(page)).toHaveCount(0);
    expectSameBox(await box(page.locator(".inspector-pane")), column);
    expectSameBox(await box(page.locator(".center-pane")), text);
    // Given up, the tree is back where it was, on the same walk.
    await page.locator(".inspector-pane").getByRole("button", { name: "Discard", exact: true }).click();
    await expect(panel).toBeVisible();
    expectSameBox(await box(host), tree);
    expectSameBox(await box(page.locator(".inspector-pane")), inspector);
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-current", "true");
    expect(opens).toEqual([]);

    // Started again and searched: the box and the candidates are on screen
    // without scrolling, not behind or squeezed above the tree.
    await selectText(page, 0, 9);
    await expect(host).toBeHidden();
    await search.fill("Hypotonia");
    await expect(search).toBeInViewport({ ratio: 1 });
    const candidate = page.locator(".candidate-card").filter({ hasText: HYPOTONIA });
    await expect(candidate).toBeVisible();
    expect(await page.locator(".inspector-pane").evaluate((pane) => pane.scrollTop)).toBe(0);
    await expect(candidate).toBeInViewport({ ratio: 1 });
    const cards = page.locator(".candidate-card");
    const shown = await cards.count();
    for (let index = 0; index < Math.min(shown, 4); index += 1) {
      await expect(cards.nth(index)).toBeInViewport({ ratio: 1 });
    }
    // All of them fit where the docked tree would have left room for none.
    const lastCard = await box(cards.nth(Math.min(shown, 4) - 1));
    expect(lastCard.y + lastCard.height).toBeGreaterThan(tree.y);
    expectSameBox(await box(page.locator(".inspector-pane")), column);
    await cards.last().scrollIntoViewIfNeeded();
    await expect(cards.last()).toBeInViewport({ ratio: 1 });
    expect(opens).toEqual([]);

    // The term is chosen: the tree is back in its place and goes to the new
    // annotation's term with a walk of its own, without taking the focus.
    await candidate.click();
    await expect(revision(page)).toHaveAttribute("title", "Revision 3");
    await expect(ownAnnotations(page)).toHaveCount(2);
    await expect(panel).toBeVisible();
    expectSameBox(await box(host), tree);
    expectSameBox(await box(page.locator(".inspector-pane")), inspector);
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
    await expect(host).toHaveCount(0);
    await expect(page.locator(".app-layout")).not.toHaveClass(/tree-open/);
    await expect(page.locator(".sidebar .doc-item.selected")).toHaveCount(1);
    await expect(revision(page)).toHaveAttribute("title", "Revision 3");
    // It stays closed: selecting another annotation does not bring it back.
    await ownAnnotations(page).filter({ hasText: HYPOTONIA }).click();
    await expect(page.locator(".inspector-pane h2")).toContainText(HYPOTONIA);
    await page.waitForTimeout(200);
    await expect(panel).toHaveCount(0);
    expect(opens).toEqual([HYPOTONIA, STATUS_EPILEPTICUS]);
    // All along, nothing was stored about the tree.
    expect(stored).toEqual([]);
  });

  test("in the three-column layout the tree is under the annotation panel at every width, never beside it", async ({ page }) => {
    // A long display name: the case header's identity badge must not take another line.
    const user = await page.request.post(
      `/__test_user__?username=tree-wide&pseudonym=tree-wide&display_name=${encodeURIComponent("Maximiliane Schmidt-Rottluff")}`,
    );
    expect(user.ok()).toBeTruthy();
    await openWithSeizure(page, "tree-wide");
    await expect(page.getByTestId("annotator-name")).toHaveText("Maximiliane Schmidt-Rottluff");
    const sizes = [
      // 1060 px is the narrowest window with three columns: the text keeps its
      // 420 px beside the findings column and the 380 px inspector (below that the
      // inspector stacks under the text). The header already needs a second line
      // there, which the 20 px of extra height make up for.
      { width: 1060, height: 720 },
      { width: 1100, height: 700 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1599, height: 900 },
      { width: 1600, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ];
    const heights: string[] = [];
    for (const size of sizes) {
      await test.step(`${size.width}x${size.height}`, async () => {
        await page.setViewportSize(size);
        await expect(treePanel(page)).toHaveCount(0);
        const sidebarBefore = await box(page.locator(".app-layout > .sidebar"));
        const textBefore = await box(page.locator(".center-pane"));
        const inspectorBefore = await box(page.locator(".inspector-pane"));

        await showInTree(page).click();
        const panel = treePanel(page);
        await expect(panel).toBeVisible();
        await expect(treeItem(page, SEIZURE)).toBeFocused();

        const sidebar = await box(page.locator(".app-layout > .sidebar"));
        const text = await box(page.locator(".center-pane"));
        const inspector = await box(page.locator(".inspector-pane"));
        const tree = await box(page.locator(".tree-host"));
        // Three columns as without the tree: list and case text are untouched.
        expectSameBox(sidebar, sidebarBefore);
        expectSameBox(text, textBefore);
        expect(inspector.x).toBe(inspectorBefore.x);
        expect(inspector.y).toBe(inspectorBefore.y);
        expect(inspector.width).toBe(inspectorBefore.width);
        expect(Math.abs(inspector.x + inspector.width - size.width)).toBeLessThanOrEqual(1);
        // The right-hand column is split: annotation panel above, tree below, nothing left over.
        expect(tree.x).toBe(inspector.x);
        expect(tree.width).toBe(inspector.width);
        expect(Math.abs(inspector.y + inspector.height - tree.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(inspector.height + tree.height - inspectorBefore.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(tree.y + tree.height - (text.y + text.height))).toBeLessThanOrEqual(1);
        // Both parts are usable: the annotation panel has at least 40 % of the column,
        // the tree at least as much as the panel, and 400 px or 60 % of a low column.
        const columnHeight = inspectorBefore.height;
        // Header/action rows may wrap. Bound absolute floors by the actual
        // available column; the 40/60 proportions stay enforced independently.
        const lowFloor = [Math.min(250, columnHeight * 0.4) - 1, Math.min(370, columnHeight * 0.6) - 1];
        expect(inspector.height).toBeGreaterThanOrEqual(lowFloor[0]);
        expect(inspector.height).toBeGreaterThanOrEqual(columnHeight * 0.4 - 1);
        expect(tree.height).toBeGreaterThanOrEqual(Math.min(400, columnHeight * 0.6) - 1);
        expect(tree.height).toBeGreaterThanOrEqual(lowFloor[1]);
        expect(tree.height).toBeGreaterThanOrEqual(inspector.height - 1);
        // Neither is short while the other has room to spare. An annotation panel that
        // has to scroll has given the tree no more than its due (half, or 400 px on a low
        // screen); one that shows everything is no higher than its content needs, beyond
        // its 40 %.
        const content = await page.locator(".inspector-pane").evaluate((pane) => pane.scrollHeight);
        if (content > inspector.height + 1) {
          expect(tree.height).toBeLessThanOrEqual(Math.max(columnHeight / 2, 400) + 1);
        } else {
          expect(inspector.height).toBeLessThanOrEqual(Math.max(content, columnHeight * 0.4) + 1);
        }
        heights.push(`${size.width}x${size.height}: ${Math.round(inspector.height)}/${Math.round(tree.height)}`);
        await expect(showInTree(page)).toBeInViewport({ ratio: 1 });
        await expect(panel.getByRole("button", { name: "Use this term" })).toBeInViewport({ ratio: 1 });
        await expect(treeItem(page, SEIZURE)).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBeTruthy();

        await panel.getByRole("button", { name: "Close tree" }).click();
        await expect(panel).toHaveCount(0);
      });
    }
    // Keep measured geometry as evidence; the structural, proportional and
    // reachable-control assertions above define the contract at every size.
    await test.info().attach("tree-column-heights", { body: heights.join("\n"), contentType: "text/plain" });
  });

  test("the tree is not a setting: after a reload it is closed until it is asked for, and docked again", async ({ page }) => {
    await openWithSeizure(page, "tree-reload");
    const stored = preferenceWrites(page);

    await showInTree(page).click();
    await expect(treePanel(page)).toBeVisible();
    await treeItem(page, STATUS_EPILEPTICUS).click();
    await treePanel(page).getByRole("button", { name: "Close tree" }).click();
    await expect(treePanel(page)).toHaveCount(0);
    await showInTree(page).click();
    await expect(treePanel(page)).toBeVisible();
    await expect(anyDialog(page)).toHaveCount(0);
    // Closing changed nothing: it is the same docked tree, at the annotation's term again.
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-selected", "true");
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    expect(stored).toEqual([]);

    // A reload ends the page session. Choose this spec's project explicitly:
    // the fixture user may belong to more than one project.
    await page.goto("/#/?project=browser-fixture-tree");
    await expect(page.locator("#project-select")).toHaveValue("browser-fixture-tree");
    await page.reload();
    await expect(page.locator("#project-select")).toHaveValue("browser-fixture-tree");
    // The session cookie survives the reload: still logged in, no login form.
    await expect(page.getByTestId("current-user")).toBeVisible();
    await openCase(page, { task: "annotate" });
    await expect(revision(page)).toHaveAttribute("title", "Revision 1");
    // Nothing is open until it is asked for.
    await expect(treePanel(page)).toHaveCount(0);
    await ownAnnotations(page).first().click();
    await expect(page.locator(".inspector-pane h2")).toContainText(SEIZURE);
    await page.waitForTimeout(200);
    await expect(treePanel(page)).toHaveCount(0);

    await showInTree(page).click();
    await expect(treePanel(page)).toBeVisible();
    await expect(anyDialog(page)).toHaveCount(0);
    await expect(page.locator(".app-layout")).toHaveClass(/tree-open/);
    await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    // The preferences the app does store (who annotates, in which mode) say nothing about the tree.
    const names = stored.flatMap((change) => Object.keys(change as object));
    expect(names.filter((name) => name.includes("tree"))).toEqual([]);
  });

  for (const size of [
    // 1025-1059 px: the editor's own width (container query), not the viewport breakpoint, stacks it.
    { width: 1059, height: 700 },
    { width: 1024, height: 700 },
    { width: 1000, height: 700 },
    { width: 800, height: 700 },
  ]) {
    test(`two columns at ${size.width}x${size.height}: the tree is docked in the strip under the text, next to the annotation panel`, async ({ page }) => {
      await openWithSeizure(page, `tree-strip-${size.width}`, size);
      const sidebarBefore = await box(page.locator(".app-layout > .sidebar"));
      const textBefore = await box(page.locator(".center-pane"));
      const inspectorBefore = await box(page.locator(".inspector-pane"));
      // The layout this window has without the tree: the annotation panel under the text.
      expect(inspectorBefore.x).toBe(textBefore.x);
      expect(Math.abs(textBefore.y + textBefore.height - inspectorBefore.y)).toBeLessThanOrEqual(1);

      await showInTree(page).click();
      const panel = treePanel(page);
      await expect(panel).toBeVisible();
      await expect(anyDialog(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Keep open" })).toHaveCount(0);
      await expect(treeItem(page, SEIZURE)).toBeFocused();
      await expect(treeItem(page, SEIZURE)).toBeInViewport({ ratio: 1 });

      const sidebar = await box(page.locator(".app-layout > .sidebar"));
      const text = await box(page.locator(".center-pane"));
      const inspector = await box(page.locator(".inspector-pane"));
      const tree = await box(page.locator(".tree-host"));
      // The list is untouched; the text keeps its place and width and gives up some height.
      expectSameBox(sidebar, sidebarBefore);
      expect(text.x).toBe(textBefore.x);
      expect(text.y).toBe(textBefore.y);
      expect(text.width).toBe(textBefore.width);
      expect(text.height).toBeGreaterThanOrEqual(200);
      // Under the text one strip, shared half and half: annotation panel, then the tree.
      expect(inspector.x).toBe(text.x);
      expect(Math.abs(text.y + text.height - inspector.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(inspector.x + inspector.width - tree.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(tree.y - inspector.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(tree.height - inspector.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(tree.width - inspector.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(tree.x + tree.width - size.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(tree.y + tree.height - size.height)).toBeLessThanOrEqual(1);
      // Usable: the strip is higher than without the tree, each half is wide enough
      // for its content, the rows and the details have room.
      expect(tree.height).toBeGreaterThanOrEqual(300);
      expect(tree.height).toBeGreaterThan(inspectorBefore.height);
      expect(tree.width).toBeGreaterThanOrEqual(280);
      const rows = await box(panel.locator(".tree-browser__tree"));
      const details = await box(panel.locator(".tree-detail__body"));
      // Metadata can wrap; keep room for at least four single-line rows.
      const rowHeight = (await box(treeItem(page, "HP:0000001"))).height;
      expect(rows.height).toBeGreaterThanOrEqual(4 * rowHeight);
      expect(details.height).toBeGreaterThanOrEqual(60);
      await expect(panel.getByRole("button", { name: "Use this term" })).toBeInViewport({ ratio: 1 });
      await expect(panel.getByRole("button", { name: "Close tree" })).toBeInViewport({ ratio: 1 });
      await expect(showInTree(page)).toBeInViewport({ ratio: 1 });
      await expect(page.locator(".inspector-pane h2")).toBeInViewport({ ratio: 1 });
      await expect(page.locator(".text-container .run--marked").filter({ hasText: "seizure" })).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBeTruthy();

      // It works as everywhere: pick a child and use it; the tree stays open.
      await treeItem(page, STATUS_EPILEPTICUS).click();
      await expect(treeItem(page, STATUS_EPILEPTICUS)).toBeInViewport({ ratio: 1 });
      await panel.getByRole("button", { name: "Use this term" }).click();
      await expect(revision(page)).toHaveAttribute("title", "Revision 2");
      await expect(panel).toBeVisible();
      await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-current", "true");
      await expect(page.locator(".inspector-pane h2")).toContainText(STATUS_EPILEPTICUS);

      // A new annotation: the tree steps aside and the search has the strip, as it is without the tree.
      await selectText(page, 0, 9);
      await expect(page.getByLabel("Search term", { exact: true })).toBeVisible();
      await expect(page.locator(".tree-host")).toBeHidden();
      expectSameBox(await box(page.locator(".inspector-pane")), inspectorBefore);
      expectSameBox(await box(page.locator(".center-pane")), textBefore);
      await page.locator(".inspector-pane").getByRole("button", { name: "Discard", exact: true }).click();
      await expect(panel).toBeVisible();
      expectSameBox(await box(page.locator(".tree-host")), tree);

      // Closed from inside the tree, the layout is what it was.
      await treeItem(page, STATUS_EPILEPTICUS).click();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      expectSameBox(await box(page.locator(".inspector-pane")), inspectorBefore);
      expectSameBox(await box(page.locator(".center-pane")), textBefore);
    });
  }

  test("one pane at a time at 600x800: the tree is under the annotation panel in 'Details'", async ({ page }) => {
    await openWithSeizure(page, "tree-phone", { width: 600, height: 800 });
    const tabs = page.getByRole("navigation", { name: "Select view" });
    await tabs.getByRole("button", { name: "Details" }).click();
    await expect(page.locator(".inspector-pane h2")).toContainText(SEIZURE);
    const inspectorBefore = await box(page.locator(".inspector-pane"));
    const opens: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/terms/tree/open")) opens.push(String(request.postDataJSON()?.term_id));
    });

    await showInTree(page).click();
    const panel = treePanel(page);
    await expect(panel).toBeVisible();
    await expect(anyDialog(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Keep open" })).toHaveCount(0);
    await expect(treeItem(page, SEIZURE)).toBeFocused();
    await expect(treeItem(page, SEIZURE)).toBeInViewport({ ratio: 1 });

    // The pane is split: annotation panel above, tree below with the larger share, full width.
    const inspector = await box(page.locator(".inspector-pane"));
    const tree = await box(page.locator(".tree-host"));
    expect(inspector.x).toBe(0);
    expect(inspector.width).toBe(600);
    expect(inspector.y).toBe(inspectorBefore.y);
    expect(tree.x).toBe(0);
    expect(tree.width).toBe(600);
    expect(Math.abs(inspector.y + inspector.height - tree.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(inspector.height + tree.height - inspectorBefore.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(tree.y + tree.height - 800)).toBeLessThanOrEqual(1);
    // Wrapping shell/actions reduce the available pane; keep its 40/60 split.
    expect(inspector.height).toBeGreaterThanOrEqual(inspectorBefore.height * 0.4 - 1);
    expect(tree.height).toBeGreaterThanOrEqual(inspectorBefore.height * 0.6 - 1);
    expect(tree.height).toBeGreaterThan(inspector.height);
    const rows = await box(panel.locator(".tree-browser__tree"));
    const details = await box(panel.locator(".tree-detail__body"));
    const rowHeight = (await box(treeItem(page, SEIZURE))).height;
    expect(rows.height).toBeGreaterThanOrEqual(4 * rowHeight);
    expect(details.height).toBeGreaterThanOrEqual(60);
    await expect(panel.getByRole("button", { name: "Use this term" })).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole("button", { name: "Close tree" })).toBeInViewport({ ratio: 1 });
    await expect(showInTree(page)).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    // Narrow: header and toolbar scroll away; the workspace (pane tabs and pane) fills the viewport.
    await expectWorkspaceFillsViewport(page, { width: 600, height: 800 });

    // The other panes are whole panes: the tree belongs to "Details" and waits there.
    await treeItem(page, STATUS_EPILEPTICUS).click();
    await tabs.getByRole("button", { name: "Document" }).click();
    await expect(page.locator(".text-container")).toBeVisible();
    await expect(page.locator(".tree-host")).toBeHidden();
    await tabs.getByRole("button", { name: /^Findings/ }).click();
    await expect(ownAnnotations(page)).toBeVisible();
    await expect(page.locator(".tree-host")).toBeHidden();
    await tabs.getByRole("button", { name: "Details" }).click();
    await expect(panel).toBeVisible();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-selected", "true");
    expect(opens).toEqual([SEIZURE]);

    await panel.getByRole("button", { name: "Use this term" }).click();
    await expect(revision(page)).toHaveAttribute("title", "Revision 2");
    await expect(panel).toBeVisible();
    await expect(treeItem(page, STATUS_EPILEPTICUS)).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".inspector-pane h2")).toContainText(STATUS_EPILEPTICUS);

    await panel.getByRole("button", { name: "Close tree" }).click();
    await expect(panel).toHaveCount(0);
    await expect(showInTree(page)).toBeFocused();
    expectSameBox(await box(page.locator(".inspector-pane")), inspectorBefore);
  });

  test("one walk through every layout: resizing the window moves the docked tree, it never becomes a window", async ({ page }) => {
    await openWithSeizure(page, "tree-resize");
    await showInTree(page).click();
    const panel = treePanel(page);
    await expect(panel).toBeVisible();
    await treeItem(page, DIALEPTIC).click();
    const opens: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/terms/tree/open")) opens.push(String(request.postDataJSON()?.term_id));
    });

    for (const size of [
      { width: 1000, height: 700 },
      { width: 600, height: 800 },
      { width: 800, height: 700 },
      { width: 1280, height: 720 },
    ]) {
      await test.step(`${size.width}x${size.height}`, async () => {
        await page.setViewportSize(size);
        if (size.width <= 700) {
          await page.getByRole("navigation", { name: "Select view" }).getByRole("button", { name: "Details" }).click();
        }
        await expect(panel).toBeVisible();
        await expect(anyDialog(page)).toHaveCount(0);
        await expect(treeItem(page, SEIZURE)).toHaveAttribute("aria-current", "true");
        await expect(treeItem(page, DIALEPTIC)).toHaveAttribute("aria-selected", "true");
        const tree = await box(page.locator(".tree-host"));
        expect(tree.x).toBeGreaterThanOrEqual(0);
        expect(tree.x + tree.width).toBeLessThanOrEqual(size.width + 1);
        expect(tree.y + tree.height).toBeLessThanOrEqual(size.height + 1);
        const availableHeight = (await box(page.locator('.app-layout'))).height;
        expect(tree.height).toBeGreaterThanOrEqual(size.width <= 700 ? Math.min(300, availableHeight * 0.6) - 1 : 300);
        await expect(panel.getByRole("button", { name: "Use this term" })).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
        if (size.width <= 700) await expectWorkspaceFillsViewport(page, size);
        else expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBeTruthy();
      });
    }
    expect(opens).toEqual([]);
  });
});
