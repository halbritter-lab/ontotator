import { expect, test } from "@playwright/test";

test("stack smoke: log in, open the project, annotate, submit", async ({ page }) => {
  await page.goto("/");
  const login = page.getByRole("form", { name: "Log in to Ontocurator" });
  await login.getByLabel("Username").fill("smoke-annotator");
  // Synthetic DEVELOPMENT ONLY account, created by scripts/seed_stack.py.
  await login.getByLabel("Password").fill(process.env.STACK_SMOKE_PASSWORD ?? "development-only-smoke-password");
  await login.getByRole("button", { name: "Log in", exact: true }).click();
  const projects = page.locator("#project-select");
  await expect(projects.locator("option[value='smoke']")).toHaveText(/smoke/i);
  await projects.selectOption("smoke");
  const firstCase = page.getByTestId("task-row").filter({ has: page.getByRole("cell", { name: "Annotate", exact: true }) }).filter({ hasText: "smoke-001" });
  await expect(firstCase).toContainText("Open");
  await firstCase.getByRole("link", { name: "Open", exact: true }).click();
  await expect(page.locator(".text-container")).toContainText("Hypotonia and seizure");
  await page.getByRole("button", { name: /\+ New Annotation/i }).click();
  await page.getByLabel(/Search ontology term/i).fill("Hypotonia");
  await page.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
  await expect(page.locator(".sidebar .doc-item")).toContainText("HP:0001252");
  await expect(page.locator(".status-badge")).toHaveAttribute("title", "Revision 1");
  await page.getByRole("button", { name: /Finish & Submit Case/i }).click();
  const submit = page.getByRole("dialog", { name: "Submit case", exact: true });
  await submit.getByLabel(/Entire text checked for further findings/i).check();
  await submit.getByRole("button", { name: "Submit case", exact: true }).click();
  const completed = page.getByRole("dialog", { name: "Case submitted", exact: true });
  await expect(completed).toContainText("Case successfully submitted");
  await completed.getByRole("button", { name: "Back to my tasks" }).click();
  await expect(firstCase).toContainText("Submitted");
  await page.reload();
  await projects.selectOption("smoke");
  await expect(firstCase).toContainText("Submitted");
});
