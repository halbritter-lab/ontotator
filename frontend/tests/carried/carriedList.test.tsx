import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AnnotationSnapshot, type RoundInputView } from "../../src/api/client";
import { CaseScreen } from "../../src/app/CaseScreen";
import { historical } from "../variantFixtures";
import { workspaceFixture } from "../assignments";

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockReset();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
  vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_project, terms) => terms.map(term => ({ ...term, label: "Seizure" })) as never);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const finding = (id: string, version = "v1"): AnnotationSnapshot => {
  const copy = structuredClone(historical.annotations[0]);
  copy.annotation.annotation_id = id;
  copy.version = version;
  return copy;
};
const input = (id: string, target: AnnotationSnapshot | null): RoundInputView => {
  const source = structuredClone(historical.annotations[0]);
  return {
    input_id: id, source_submission_id: "submission-2", source_ref: { annotation_id: source.annotation.annotation_id, version: source.version },
    source_snapshot: source, target_snapshot: target, mapping_status: target ? "carried" : "needs_review", source_round_ordinal: 2,
  };
};

function setup({ annotations, inputs, resolutions = [], props = {} }: {
  annotations: AnnotationSnapshot[]; inputs: RoundInputView[]; resolutions?: unknown[]; props?: Record<string, unknown>;
}) {
  const view = workspaceFixture().view;
  view.key.round_id = "round-3"; view.draft.key = view.key; view.require_spanless_note = false;
  view.draft.annotations = annotations;
  view.draft.round_input_resolutions = resolutions as never;
  return render(<CaseScreen view={view} workspaceId="round-workspace" roundKind="carry_forward" roundInputs={inputs} onClose={vi.fn()} {...props} />);
}
const listKeys = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key]")).map(element => element.dataset.listKey);
const row = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-list-key="${key}"]`)!;
const pressed = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key][aria-pressed='true']")).map(element => element.dataset.listKey);
const liveRegion = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-carried-announcer]")!;

describe("carried findings in the findings list", () => {
  it("shows one list with the carried row, its check state and the progress line", async () => {
    const carried = finding("carried");
    const { container } = setup({ annotations: [carried], inputs: [input("input-1", carried)] });
    expect(screen.queryByRole("region", { name: "Review carried findings" })).toBeNull();
    expect(container.querySelector(".round-input-panel")).toBeNull();
    expect(within(container.querySelector(".sidebar")!).getByText("Findings (1)")).toBeDefined();
    expect(screen.getByText("0 of 1 checked")).toBeDefined();
    const carriedRow = row(container, "annotation:carried");
    expect(within(carriedRow).getByText("Check needed")).toBeDefined();
    expect(within(carriedRow).getByText("Carried from Round 2")).toBeDefined();
    expect(within(carriedRow).getByText("No text span. Check that it still applies to this text.")).toBeDefined();
    expect(screen.getByRole("button", { name: /Next unchecked/ })).toBeDefined();
  });

  it("lists placeholder rows in input order before the findings", async () => {
    const carried = finding("carried");
    const { container } = setup({
      annotations: [carried],
      inputs: [input("input-failed", null), input("input-deleted", finding("gone")), input("input-carried", carried)],
    });
    expect(listKeys(container)).toEqual(["input:input-failed", "input:input-deleted", "annotation:carried"]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Seizure, carried, not on this text, check needed" })).toHaveLength(2));
    expect(within(row(container, "input:input-failed")).getByText("Could not be placed on this text. Mark it again, link it or dismiss it.")).toBeDefined();
    expect(within(row(container, "input:input-deleted")).getByText("You deleted the carried finding. Link another finding or dismiss it.")).toBeDefined();
  });

  it("moves through unchecked rows with N and Shift+N and lists both keys in the help", async () => {
    const carried = finding("carried");
    const { container } = setup({
      annotations: [carried],
      inputs: [input("input-failed", null), input("input-deleted", finding("gone")), input("input-carried", carried)],
    });
    fireEvent.keyDown(window, { key: "n" });
    expect(pressed(container)).toEqual(["input:input-failed"]);
    fireEvent.keyDown(window, { key: "n" });
    expect(pressed(container)).toEqual(["input:input-deleted"]);
    fireEvent.keyDown(window, { key: "n" });
    expect(pressed(container)).toEqual(["annotation:carried"]);
    fireEvent.keyDown(window, { key: "n" });
    expect(pressed(container)).toEqual(["input:input-failed"]);
    fireEvent.keyDown(window, { key: "N", shiftKey: true });
    expect(pressed(container)).toEqual(["annotation:carried"]);

    const note = screen.getByRole("textbox", { name: "Annotation note" });
    fireEvent.keyDown(note, { key: "n" });
    expect(pressed(container)).toEqual(["annotation:carried"]);

    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Next unchecked carried finding")).toBeDefined();
    expect(screen.getByText("Previous unchecked carried finding")).toBeDefined();
  });

  it("keeps a single selection across rows, placeholders and N, and scrolls the row into view", async () => {
    const carried = finding("carried");
    const plain = finding("plain");
    const { container } = setup({ annotations: [carried, plain], inputs: [input("input-failed", null), input("input-carried", carried)] });
    fireEvent.click(row(container, "annotation:plain"));
    expect(pressed(container)).toEqual(["annotation:plain"]);
    fireEvent.click(row(container, "input:input-failed"));
    expect(pressed(container)).toEqual(["input:input-failed"]);
    expect(screen.getByRole("region", { name: "Carried finding" })).toBeDefined();
    fireEvent.keyDown(window, { key: "n" });
    expect(pressed(container)).toEqual(["annotation:carried"]);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    fireEvent.click(row(container, "annotation:plain"));
    expect(pressed(container)).toEqual(["annotation:plain"]);
    expect(screen.queryByRole("region", { name: "Carried finding" })).toBeNull();
  });

  it("announces when an edit makes a checked finding unchecked", async () => {
    const carried = finding("carried", "checked-version");
    const resolution = { input_id: "input-carried", outcome: "completed", annotation_ref: { annotation_id: "carried", version: "checked-version" } };
    const { container } = setup({ annotations: [carried], inputs: [input("input-carried", carried)], resolutions: [resolution] });
    expect(screen.getByText("All carried findings checked")).toBeDefined();
    expect(within(row(container, "annotation:carried")).getByText("Checked")).toBeDefined();
    const edited = structuredClone(carried); edited.version = "edited-version"; edited.annotation.note = "Edited";
    const view = workspaceFixture().view;
    vi.spyOn(api, "applyCommand").mockResolvedValue({ ...view.draft, revision: 1, annotations: [edited], round_input_resolutions: [resolution] } as never);
    expect(liveRegion(container).textContent).toBe("");
    fireEvent.click(row(container, "annotation:carried"));
    const note = screen.getByRole("textbox", { name: "Annotation note" });
    fireEvent.change(note, { target: { value: "Edited" } });
    await act(async () => { fireEvent.blur(note); });
    await waitFor(() => expect(liveRegion(container).textContent).toBe("Seizure needs a new check. 0 of 1 checked."));
    expect(within(row(container, "annotation:carried")).getByText("Changed after your check")).toBeDefined();
    expect(listKeys(container)).toEqual(["annotation:carried"]);
  });

  it("names the round in the toolbar badge with the full identity in the title", () => {
    const carried = finding("carried");
    setup({ annotations: [carried], inputs: [input("input-1", carried)], props: { roundBadge: "Round 3 · continued from Round 2", roundTitle: "Round 3, continued from Round 2 submission (19 Oct, 00:57)" } });
    const badge = screen.getByText("Round 3 · continued from Round 2");
    expect(badge.getAttribute("title")).toBe("Round 3, continued from Round 2 submission (19 Oct, 00:57)");
    cleanup();
    setup({ annotations: [carried], inputs: [input("input-1", carried)] });
    expect(screen.getByText("Review carried findings", { selector: ".badge" })).toBeDefined();
  });

  it("blocks submission while a carried finding is unchecked and goes to the first open row", async () => {
    const carried = finding("carried");
    const submit = vi.spyOn(api, "submitWorkspace");
    const { container } = setup({ annotations: [carried], inputs: [input("input-1", carried)] });
    fireEvent.click(screen.getByRole("button", { name: /Finish & Submit Case/ }));
    const dialog = await screen.findByRole("dialog", { name: "Submit case" });
    expect(dialog.textContent).toContain("1 carried finding(s) still need review");
    fireEvent.click(within(dialog).getByRole("button", { name: "Review carried findings" }));
    expect(pressed(container)).toEqual(["annotation:carried"]);
    expect(submit).not.toHaveBeenCalled();
  });
});
