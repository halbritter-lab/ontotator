import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { CaseScreen } from "../src/app/CaseScreen";
import { historical } from "./variantFixtures";
import { RoundInputPanel } from "../src/tasks/RoundInputPanel";
import { workspaceFixture } from "./assignments";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("blocks carry-forward submission until every input is reviewed and completes the latest saved finding", async () => {
  const view = workspaceFixture().view;
  view.key.round_id = "round-exact"; view.draft.key = view.key; view.require_spanless_note = false;
  const original = structuredClone(historical.annotations[0]);
  const copy = structuredClone(original); copy.annotation.annotation_id = "carried-copy"; copy.version = "before-note";
  view.draft.annotations = [copy];
  const input = { input_id: "input-exact", source_submission_id: "source-exact", source_ref: { annotation_id: original.annotation.annotation_id, version: original.version }, source_snapshot: original, target_snapshot: copy, mapping_status: "carried" as const };
  const noted = structuredClone(view.draft); noted.revision = 1;
  noted.annotations![0].version = "after-note"; noted.annotations![0].annotation.note = "Evidence checked on this text";
  vi.spyOn(api, "resolveTermLabels").mockResolvedValue([]);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
  vi.spyOn(api, "applyCommand").mockResolvedValue(noted);
  const complete = vi.spyOn(api, "resolveRoundInput").mockImplementation(async (_id, envelope) => ({ ...noted, revision: 2, round_input_resolutions: [envelope.payload as any] }));
  const submit = vi.spyOn(api, "submitWorkspace");
  render(<CaseScreen view={view} workspaceId="round-workspace" roundKind="carry_forward" roundInputs={[input]} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/ }));
  const dialog = await screen.findByRole("dialog", { name: "Submit case" });
  expect(dialog.textContent).toContain("1 carried finding(s) still need review");
  fireEvent.click(screen.getByRole("button", { name: "Review carried findings" }));
  fireEvent.click(screen.getByRole("button", { name: "Open saved finding" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Annotation note" }), { target: { value: "Evidence checked on this text" } });
  fireEvent.click(screen.getByRole("button", { name: "Complete carried finding review" }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith("round-workspace", expect.objectContaining({ expected_revision: 1, payload: { input_id: "input-exact", outcome: "completed", annotation_ref: { annotation_id: "carried-copy", version: "after-note" } } })));
  expect(submit).not.toHaveBeenCalled();
  await screen.findByText("0 pending · 1 completed");
});

function carriedInput() {
  const original = structuredClone(historical.annotations[0]);
  const target = structuredClone(original); target.annotation.annotation_id = "carried"; target.version = "current-version";
  return { input_id: "input", source_submission_id: "exact-submission", source_ref: { annotation_id: original.annotation.annotation_id, version: original.version }, source_snapshot: original, target_snapshot: target, mapping_status: "carried" as const };
}
it("returns edited or deleted result versions to pending carry review", () => {
  const input = carriedInput(), target = input.target_snapshot;
  const props = { inputs: [input], annotations: [target], resolutions: [{ input_id: "input", outcome: "completed" as const, annotation_ref: { annotation_id: "carried", version: "current-version" } }], documentText: "Text", labelFor: () => null, onOpenFinding: vi.fn(), onInspectOriginal: vi.fn(), onComplete: vi.fn() };
  const mounted = render(<RoundInputPanel {...props} />);
  expect(screen.getByText("0 pending · 1 completed")).toBeDefined();
  mounted.rerender(<RoundInputPanel {...props} annotations={[{ ...target, version: "later-version" }]} />);
  expect(screen.getByText("1 pending · 0 completed")).toBeDefined();
  mounted.rerender(<RoundInputPanel {...props} annotations={[]} />);
  expect(screen.getByRole("button", { name: "Complete carried finding review" })).toHaveProperty("disabled", true);
});

it("requires an explicit result choice for changed evidence instead of selecting an arbitrary finding", () => {
  const input = { ...carriedInput(), target_snapshot: null, mapping_status: "needs_review" as const };
  const finding = carriedInput().target_snapshot;
  render(<RoundInputPanel inputs={[input]} annotations={[finding]} resolutions={[]} documentText="Text" labelFor={() => null} onOpenFinding={vi.fn()} onInspectOriginal={vi.fn()} onComplete={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Complete carried finding review" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("combobox", { name: "Result finding for input 1" }), { target: { value: "carried" } });
  expect(screen.getByRole("button", { name: "Complete carried finding review" })).toHaveProperty("disabled", false);
});

it("requires a dismissal reason and retains it across a failed carry review save", async () => {
  const input = carriedInput(), dismiss = vi.fn().mockRejectedValueOnce(new Error("Dismissal not saved")).mockResolvedValue(undefined);
  render(<RoundInputPanel inputs={[input]} annotations={[]} resolutions={[]} documentText="Text" labelFor={() => null} onOpenFinding={vi.fn()} onInspectOriginal={vi.fn()} onDismiss={dismiss} />);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss carried input" }));
  expect(screen.getByRole("button", { name: "Save carried input dismissal" })).toHaveProperty("disabled", true);
  const reason = screen.getByRole("textbox", { name: /Reason for dismissing carried input/ });
  fireEvent.change(reason, { target: { value: "  Corrected text does not support this finding.  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save carried input dismissal" }));
  await screen.findByText("Dismissal not saved");
  expect(reason).toHaveProperty("value", "  Corrected text does not support this finding.  ");
  fireEvent.click(screen.getByRole("button", { name: "Save carried input dismissal" }));
  await waitFor(() => expect(dismiss).toHaveBeenLastCalledWith(input, "Corrected text does not support this finding."));
});
