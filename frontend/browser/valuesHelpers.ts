import { expect, type Page } from "@playwright/test";
import type { ReviewFlowScenario } from "./reviewFlowHelpers";

/**
 * Scenarios of ``POST /__test_values__`` (tests/browser_values_scenarios.py).
 * VALUES_STANDARD: the standard clinical axes (assertion, experiencer,
 * temporality); VALUES_LONG: assertion plus ``certainty`` with long option
 * values. Both: one native ``en`` text (case "values") the annotator owns.
 */
export type ValuesScenarioName = "VALUES_STANDARD" | "VALUES_LONG";

/**
 * Build a fresh project for values scenario ``name`` through the test-only
 * route of the browser server and return its identities.
 */
export async function valuesScenario(page: Page, name: ValuesScenarioName): Promise<ReviewFlowScenario> {
  const response = await page.request.post("/__test_values__", {
    params: { scenario: name },
    timeout: 120_000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as ReviewFlowScenario;
}
