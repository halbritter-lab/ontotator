import { expect, type Page } from "@playwright/test";

/** Scenario names of ``POST /__test_problem_reports__`` (tests/browser_problem_report_scenarios.py). */
export type ProblemReportScenarioName = "base" | "final" | "translation";

/** The people of a scenario: lead, the reporter (text A de), same text (A en), other text (B de). */
export type ProblemReportRole = "lead" | "reporter" | "same_text" | "other_text";

/** What ``POST /__test_problem_reports__`` returns. */
export interface ProblemReportScenario {
  project: string;
  /** Usernames (password: the browser test password); ``final`` adds ``earlier``, the accepted translation ``translator``. */
  users: Record<ProblemReportRole, string> & Record<string, string>;
  /** Person labels (pseudonyms) as the UI shows them; assert against these, never hard-coded "ann-0004". */
  labels: Record<ProblemReportRole, string> & Record<string, string>;
  case_ids: { a: string; b: string };
  documents: { a_en: string; a_de: string; b_de: string };
  /** Assignment ids; in ``translation`` the reporter's task is a translation review. */
  tasks: { reporter: number; same_text: number; other_text: number };
  /** ``final`` only: the selected final result of the reporter's row. */
  final?: { submission_id: string; label_parts: string[] };
  /** ``translation`` only: the saved review draft of the reporter's task. */
  translation?: { assignment_id: number; draft_text: string; form: Record<string, unknown> };
}

/** Build a fresh project for problem report scenario ``name`` and return its identities. */
export async function problemReportScenario(page: Page, name: ProblemReportScenarioName): Promise<ProblemReportScenario> {
  const response = await page.request.post("/__test_problem_reports__", {
    params: { scenario: name },
    timeout: 120_000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as ProblemReportScenario;
}
