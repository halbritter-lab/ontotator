import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AnnotationSnapshot, type Draft, type RoundInputView } from "../src/api/client";
import { CaseScreen } from "../src/app/CaseScreen";
import { historical } from "./variantFixtures";
import { workspaceFixture } from "./assignments";

const { scrollToEvidence } = vi.hoisted(() => ({ scrollToEvidence: vi.fn() }));
vi.mock("../src/spans/adapter", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/spans/adapter")>();
  return {
    ...actual,
    mountSpanEditor: (...args: Parameters<typeof actual.mountSpanEditor>) => ({ ...actual.mountSpanEditor(...args), scrollToEvidence }),
  };
});

beforeEach(() => {
  scrollToEvidence.mockReset();
  vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_project, terms) => terms.map(term => ({ ...term, label: "Seizure" })) as never);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const AXES = [
  { id: "assertion", label: "Assertion", options: ["present", "absent"], allow_empty: false },
  { id: "temporality", label: "Temporality", options: ["current", "past"], allow_empty: true },
];
const finding = (id: string, values: Record<string, string | null>, defaulted: string[], evidenceId?: string): AnnotationSnapshot => {
  const copy = structuredClone(historical.annotations[0]);
  copy.annotation.annotation_id = id;
  copy.annotation.axes_values = values;
  copy.annotation.axes_defaulted = defaulted;
  copy.annotation.evidence_refs = evidenceId ? [{ evidence_id: evidenceId, version: "ev-v1" }] : [];
  copy.version = "v1";
  return copy;
};
const carriedFinding = () => finding("carried", { assertion: "present", temporality: "current" }, [], "ev-carried");
// Two axes; only the second is still a default without a value.
const openFinding = () => finding("open", { assertion: "present", temporality: null }, ["temporality"]);
const input = (target: AnnotationSnapshot): RoundInputView => {
  const source = structuredClone(historical.annotations[0]);
  return {
    input_id: "input-1", source_submission_id: "submission-2", source_ref: { annotation_id: source.annotation.annotation_id, version: source.version },
    source_snapshot: source, target_snapshot: target, mapping_status: "carried", source_round_ordinal: 2,
  };
};

function setup(annotations: AnnotationSnapshot[] = [carriedFinding(), openFinding()]) {
  const view = workspaceFixture().view;
  view.key.round_id = "round-3"; view.draft.key = view.key; view.require_spanless_note = false;
  view.layers![0].annotation_types[0].axes = AXES as never;
  view.draft.annotations = annotations;
  view.draft.evidence = [{ version: "ev-v1", mention: { evidence_id: "ev-carried", segments: [{ start: 12, end: 20 }] } }] as never;
  const carried = annotations.find(snapshot => snapshot.annotation.annotation_id === "carried");
  const rendered = render(<CaseScreen view={view} workspaceId="round-workspace" roundKind="carry_forward"
    roundInputs={carried ? [input(carried)] : []} onClose={vi.fn()} />);
  return { ...rendered, view };
}
const pressed = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".sidebar [data-list-key][aria-pressed='true']")).map(element => element.dataset.listKey);
const openDialog = async (label: RegExp = /Finish & Submit/) => {
  fireEvent.click(screen.getByRole("button", { name: label }));
  return screen.findByRole("dialog", { name: "Submit case" });
};
const goToButtons = (dialog: HTMLElement) => within(dialog).getAllByRole("button", { name: "Go to Seizure" });

