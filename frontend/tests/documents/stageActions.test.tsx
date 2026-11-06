/** Stage actions of the text card: a submitted annotation offers "Reopen…" with the Annotation stage (M1 open point). */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StageActions } from "../../src/documents/StageActions";
import type { TextVersionsTools } from "../../src/documents/TextVersions";
import { assignment, members } from "../assignmentFixtures";
import { row, version, work } from "./fixtures";

afterEach(cleanup);

const tools = (status: "submitted" | "in_progress"): TextVersionsTools => ({
  username: "lead", members, variants: new Map(), requiredLanguages: () => [], onAssignmentsChanged: vi.fn(), onShowTranslationReviews: vi.fn(),
  assignments: [{ ...assignment, id: 11, document_id: "z/doc", status }],
});

it("a submitted annotation gets Reopen… under Annotation, which opens the reopen dialog", () => {
  const text = row({ case_id: "z", language: "en", versions: [version({ document_id: "z/doc" })] });
  render(<StageActions row={text} stage="annotation" textVersionTools={tools("submitted")} />);
  fireEvent.click(screen.getByRole("button", { name: "Reopen…, Alice (A)" }));
  expect(screen.getByRole("dialog", { name: "Reopen z en" })).toBeTruthy();
  cleanup();
  render(<StageActions row={text} stage="review" textVersionTools={tools("submitted")} />);
  expect(screen.queryByRole("button", { name: /^Reopen/ })).toBeNull();
});

it("in the text card the person rows carry Reassign… and Reopen…: no second list of people (#108)", () => {
  const text = row({ case_id: "z", language: "en", versions: [version({ document_id: "z/doc" })], work: [work({ assignment_id: 11, document_id: "z/doc", status: "in_progress" })] });
  render(<StageActions row={text} stage="annotation" textVersionTools={tools("in_progress")} />);
  expect(screen.getByRole("button", { name: "Reassign…" })).toBeTruthy();
  cleanup();
  for (const status of ["submitted", "in_progress"] as const) {
    const { container } = render(<StageActions row={text} stage="annotation" textVersionTools={tools(status)} inCard />);
    expect(container.textContent).toBe("");
    cleanup();
  }
});

it("a submitted translation review of the newest version gets Reopen… under Translation (#340)", () => {
  const reviewTools: TextVersionsTools = { ...tools("submitted"), assignments: [{ ...assignment, id: 21, task: "translation_review", document_id: "z/de", status: "submitted" }] };
  const text = row({ case_id: "z", language: "de", versions: [version({ document_id: "z/de", translation_status: "reviewed", latest_review_decision: "rejected" })],
    work: [work({ assignment_id: 21, document_id: "z/de", task: "translation_review", status: "submitted" })] });
  render(<StageActions row={text} stage="review" textVersionTools={reviewTools} />);
  fireEvent.click(screen.getByRole("button", { name: "Reopen…, Alice (A)" }));
  expect(screen.getByRole("dialog", { name: "Reopen z de" })).toBeTruthy();
  cleanup();
  render(<StageActions row={text} stage="annotation" textVersionTools={reviewTools} />);
  expect(screen.queryByRole("button", { name: /^Reopen/ })).toBeNull();
  cleanup();
  // Not on an older version (a correction made v2) and never a lead correction.
  const older = { ...text, versions: [version({ document_id: "z/de", is_newest_in_chain: false }), version({ document_id: "z/de2", version: 2 })] };
  render(<StageActions row={older} stage="review" textVersionTools={reviewTools} />);
  expect(screen.queryByRole("button", { name: /^Reopen/ })).toBeNull();
  cleanup();
  const correction = { ...text, work: text.work.map(item => ({ ...item, lead_correction: true })) };
  render(<StageActions row={correction} stage="review" textVersionTools={reviewTools} />);
  expect(screen.queryByRole("button", { name: /^Reopen/ })).toBeNull();
});
