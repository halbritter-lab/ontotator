import { expect, test } from "@playwright/test";
import type { TaskSummary } from "../src/api/client";
import { loginAs } from "./helpers";

// Issue 273: a crash outside the editor shows an error screen in the shell, not a blank page.
test("a crash on My tasks shows a way back, a reload and the technical report", async ({ page }) => {
  // A row My tasks cannot render (as found during the acceptance of #263); no project is needed.
  const bad: TaskSummary = { assignment_id: -1, workflow_revision: 0, held: false, report_answered: false,
    waiting_for_translation_review: false, waiting_for_lead: false, project_key: "crash", project_name: "Crash",
    document_id: "doc", language: "en", task: "annotate", status: "open", updated_at: "2026-11-01T12:00:00Z" };
  await page.route("**/api/v1/me/tasks", route => route.fulfill({ json: [bad] }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await loginAs(page, "screen-crash");

  const alert = page.getByRole("alert").filter({ hasText: "Something went wrong while displaying this page." });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Assignment ID must be a positive safe integer");
  await expect(alert.getByRole("button", { name: "Reload page" })).toBeVisible();
  // The shell stays: the user is still shown as logged in.
  await expect(page.getByTestId("current-user")).toBeVisible();

  await alert.getByRole("button", { name: "Report a technical problem…" }).click();
  const dialog = page.getByRole("dialog", { name: "Report a technical problem" });
  await dialog.getByText("Added automatically").click();
  await expect(dialog).toContainText("Error message: RangeError: Assignment ID must be a positive safe integer");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Another screen renders again.
  await page.evaluate(() => { window.location.hash = "#/me"; });
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
  await expect(alert).toHaveCount(0);

  // Once the data is fine, My tasks renders again.
  await page.unroute("**/api/v1/me/tasks");
  await page.evaluate(() => { window.location.hash = "#/?status=all"; });
  await expect(page.getByRole("heading", { name: "My tasks", level: 1 })).toBeVisible();
  expect(errors.every(message => !message.includes("Minified React error"))).toBe(true);
});
