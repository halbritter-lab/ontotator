import { expect, type Page } from "@playwright/test";
import { TASKS_HOME, TEST_PASSWORD } from "./helpers";
import type { LeadPerson, LeadScenario } from "./leadWorkflowHelpers";

/** Scenarios of ``POST /__test_review_flow__`` (tests/browser_review_flow_scenarios.py). */
export type ReviewFlowScenarioName = "REVIEW_FLOW" | "ANNOTATION_LOOP";

/** REVIEW_FLOW: the two cases whose de translation reviews Ana owns, in task order. */
export type ReviewFlowCase = "failed-translation" | "second-translation";

/** ANNOTATION_LOOP: the three native texts (en, de, fr) the annotator owns. */
export type AnnotationLoopCase = "loop-en" | "loop-de" | "loop-fr";

/** What ``POST /__test_review_flow__`` returns: the lead scenario identities plus ids and texts. */
export interface ReviewFlowScenario extends Omit<LeadScenario, "case_ids"> {
  /** Assignment id by case (REVIEW_FLOW: Ana's translation reviews; ANNOTATION_LOOP: annotate tasks). */
  assignments: Record<string, number>;
  /**
   * Texts by name. REVIEW_FLOW: "source" (the en text of both cases) and each
   * case's de text; ANNOTATION_LOOP: each case's text.
   */
  texts: Record<string, string>;
}

/**
 * Build a fresh project for review flow scenario ``name`` through the
 * test-only route of the browser server and return its identities.
 */
export async function reviewFlowScenario(page: Page, name: ReviewFlowScenarioName): Promise<ReviewFlowScenario> {
  const response = await page.request.post("/__test_review_flow__", {
    params: { scenario: name },
    timeout: 120_000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as ReviewFlowScenario;
}

/**
 * Log in as scenario person ``name`` (username ``{project}-{name}``) through
 * the login form; the shell then shows the display name, so this does not use
 * ``loginExisting`` (which expects the username in the shell).
 */
export async function loginScenarioUser(page: Page, scenario: ReviewFlowScenario, name: LeadPerson): Promise<void> {
  await page.goto(TASKS_HOME);
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username", { exact: true }).fill(scenario.users[name]);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(scenario.display_names[name]);
}
