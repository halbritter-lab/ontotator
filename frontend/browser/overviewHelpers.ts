import { expect, type Locator, type Page } from "@playwright/test";
import { openTasksHome, TEST_PASSWORD } from "./helpers";

/** Scenarios of ``POST /__test_overview__`` (tests/browser_overview_scenarios.py). */
export type OverviewScenarioName =
  | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7a" | "S7b" | "S8"
  | "S9" | "S10" | "S11" | "S12" | "S13" | "S14" | "S15" | "S16"
  | "WALKTHROUGH";

/** The people of every overview scenario: Mia Kühn (lead), Ana Weber, Tom Reis, Luc Martin. */
export type OverviewPerson = "lead" | "ana" | "tom" | "luc";

/** A Documents row of a scenario: one text and language. */
export interface OverviewRow {
  case_id: string;
  language: string;
}

/** What ``POST /__test_overview__`` returns. */
export interface OverviewScenario {
  project: string;
  /** Usernames by person (``{project}-{person}``). */
  users: Record<OverviewPerson, string>;
  /** "Mia Kühn", "Ana Weber", "Tom Reis", "Luc Martin". */
  display_names: Record<OverviewPerson, string>;
  /** The rows of the Scenario table (WALKTHROUGH: the rows the import creates). */
  rows: OverviewRow[];
  /** Assignment ids by name ("ana", "tom", "ana_review", "luc_review", …). */
  assignments: Record<string, number>;
  /** S12-S14: the de document ids "v1" and "v2". */
  documents?: Record<string, string>;
  /** Submission ids by name ("ana", "final", "de_final", "fr_final", …). */
  submissions?: Record<string, string>;
  /** WALKTHROUGH: absolute bundle path for ``page.setInputFiles``. */
  bundle_path?: string;
  /** WALKTHROUGH: "case-201". */
  case_id?: string;
  /** S9: the open problem report. */
  report_id?: string;
  report_reason?: string;
}

/** Findings presets of ``submit_annotation`` / ``draft_annotation`` / ``resolve_carried_and_submit``. */
export type OverviewPreset = "tom_v1" | "luc_v1" | "tom_v2" | "luc_v2" | "three";

/** One step of another person (never the lead's clicks), ``POST /__test_overview_act__``. */
export interface OverviewActBody {
  project: string;
  actor: OverviewPerson;
  action:
    | "accept_review"
    | "correct_translation"
    | "submit_annotation"
    | "draft_annotation"
    | "resolve_carried_and_submit"
    | "submit_consolidation"
    | "report_problem"
    | "age_visit";
  /** Default "case-201". */
  case_id?: string;
  /** Default "de". */
  language?: string;
  preset?: OverviewPreset;
}

/** What the act route returns: the action and the ids it touched. */
export interface OverviewActResult {
  action: OverviewActBody["action"];
  assignment_id?: number;
  submission_id?: string;
  document_id?: string;
  report_id?: string;
  round_id?: string;
  resolved_inputs?: number;
  visits?: number;
}

/** Build a fresh project for overview scenario ``name`` and return its identities. */
export async function overviewScenario(page: Page, name: OverviewScenarioName): Promise<OverviewScenario> {
  const response = await page.request.post("/__test_overview__", { params: { scenario: name }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as OverviewScenario;
}

/** Perform one non-lead step through the real services (walkthrough steps 3, 5, 6, 9, 11). */
export async function overviewAct(page: Page, body: OverviewActBody): Promise<OverviewActResult> {
  const response = await page.request.post("/__test_overview_act__", { data: body, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as OverviewActResult;
}

/**
 * Log in as scenario person ``name`` through the login form, as
 * ``loginScenarioUser`` of reviewFlowHelpers.ts does (the shell shows the
 * display name, so ``loginExisting`` does not apply).
 */
export async function loginOverviewUser(page: Page, scenario: Pick<OverviewScenario, "users" | "display_names">, name: OverviewPerson): Promise<void> {
  await openTasksHome(page);
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username", { exact: true }).fill(scenario.users[name]);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(scenario.display_names[name]);
}

/**
 * Counts the lead's activations for the walkthrough's click totals: every
 * click through ``count`` increments ``total``.
 */
export class LeadClicks {
  total = 0;

  /** Click ``locator`` and count it as one lead activation. */
  async count(locator: Locator, options?: Parameters<Locator["click"]>[0]): Promise<void> {
    await locator.click(options);
    this.total += 1;
  }

  /** Assert the running total after a walkthrough step. */
  expectTotal(expected: number): void {
    expect(this.total, "lead clicks so far").toBe(expected);
  }
}
