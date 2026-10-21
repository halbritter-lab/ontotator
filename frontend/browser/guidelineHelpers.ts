import { expect, type Page } from "@playwright/test";
import type { LeadScenario } from "./leadWorkflowHelpers";
import { loginScenarioUser } from "./reviewFlowHelpers";

/** Scenarios of ``POST /__test_guidelines__`` (tests/browser_guideline_scenarios.py). */
export type GuidelineScenarioName = "EMPTY" | "PUBLISHED";

/** The people of a guideline scenario (no "annotator"). */
export type GuidelinePerson = "lead" | "ana" | "ben";

/** Ana's two en annotate tasks and Ben's de translation review. */
export type GuidelineAssignment = "annotate-1" | "annotate-2" | "review-de";

/**
 * Guideline files in a temp directory: ``v1.md`` (headings, table, a raw
 * ``<script>``, a ``javascript:`` link, an image), ``v2.md`` (other text),
 * ``big.txt`` (over 256 KiB) and ``bad.pdf``.
 */
export type GuidelineFile = "v1.md" | "v2.md" | "big.txt" | "bad.pdf";

/**
 * What ``POST /__test_guidelines__`` returns: the lead scenario identities
 * (project ``guide-{scenario}-{uuid8}``) plus assignment ids and file paths.
 * PUBLISHED: v1 published by the lead with the change note "First version".
 */
export interface GuidelineScenario extends Omit<LeadScenario, "case_ids"> {
  assignments: Record<GuidelineAssignment, number>;
  /** Absolute paths for ``page.setInputFiles``. */
  files: Record<GuidelineFile, string>;
}

/**
 * Build a fresh project for guideline scenario ``name`` through the
 * test-only route of the browser server and return its identities.
 */
export async function guidelineScenario(
  page: Page,
  name: GuidelineScenarioName,
): Promise<GuidelineScenario> {
  const response = await page.request.post("/__test_guidelines__", {
    params: { scenario: name },
    timeout: 120_000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as GuidelineScenario;
}

/** Log in as scenario person ``name`` through the login form (``loginScenarioUser``). */
export async function loginGuidelineUser(
  page: Page,
  scenario: GuidelineScenario,
  name: GuidelinePerson,
): Promise<void> {
  await loginScenarioUser(page, { ...scenario, texts: {} }, name);
}
