import { expect, test } from "@playwright/test";
import { selectText } from "../browser/helpers";

test("stack smoke: log in, open the project, annotate, submit", async ({ page }) => {
  await page.goto("/");
  const login = page.getByRole("form", { name: "Log in to Ontotator" });
  await login.getByLabel("Username").fill("smoke-annotator");
  // Synthetic DEVELOPMENT ONLY account, created by scripts/seed_stack.py.
  await login.getByLabel("Password").fill(process.env.STACK_SMOKE_PASSWORD ?? "development-only-smoke-password");
  await login.getByRole("button", { name: "Log in", exact: true }).click();
  const projects = page.locator("#project-select");
  await expect(projects.locator("option[value='smoke']")).toHaveText(/smoke/i);
  await projects.selectOption("smoke");
  const firstCase = page.getByTestId("task-row").filter({ has: page.getByRole("cell", { name: "Annotation", exact: true }) }).filter({ hasText: "smoke-001" });
  await expect(firstCase).toContainText("Open");
  await firstCase.getByRole("link", { name: "Start", exact: true }).click();
  await expect(page.locator(".text-container")).toContainText("Hypotonia and seizure");
  // Use the primary evidence workflow: Hypotonia occupies codepoints/UTF-16 offsets 0–9.
  await selectText(page, 0, 9);
  await page.getByLabel(/Search ontology term/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  await expect(page.locator('.sidebar [data-list-key^="annotation:"]')).toContainText("HP:0001252");
  await expect(page.locator(".text-container .run--marked").filter({ hasText: "Hypotonia" })).toHaveText("Hypotonia");
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");
  for (const [axis, value] of [["Assertion", "Present"], ["Experiencer", "Patient"], ["Temporality", "Current"]]) {
    const choice = page.getByRole("group", { name: new RegExp(`^${axis}`) }).getByRole("radio", { name: value, exact: true });
    await choice.click();
    await expect(choice).toBeChecked();
    await expect(page.locator(".status-badge")).toHaveClass(/status-saved/);
  }
  await page.getByRole("button", { name: /Finish & submit text/i }).click();
  const submit = page.getByRole("dialog", { name: "Submit text", exact: true });
  await submit.getByRole("button", { name: "Submit text", exact: true }).click();
  const completed = page.getByRole("dialog", { name: "Text submitted", exact: true });
  await expect(completed).toContainText("Case successfully submitted");
  await completed.getByRole("button", { name: "Back to my tasks" }).click();
  await expect(firstCase).toContainText("Submitted");
  await page.reload();
  await projects.selectOption("smoke");
  await expect(firstCase).toContainText("Submitted");
});
