import { expect, type Locator, type Page } from "@playwright/test";
import { openTasksHome, TEST_PASSWORD } from "./helpers";

/** Scenarios of ``POST /__test_proposal_check__`` (tests/browser_proposal_check_scenarios.py). */
export type ProposalCheckScenarioName = "FRESH" | "ONE_ASSIGNED" | "CHECKED" | "CONSOLIDATING";

/** The people of every proposal-check scenario: the lead, Tom Reis, Mia Berg, Ali Kaya (annotators). */
export type ProposalCheckPerson = "lead" | "tom" | "mia" | "ali";

/** What ``POST /__test_proposal_check__`` returns. */
export interface ProposalCheckScenario {
  project: string;
  /** Usernames by person (``{project}-{person}``). */
  users: Record<ProposalCheckPerson, string>;
  display_names: Record<ProposalCheckPerson, string>;
  /** Document ids of the en texts: "EN100024", "EN100017" (no proposals), "EN100031" (plan override scratch). */
  cases: Record<string, string>;
  /** Annotate assignment ids by person ("tom", "mia"). */
  assignments: Record<string, number>;
  /** Proposal-check submission ids by person (CHECKED, CONSOLIDATING). */
  submissions: Record<string, string>;
  /** CONSOLIDATING: the lead's consolidation round. */
  round_id?: string;
  consolidation_assignment_id?: number;
}

/** Build a fresh project for proposal-check scenario ``name`` and return its identities. */
export async function proposalCheckScenario(page: Page, name: ProposalCheckScenarioName): Promise<ProposalCheckScenario> {
  const response = await page.request.post("/__test_proposal_check__", { params: { scenario: name }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as ProposalCheckScenario;
}

/** Log in as scenario person ``name`` through the login form (as ``loginOverviewUser``). */
export async function loginScenarioUser(page: Page, scenario: Pick<ProposalCheckScenario, "users" | "display_names">, name: ProposalCheckPerson): Promise<void> {
  await openTasksHome(page);
  const form = page.getByRole("form", { name: "Log in to Ontocurator" });
  await form.getByLabel("Username", { exact: true }).fill(scenario.users[name]);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toContainText(scenario.display_names[name]);
}

/** The text card dialog of one text. */
export function textCard(page: Page, caseId: string, language: string): Locator {
  return page.getByRole("dialog", { name: `${caseId} ${language}` });
}

/** The stage path of a text card. */
export function cardPath(card: Locator): Locator {
  return card.getByRole("navigation", { name: "Text path" });
}
