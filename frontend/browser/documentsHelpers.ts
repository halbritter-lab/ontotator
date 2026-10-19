import { expect, type Page } from "@playwright/test";

/** A Documents row of a scenario: one text and language. */
export interface ScenarioRow {
  case_id: string;
  language: string;
}

/** What ``POST /__test_documents__`` returns (tests/browser_documents_scenarios.py). */
export interface DocumentsScenario {
  project: string;
  /** Usernames by role name; every scenario has ``lead``. */
  users: Record<string, string> & { lead: string };
  rows: ScenarioRow[];
  case_id?: string;
  documents?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Build a fresh project for Documents scenario ``name`` ("S0" to "S15") through
 * the test-only route of the browser server and return its identities.
 */
export async function documentsScenario(page: Page, name: string): Promise<DocumentsScenario> {
  const response = await page.request.post("/__test_documents__", {
    params: { scenario: name },
    timeout: 120_000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as DocumentsScenario;
}
