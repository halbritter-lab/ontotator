/** Stage actions of the text card: a submitted annotation offers "Reopen…" with the Annotation stage (M1 open point). */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StageActions } from "../../src/documents/StageActions";
import type { TextVersionsTools } from "../../src/documents/TextVersions";
import { assignment, members } from "../assignmentFixtures";
import { row, version } from "./fixtures";

afterEach(cleanup);

const tools = (status: "submitted" | "in_progress"): TextVersionsTools => ({
  username: "lead", members, variants: new Map(), requiredLanguages: () => [], onAssignmentsChanged: vi.fn(), onShowTranslationReviews: vi.fn(),
  assignments: [{ ...assignment, id: 11, document_id: "z/doc", status }],
});

it("a submitted annotation gets Reopen… under Annotation, which opens the reopen dialog", () => {
  const text = row({ case_id: "z", language: "en", versions: [version({ document_id: "z/doc" })] });
  render(<StageActions row={text} stage="annotation" textVersionTools={tools("submitted")} />);
  fireEvent.click(screen.getByRole("button", { name: "Reopen…, Alice (A)" }));
  expect(screen.getByRole("dialog", { name: "Reopen z/doc" })).toBeTruthy();
  cleanup();
  render(<StageActions row={text} stage="review" textVersionTools={tools("submitted")} />);
  expect(screen.queryByRole("button", { name: /^Reopen/ })).toBeNull();
});
