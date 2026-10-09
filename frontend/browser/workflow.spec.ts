import { expect, test, type Page } from "@playwright/test";
import { importPackage, LAUNCH_URL, mentionWithOffsets, openCase, selectText, submitCase } from "./helpers";

const importFixture = (page: Page, annotator: string) => importPackage(page, "", "browser-fixture", annotator);

test("first run: guide, import from the guide and required identity", async ({ page }) => {
  // Show the dashboard as a fresh installation sees it (no packages yet).
  await page.route("**/api/v1/packages", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.fallback(),
  );
  await page.goto(LAUNCH_URL);
  const guide = page.getByRole("region", { name: "Get started" });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Import work package (.zip)");
  await expect(guide).toContainText("Enter your initials");
  await expect(page.locator("#mode-select")).toHaveCount(0);
  await page.unroute("**/api/v1/packages");

  const fixture = await page.request.get("/__synthetic_fixture__");
  const chooser = page.waitForEvent("filechooser");
  await guide.getByRole("button", { name: "Import work package" }).click();
  await (await chooser).setFiles({ name: "synthetic.zip", mimeType: "application/zip", buffer: await fixture.body() });
  await expect(page.getByRole("status", { name: "Import result" })).toContainText("Package 'browser-fixture' imported");
  await expect(guide).toHaveCount(0);

  // An identity is required before a case can be opened ...
  const identity = page.getByLabel(/Your initials \/ ID/i);
  await identity.fill("");
  await identity.press("Enter");
  await expect(page.getByRole("button", { name: /^Open case$/i })).toBeDisabled();
  await expect(page.getByText("Required. Your annotations are saved under this name.")).toBeVisible();
  // ... and has to be confirmed once per page session.
  await identity.fill("first-run");
  await page.getByRole("button", { name: /^Open case$/i }).click();
  const dialog = page.getByRole("dialog", { name: "You are annotating as first-run" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Change initials" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(identity).toBeFocused();
  await openCase(page, { identity: "first-run" });
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 0");
});

test("provisioning: a changed package in the packages folder is reported on the dashboard", async ({ page }) => {
  await page.goto(LAUNCH_URL);
  const warning = page.getByRole("alert", { name: "Delivery notice" });
  await expect(warning).toContainText(
    "Package 'provisioned-fixture' in the packages folder (provisioned.zip) differs from the already imported version. "
      + "The changed version was NOT imported. To ship changed content, use a new package ID.",
  );
  await expect(warning).toHaveClass(/notice-warning/);
  await warning.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(warning).toHaveCount(0);
});

test("real backend: review, resume, reload, submit and authenticated export", async ({ page }) => {
  await importFixture(page, "browser-reviewer");
  await page.locator("#mode-select").selectOption("review");
  await openCase(page, { identity: "browser-reviewer" });
  await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (2)" })).toBeVisible();
  await page.locator(".doc-item").filter({ hasText: "HP:0001252" }).click();
  await expect(page.getByLabel(/Proposal details/i)).toContainText("present");
  await expect(page.getByLabel(/Proposal details/i)).toContainText("Hypotonia");
  await page.getByRole("button", { name: /Confirm/i }).first().click();
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");

  // Back on the dashboard the case is in progress; reopening resumes it without asking again.
  await page.getByRole("button", { name: "← Dashboard" }).click();
  await expect(page.getByText("Continue where you left off")).toBeVisible();
  await openCase(page);
  await expect(page.locator(".sidebar-header").filter({ hasText: "Review Proposals (2)" })).toBeVisible();
  await expect(page.locator(".doc-item").filter({ hasText: "HP:0001252" })).toContainText(/confirmed/i);
  await page.locator(".doc-item").filter({ hasText: "HP:0001250" }).click();
  await page.getByRole("button", { name: /Confirm/i }).first().click();
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 2");
  await submitCase(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download export/i }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await page.reload();
  await page.locator("#package-select").selectOption("browser-fixture");
  await expect(page.locator("#package-select")).toHaveValue("browser-fixture");
  await expect(page.getByText(/Forbidden|Unauthorized|Error loading/)).toHaveCount(0);
});

test("real backend: invalid input does not block correction", async ({ page }) => {
  await importFixture(page, "browser-independent");
  await page.locator("#mode-select").selectOption("independent");
  await openCase(page, { identity: "browser-independent" });
  await expect(page.getByText(/Review Proposals/i)).toHaveCount(0);
  await page.getByRole("button", { name: /\+ New Annotation/i }).click();
  await page.getByLabel(/Search ontology term/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  // Selected candidate creates annotation
  await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
  await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001252");
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");
});

test("real backend: repeated and discontinuous evidence preserves Unicode offsets", async ({ page }) => {
  await importFixture(page, "browser-spans");
  await page.locator("#mode-select").selectOption("independent");
  await openCase(page, { identity: "browser-spans" });
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");
  await page.getByRole("button", { name: "+ Segment", exact: true }).click();
  await selectText(page, 14, 21);
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 2");
  await expect(mentionWithOffsets(page, "[0:9], [14:21]")).toHaveText("“Hypotonia … seizure”");
  await page.getByRole("button", { name: /\+ Add Mention/i }).click();
  await selectText(page, 23, 27); // UTF-16: emoji plus e and combining acute.
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 3");
  // Stored offsets count code points: [23:26] covers "😀", "e" and the combining accent.
  await expect(mentionWithOffsets(page, "[23:26]")).toBeVisible();
  await expect(page.locator(".sidebar .doc-item")).toHaveCount(1);
});