describe("submit dialog open items", () => {
  it("lists every open item with its own Go to and keeps Submit focusable with the reason", async () => {
    const submit = vi.spyOn(api, "submitWorkspace");
    setup();
    const dialog = await openDialog(/Finish & Submit · 2 open/);
    expect(within(dialog).getByText("1 carried finding still needs a check, 1 annotation has defaulted axis values")).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Go to first unchecked" })).toBeDefined();
    expect(goToButtons(dialog)).toHaveLength(2);
    expect(Array.from(dialog.querySelectorAll<HTMLElement>("[data-open-item]")).map(item => item.dataset.openItem)).toEqual(["carried", "defaulted"]);

    const footer = dialog.querySelector(".modal-actions")!;
    const confirm = within(footer as HTMLElement).getByRole("button", { name: "Submit case" });
    expect(within(footer as HTMLElement).getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(confirm).toHaveProperty("disabled", false);
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(confirm.getAttribute("aria-describedby")!)?.textContent).toBe("Check 1 carried finding before submitting.");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
    fireEvent.click(confirm);
    expect(dialog.querySelector("[data-submit-announcer]")!.textContent).toBe("Check 1 carried finding before submitting.");
    expect(submit).not.toHaveBeenCalled();
  });

  it("names the unchecked text confirmation as the reason when nothing else blocks", async () => {
    setup([openFinding()]);
    const dialog = await openDialog(/Finish & Submit · 1 open/);
    const confirm = within(dialog).getByRole("button", { name: "Submit case" });
    expect(document.getElementById(confirm.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Confirm that the entire text was checked before submitting.");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
    expect(confirm.getAttribute("aria-disabled")).toBeNull();
  });

  it("goes to the carried finding: selects it, shows Details, scrolls to its mark and focuses Mark as checked", async () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Findings/ }));
    expect(document.querySelector(".app-layout")!.className).toContain("mobile-pane-list");
    const dialog = await openDialog();
    fireEvent.click(goToButtons(dialog)[0]);
    expect(screen.queryByRole("dialog", { name: "Submit case" })).toBeNull();
    expect(pressed(container)).toEqual(["annotation:carried"]);
    expect(container.querySelector(".app-layout")!.className).toContain("mobile-pane-details");
    expect(scrollToEvidence).toHaveBeenCalledWith("ev-carried");
    await waitFor(() => expect((document.activeElement as HTMLElement).textContent).toContain("Mark as checked"));
  });

  it("focuses the second axis of a finding whose second value is open, without scrolling a finding without a mark", async () => {
    const { container } = setup();
    const dialog = await openDialog();
    fireEvent.click(goToButtons(dialog)[1]);
    expect(pressed(container)).toEqual(["annotation:open"]);
    expect(scrollToEvidence).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('[data-axis-field="temporality"] input:checked')));
    expect((document.activeElement as HTMLInputElement).name).toBe("axis-open-temporality");
  });

  it("lists a server axis warning as an unconfirmed value and goes to that axis", async () => {
    const { container, view } = setup([openFinding()]);
    vi.spyOn(api, "submitWorkspace").mockRejectedValue(new ApiError(422, "Review defaults", "AXIS_CONFIRMATION_WARNING", {
      acknowledgement: { draft_revision: view.draft.revision, policy_revision: 1, warning_digest: "digest" },
      warnings: [{ annotation_id: "open", rule: "axis_not_chosen", detail: { axis: "temporality" } }],
    }));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Entire text checked for further findings" }));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Submit case" })); });
    const continueButton = await within(dialog).findByRole("button", { name: "Continue and submit" });
    expect(document.getElementById(continueButton.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Confirm “Submit with these unconfirmed values” before submitting.");
    expect(within(dialog).getByText("Not confirmed: Temporality = Not specified.")).toBeDefined();
    expect(Array.from(dialog.querySelectorAll<HTMLElement>("[data-open-item]")).map(item => item.dataset.openItem)).toEqual(["unconfirmed-values"]);
    fireEvent.click(goToButtons(dialog)[0]);
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('[data-axis-field="temporality"] input:checked')));
  });

  it("shows more than five items as 'and n more'", async () => {
    const many = Array.from({ length: 8 }, (_, index) => finding(`open-${index}`, { assertion: "present", temporality: null }, ["temporality"]));
    setup(many);
    const dialog = await openDialog(/Finish & Submit · 8 open/);
    expect(goToButtons(dialog)).toHaveLength(5);
    expect(within(dialog).getByText("and 3 more")).toBeDefined();
  });
});

describe("toolbar open count", () => {
  it("shows the count and Next open item before the dialog was opened and drops both when resolved", async () => {
    const { container, view } = setup([carriedFinding(), openFinding()]);
    expect(screen.getByRole("button", { name: /Finish & Submit · 2 open/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Next open item" }));
    expect(pressed(container)).toEqual(["annotation:carried"]);
    await waitFor(() => expect((document.activeElement as HTMLElement).textContent).toContain("Mark as checked"));
    fireEvent.click(screen.getByRole("button", { name: "Next open item" }));
    expect(pressed(container)).toEqual(["annotation:open"]);
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('[data-axis-field="temporality"] input:checked')));

    // Choosing the value resolves the defaulted item.
    const chosen = openFinding();
    chosen.annotation.axes_values = { assertion: "present", temporality: "current" }; chosen.annotation.axes_defaulted = [];
    const draft = (revision: number, annotations: AnnotationSnapshot[], resolutions: unknown[] = []): Draft =>
      ({ ...view.draft, revision, annotations, round_input_resolutions: resolutions as never });
    vi.spyOn(api, "applyCommand").mockResolvedValue(draft(1, [carriedFinding(), chosen]));
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Current" })); });
    await waitFor(() => expect(screen.getByRole("button", { name: /Finish & Submit · 1 open/ })).toBeDefined());
    const dialog = await openDialog();
    expect(goToButtons(dialog)).toHaveLength(1);
    fireEvent.click(goToButtons(dialog)[0]);

    const resolution = { input_id: "input-1", outcome: "completed", annotation_ref: { annotation_id: "carried", version: "v1" } };
    vi.spyOn(api, "resolveRoundInput").mockResolvedValue(draft(2, [carriedFinding(), chosen], [resolution]));
    await waitFor(() => expect((document.activeElement as HTMLElement).textContent).toContain("Mark as checked"));
    await act(async () => { fireEvent.click(document.activeElement as HTMLElement); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish & Submit Case" })).toBeDefined());
    expect(screen.queryByRole("button", { name: "Next open item" })).toBeNull();
  });
});
