import { expect, type Page } from "@playwright/test";

/** Scenarios of ``POST /__test_lead_workflow__`` (tests/browser_lead_workflow_scenarios.py). */
export type LeadScenarioName =
  | "D15"
  | "DEFAULT_IMPORT"
  | "ANNOTATION_BATCH"
  | "FR_OFF"
  | "ACCEPTANCE"
  | "ROWS"
  | "REJECTED_TRANSLATION_FOR_LEAD"
  | "UPLOAD_DIALOG";

/** The people of every lead workflow scenario. */
export type LeadPerson = "lead" | "ana" | "ben" | "annotator";

/** A Documents row of a scenario: one text and language. */
export interface LeadScenarioRow {
  case_id: string;
  language: string;
}

/** What ``POST /__test_lead_workflow__`` returns. */
export interface LeadScenario {
  project: string;
  /** Usernames by person. */
  users: Record<LeadPerson, string>;
  /** "Project Lead", "Ana Weber", "Ben Roth", "Cy Annotator". */
  display_names: Record<LeadPerson, string>;
  /** Pseudonyms ("ann-…") by person. */
  pseudonyms: Record<LeadPerson, string>;
  /** Absolute bundle path for ``page.setInputFiles`` (D15, DEFAULT_IMPORT). */
  bundle_path?: string;
  case_ids: { de?: string[]; fr?: string[] };
  rows: LeadScenarioRow[];
  /** ANNOTATION_BATCH: de cases with an accepted review; the others are in review. */
  accepted?: string[];
  in_review?: string[];
  /** FR_OFF: open translation reviews by person, and the case with a fr final. */
  open_reviews?: Partial<Record<LeadPerson, string>>;
  final_case?: string;
  final_submission_id?: string;
  /** ACCEPTANCE: fr cases marked as reviewed in the package, and the others. */
  marked?: string[];
  not_marked?: string[];
  /**
   * ROWS: the case of each row action (de rows; "chip" and "acceptance" are fr rows).
   * REJECTED_TRANSLATION_FOR_LEAD: "rejected", "queried" and "to_assign" (de rows, Review and Annotate on).
   */
  cases?: Record<
    | "chip" | "acceptance" | "rejected" | "report" | "choose_final" | "review_changes" | "not_in_plan"
    | "queried" | "to_assign",
    string
  >;
  report_id?: string;
  report_reason?: string;
}

/**
 * Build a fresh project for lead workflow scenario ``name`` through the
 * test-only route of the browser server and return its identities.
 */
export async function leadScenario(page: Page, name: LeadScenarioName): Promise<LeadScenario> {
  const response = await page.request.post("/__test_lead_workflow__", {
    params: { scenario: name },
    timeout: 120_000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as LeadScenario;
}

/**
 * Paste ``ids`` (one per line) into "Paste case IDs" of the open
 * "Select by case IDs…" dialog and wait for the live count. Pasting is not a
 * click; the caller activates "Select {n}".
 */
export async function pasteCaseIds(page: Page, ids: readonly string[]): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Paste case IDs").fill(ids.join("\n"));
  await expect(dialog.getByText(`${new Set(ids).size} found`)).toBeVisible();
}
