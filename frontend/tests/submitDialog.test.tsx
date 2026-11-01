import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AnnotationSnapshot, type Draft, type RoundInputView } from "../src/api/client";
import { CaseScreen } from "../src/app/CaseScreen";
import { SubmitCaseDialog, submitLabel, summaryText, type SubmitCaseDialogProps } from "../src/editor/SubmitCaseDialog";
import { collectOpenItems } from "../src/editor/openItems";
import { unconfirmedRows, type UnconfirmedRow } from "../src/editor/unconfirmedValues";
import { UNCONFIRMED_CONSEQUENCE } from "../src/editor/UnconfirmedValuesSection";
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
const openDialog = async (label: RegExp = /Finish & submit/) => {
  fireEvent.click(screen.getByRole("button", { name: label }));
  return screen.findByRole("dialog", { name: "Submit text" });
};
const goToButtons = (dialog: HTMLElement) => within(dialog).getAllByRole("button", { name: "Go to Seizure" });

describe("submit dialog open items", () => {
  it("lists every open item with its own Go to and keeps Submit focusable with the reason", async () => {
    const submit = vi.spyOn(api, "submitWorkspace");
    setup();
    const dialog = await openDialog(/Finish & submit \(2 open\)/);
    // Defaulted values leave the generic groups for "Values not chosen yet".
    expect(within(dialog).getByRole("heading", { level: 3, name: "Carried findings to check" })).toBeDefined();
    expect(within(dialog).getByRole("heading", { level: 3, name: "Values not chosen yet" })).toBeDefined();
    expect(goToButtons(dialog)).toHaveLength(2);
    expect(Array.from(dialog.querySelectorAll<HTMLElement>("[data-open-item]")).map(item => item.dataset.openItem)).toEqual(["carried"]);
    expect(Array.from(dialog.querySelectorAll<HTMLElement>("[data-unconfirmed-row]")).map(row => row.dataset.unconfirmedRow)).toEqual(["open"]);

    const footer = dialog.querySelector(".modal-actions")!;
    const confirm = within(footer as HTMLElement).getByRole("button", { name: "Submit text" });
    expect(within(footer as HTMLElement).getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(confirm).toHaveProperty("disabled", false);
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(confirm.getAttribute("aria-describedby")!)?.textContent).toBe("Check 1 carried finding before submitting.");
    fireEvent.click(confirm);
    expect(dialog.querySelector("[data-submit-announcer]")!.textContent).toBe("Check 1 carried finding before submitting.");
    // Blocked: only the reason is said, not the text check.
    expect(dialog.querySelector("[data-submit-checked-text]")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("states the text check once and submits the warnings with one click on Submit with 1 warning", async () => {
    const submit = vi.spyOn(api, "submitWorkspace").mockReturnValue(new Promise(() => undefined));
    setup([openFinding()]);
    const dialog = await openDialog(/Finish & submit \(1 open\)/);
    expect(within(dialog).getByText("1 finding. 1 thing is still open:")).toBeDefined();
    expect(dialog.querySelector("[data-submit-checked-text]")!.textContent).toBe("Submitting also says you checked the whole text for further findings.");
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    // An empty value is chosen in the finding: no "Confirm as shown".
    expect(within(dialog).queryByRole("button", { name: /Confirm as shown/ })).toBeNull();
    const confirm = within(dialog).getByRole("button", { name: "Submit with 1 warning" });
    expect(confirm.getAttribute("aria-disabled")).toBeNull();
    expect(confirm.getAttribute("aria-describedby")).toBeNull();
    await act(async () => { fireEvent.click(confirm); });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("goes to the carried finding: selects it, shows Details, scrolls to its mark and focuses Mark as checked", async () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Findings/ }));
    expect(document.querySelector(".app-layout")!.className).toContain("mobile-pane-list");
    const dialog = await openDialog();
    fireEvent.click(goToButtons(dialog)[0]);
    expect(screen.queryByRole("dialog", { name: "Submit text" })).toBeNull();
    expect(pressed(container)).toEqual(["annotation:carried"]);
    expect(container.querySelector(".app-layout")!.className).toContain("mobile-pane-details");
    expect(scrollToEvidence).toHaveBeenCalledWith("ev-carried", undefined);
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

  it("shows the list again when the server keeps warning and goes to the open axis", async () => {
    const { container, view } = setup([openFinding()]);
    const submit = vi.spyOn(api, "submitWorkspace").mockRejectedValue(new ApiError(422, "Review defaults", "AXIS_CONFIRMATION_WARNING", {
      acknowledgement: { draft_revision: view.draft.revision, policy_revision: 1, warning_digest: "digest" },
      warnings: [{ annotation_id: "open", rule: "axis_not_chosen", detail: { axis: "temporality" } }],
    }));
    const dialog = await openDialog();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Submit with 1 warning" })); });
    await waitFor(() => expect(dialog.querySelector("[data-submit-status]")!.textContent).toBe("The unconfirmed values changed. Check the list again."));
    // One resend with the fresh acknowledgement, then the list is shown again.
    expect(submit).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByText((_, el) => el?.classList.contains("submit-item__values") === true && el.textContent === "Temporality: Not specified")).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Submit with 1 warning" })).toBeDefined();
    expect(within(dialog).queryByRole("button", { name: "Continue and submit" })).toBeNull();
    fireEvent.click(goToButtons(dialog)[0]);
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('[data-axis-field="temporality"] input:checked')));
  });

  it("lists every unconfirmed finding in its section, without the five-item limit", async () => {
    const many = Array.from({ length: 8 }, (_, index) => finding(`open-${index}`, { assertion: "present", temporality: null }, ["temporality"]));
    setup(many);
    const dialog = await openDialog(/Finish & submit \(8 open\)/);
    expect(within(dialog).getByRole("heading", { name: "Values not chosen yet" })).toBeDefined();
    expect(goToButtons(dialog)).toHaveLength(8);
    expect(within(dialog).queryByText(/more$/)).toBeNull();
    // Only empty values: nothing to confirm in one click.
    expect(within(dialog).queryByRole("button", { name: /Confirm all/ })).toBeNull();
    expect(within(dialog).getAllByText("Choose a value in the finding.")).toHaveLength(8);
    expect(within(dialog).getByRole("button", { name: "Submit with 8 warnings" })).toBeDefined();
  });
});

describe("toolbar open count", () => {
  it("shows the count and Next open item before the dialog was opened and drops both when resolved", async () => {
    const { container, view } = setup([carriedFinding(), openFinding()]);
    expect(screen.getByRole("button", { name: /Finish & submit \(2 open\)/ })).toBeDefined();
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
    await waitFor(() => expect(screen.getByRole("button", { name: /Finish & submit \(1 open\)/ })).toBeDefined());
    const dialog = await openDialog();
    expect(goToButtons(dialog)).toHaveLength(1);
    fireEvent.click(goToButtons(dialog)[0]);

    const resolution = { input_id: "input-1", outcome: "completed", annotation_ref: { annotation_id: "carried", version: "v1" } };
    vi.spyOn(api, "resolveRoundInput").mockResolvedValue(draft(2, [carriedFinding(), chosen], [resolution]));
    await waitFor(() => expect((document.activeElement as HTMLElement).textContent).toContain("Mark as checked"));
    await act(async () => { fireEvent.click(document.activeElement as HTMLElement); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish & submit text" })).toBeDefined());
    expect(screen.queryByRole("button", { name: "Next open item" })).toBeNull();
  });
});

describe("Unconfirmed values section", () => {
  const TERMS: Record<string, string> = { h: "Hypotonia", s: "Seizure", f: "Fever", e: "Edema" };
  const AXES3 = [
    { id: "assertion", label: "Assertion", options: ["present", "absent"] },
    { id: "experiencer", label: "Experiencer", options: ["patient", "other"] },
  ];
  const snap = (id: string, values: Record<string, string | null>, defaulted: string[]) => {
    const copy = finding(id, values, defaulted);
    copy.annotation.term_id = `HP:${id}`;
    return copy;
  };
  const rowsOf = (snapshots: AnnotationSnapshot[]) => unconfirmedRows({
    snapshots, axes: () => AXES3, targetKeyOf: () => undefined, editableLayerIds: [snapshots[0]?.annotation.layer_id ?? ""],
    term: s => TERMS[s.annotation.annotation_id] ?? s.annotation.annotation_id, quote: () => "the quoted mark", evidenceId: () => undefined,
  });
  const defaults = { assertion: "present", experiencer: "patient" };
  /** Hypotonia, Seizure and Fever with two defaults each: six values. */
  const threeRows = () => rowsOf(["h", "s", "f"].map(id => snap(id, defaults, ["assertion", "experiencer"])));
  const dialogProps = (overrides: Partial<SubmitCaseDialogProps> = {}): SubmitCaseDialogProps => ({
    open: true, textName: "doc", findingCount: 3, items: [], unconfirmed: threeRows(), requireChosenAxes: false, confirmUnavailableReason: null,
    onConfirmValues: vi.fn().mockResolvedValue(true), submitStatus: null,
    saving: false, readOnly: false, onGoTo: vi.fn(), onGoToRow: vi.fn(),
    onConfirm: vi.fn(), onCancel: vi.fn(), ...overrides,
  });
  const section = () => document.querySelector<HTMLElement>("[data-unconfirmed-values]")!;
  const status = () => document.querySelector("[data-unconfirmed-status]")!.textContent;
  /** The primary button: "Submit text" or "Submit with N warnings". */
  const submitButton = () => screen.getByRole("button", { name: /^Submit (text|with)/ });
  const reasonOf = (button: HTMLElement) => document.getElementById(button.getAttribute("aria-describedby")!)?.textContent;

  it("names the text and summarises in one line with real plurals (#48 N-20)", () => {
    const { rerender } = render(<SubmitCaseDialog {...dialogProps({ findingCount: 1, unconfirmed: [] })} />);
    expect(screen.getByRole("heading", { name: "Submit doc?" })).toBeDefined();
    expect(screen.getByText("1 finding, nothing open.")).toBeDefined();
    expect(document.querySelector("[data-submit-checked-text]")!.textContent)
      .toBe("Submitting also says you checked the whole text for further findings. Afterwards the submission is read-only; to change it, start a new work round under More › Work rounds.");
    rerender(<SubmitCaseDialog {...dialogProps({ findingCount: 0 })} />);
    expect(screen.getByText("0 findings. 3 things are still open:")).toBeDefined();
  });

  it("shows a blocked reason once, also after a click on Submit text", () => {
    render(<SubmitCaseDialog {...dialogProps({ requireChosenAxes: true })} />);
    fireEvent.click(submitButton());
    expect(document.querySelectorAll("[data-submit-blocked-reason]")).toHaveLength(1);
    expect(screen.getAllByText(/before submitting\.$/)).toHaveLength(1);
    expect(document.querySelector("[data-submit-checked-text]")).toBeNull();
  });

  it("lists one row per finding with term, quote, values and its actions", () => {
    render(<SubmitCaseDialog {...dialogProps()} />);
    expect(screen.getByRole("heading", { level: 3, name: "Values not chosen yet" })).toBeDefined();
    const header = section().querySelector<HTMLElement>(".submit-group__header")!;
    expect(within(header).getByRole("button", { name: "Confirm all as shown (3)" })).toBeDefined();
    const list = within(section()).getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const first = within(items[0]);
    expect(first.getByText("Hypotonia")).toBeDefined();
    expect(first.queryByText("HP:h")).toBeNull();
    expect(first.getByText("\u201cthe quoted mark\u201d")).toBeDefined();
    // Values as chips; the axis label is shown before each.
    expect(Array.from(items[0].querySelectorAll(".submit-item__value")).map(value => value.textContent)).toEqual(["Assertion: Present", "Experiencer: Patient"]);
    expect(Array.from(items[0].querySelectorAll(".submit-item__values .submit-item__axis")).map(label => label.textContent)).toEqual(["Assertion: ", "Experiencer: "]);
    expect(items[0].querySelectorAll(".submit-item__values .visually-hidden")).toHaveLength(0);
    expect(items[0].querySelectorAll(".submit-item__values .axis-value")).toHaveLength(2);
    expect(first.getByRole("button", { name: "Confirm as shown: Hypotonia" }).className).toContain("btn-secondary");
    expect(first.getByRole("button", { name: "Go to Hypotonia" }).className).toContain("btn-secondary");
  });

  it("offers no Confirm all for one row and keeps defaulted items out of the generic groups", () => {
    const items = [{ key: "defaulted:h", kind: "defaulted" as const, blocking: false, term: "Hypotonia", line: "Default values: confirm them or choose values.", listKey: "annotation:h", focus: "[data-axis-field]" }];
    render(<SubmitCaseDialog {...dialogProps({ items, unconfirmed: threeRows().slice(0, 1) })} />);
    expect(screen.getByRole("heading", { level: 3, name: "Values not chosen yet" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Confirm all/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm as shown: Hypotonia" })).toBeDefined();
    expect(screen.queryByText(/defaulted axis values/)).toBeNull();
    expect(document.querySelector("[data-open-item]")).toBeNull();
  });

  it("Confirm shows the pending row, then focuses the next row, the previous row and finally the text check", async () => {
    let resolve!: (ok: boolean) => void;
    const onConfirmValues = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
    const rows = threeRows();
    const { rerender } = render(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: rows })} />);
    const confirmH = screen.getByRole("button", { name: "Confirm as shown: Hypotonia" });
    confirmH.focus();
    fireEvent.click(confirmH);
    expect(onConfirmValues).toHaveBeenCalledWith(rows[0]);
    const pendingRow = confirmH.closest("li")!;
    expect(within(pendingRow).getByText("Confirming…")).toBeDefined();
    expect(confirmH.getAttribute("aria-disabled")).toBe("true");
    expect(within(pendingRow).getByRole("button", { name: "Go to Hypotonia" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(confirmH);
    expect(onConfirmValues).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(true); });
    rerender(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: rows.slice(1) })} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm as shown: Seizure" }));
    expect(status()).toBe("Confirmed Hypotonia. 2 left.");

    // The last row hands the focus to the previous row.
    fireEvent.click(screen.getByRole("button", { name: "Confirm as shown: Fever" }));
    await act(async () => { resolve(true); });
    rerender(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: [rows[1]] })} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm as shown: Seizure" }));

    // No rows left (a modifier warning keeps the box open): the primary button, the group is gone and the live region says so.
    const other = collectOpenItems({ carried: [], evidence: [], reanchor: [], unconfirmed: [], openTargets: [], defaulted: [],
      modifierWarnings: [{ annotationId: "x", term: "Severe", kind: "modifier-as-finding", key: "term:HP:0012828", labels: ["Severe"] }] });
    rerender(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: [rows[1]], items: other })} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm as shown: Seizure" }));
    await act(async () => { resolve(true); });
    rerender(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: [], items: other })} />);
    expect(document.activeElement).toBe(submitButton());
    expect(status()).toBe("Confirmed Seizure. All values are confirmed.");
    expect(section()).toBeNull();
  });

  it("the last confirmed row with nothing else open moves the focus to Submit text and announces it", async () => {
    let resolve!: (ok: boolean) => void;
    const onConfirmValues = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
    const rows = threeRows().slice(0, 1);
    const { rerender } = render(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: rows })} />);
    const confirm = screen.getByRole("button", { name: "Confirm as shown: Hypotonia" });
    confirm.focus();
    fireEvent.click(confirm);
    await act(async () => { resolve(true); });
    rerender(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: [] })} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Submit text" }));
    expect(document.querySelector("[data-unconfirmed-status]")?.textContent).toBe("Confirmed Hypotonia. All values are confirmed.");
  });

  it("moves the focus on when a confirmed row stays with an empty value only", async () => {
    let resolve!: (ok: boolean) => void;
    const onConfirmValues = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
    const rows = rowsOf([
      snap("h", defaults, ["assertion"]),
      snap("s", defaults, ["assertion", "experiencer"]),
    ]);
    const { rerender } = render(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: rows })} />);
    const confirmH = screen.getByRole("button", { name: "Confirm as shown: Hypotonia" });
    confirmH.focus();
    fireEvent.click(confirmH);
    await act(async () => { resolve(true); });
    const after = rowsOf([snap("h", { assertion: "present", experiencer: null }, []), snap("s", defaults, ["assertion", "experiencer"])]);
    expect(after[0].confirmableAxisIds).toEqual([]);
    rerender(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: after })} />);
    expect(screen.queryByRole("button", { name: "Confirm as shown: Hypotonia" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm as shown: Seizure" }));
    expect(status()).toBe("Confirmed Hypotonia. 2 left.");

    // The mixed row is the only one left: the focus goes to Submit text, not to body.
    fireEvent.click(screen.getByRole("button", { name: "Confirm as shown: Seizure" }));
    await act(async () => { resolve(true); });
    rerender(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: after.slice(0, 1) })} />);
    expect(document.activeElement).toBe(submitButton());
    expect(status()).toBe("Confirmed Seizure. 1 left.");
  });

  it("Confirm all confirms the rows in order and stops at a failure with Retry", async () => {
    const rows = threeRows();
    const calls: string[] = [];
    const onConfirmValues = vi.fn(async (row: UnconfirmedRow) => { calls.push(row.annotationId); return row.annotationId !== "s"; });
    render(<SubmitCaseDialog {...dialogProps({ onConfirmValues, unconfirmed: rows })} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm all as shown (3)" })); });
    expect(calls).toEqual(["h", "s"]);
    const row = screen.getByRole("button", { name: "Retry confirming Seizure as shown" }).closest("li")!;
    expect(within(row).getByText("Could not confirm. Try again.")).toBeDefined();
    expect(within(row).getByRole("button", { name: /Retry/ }).textContent).toBe("Retry");
    expect(status()).toBe("Confirmed 1 finding.");
  });

  it("Confirm all names the rows that still need a value and is hidden below two confirmable rows", async () => {
    const mixed = rowsOf([snap("h", defaults, ["assertion"]), snap("s", defaults, ["assertion"]), snap("e", { assertion: null, experiencer: "patient" }, [])]);
    const { unmount } = render(<SubmitCaseDialog {...dialogProps({ unconfirmed: mixed })} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm all as shown (2)" })); });
    expect(status()).toBe("Confirmed 2 findings. 1 need a value.");
    unmount();
    render(<SubmitCaseDialog {...dialogProps({ unconfirmed: mixed.slice(1) })} />);
    expect(screen.queryByRole("button", { name: /Confirm all/ })).toBeNull();
  });

  it("a row that cannot be confirmed keeps only Go to and its reason as the last line", () => {
    const onGoToRow = vi.fn();
    const rows = rowsOf([snap("e", { assertion: null, experiencer: "patient" }, [])]);
    render(<SubmitCaseDialog {...dialogProps({ unconfirmed: rows, onGoToRow })} />);
    const item = within(section()).getByRole("listitem");
    expect(within(item).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Go to Edema"]);
    expect(item.lastElementChild!.textContent).toBe("Choose a value in the finding.");
    expect(item.querySelector(".submit-item__values")!.textContent).toBe("Assertion: Not specified");
    fireEvent.click(within(item).getByRole("button", { name: "Go to Edema" }));
    expect(onGoToRow).toHaveBeenCalledWith(rows[0]);
  });

  it("acknowledges the rows with one click on Submit with N warnings, counting rows not values", () => {
    const onConfirm = vi.fn();
    const rows = threeRows().slice(0, 2);
    const { rerender } = render(<SubmitCaseDialog {...dialogProps({ unconfirmed: rows, onConfirm })} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    const button = screen.getByRole("button", { name: "Submit with 2 warnings" });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith(true);
    rerender(<SubmitCaseDialog {...dialogProps({ unconfirmed: [], onConfirm })} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit text" }));
    expect(onConfirm).toHaveBeenLastCalledWith(false);
  });

  it("says what happens to values left unconfirmed, only while they are warnings (#164)", () => {
    const { rerender } = render(<SubmitCaseDialog {...dialogProps()} />);
    expect(section().querySelector("[data-unconfirmed-consequence]")!.textContent).toBe(UNCONFIRMED_CONSEQUENCE);
    rerender(<SubmitCaseDialog {...dialogProps({ requireChosenAxes: true })} />);
    expect(section().querySelector("[data-unconfirmed-consequence]")).toBeNull();
  });

  it("with the project rule the rows block and there is no warnings button", () => {
    const onConfirm = vi.fn();
    render(<SubmitCaseDialog {...dialogProps({ unconfirmed: threeRows().slice(0, 2), requireChosenAxes: true, onConfirm })} />);
    expect(screen.queryByRole("button", { name: /Submit with/ })).toBeNull();
    expect(submitButton().textContent).toBe("Submit text");
    expect(submitButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(submitButton());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(reasonOf(submitButton())).toBe("Confirm or choose 4 values before submitting.");
  });

  it("names why Confirm is unavailable while Go to still works", () => {
    const onConfirmValues = vi.fn().mockResolvedValue(true), onGoToRow = vi.fn();
    render(<SubmitCaseDialog {...dialogProps({ confirmUnavailableReason: "Offline \u2013 changes not saved", onConfirmValues, onGoToRow })} />);
    for (const name of ["Confirm all as shown (3)", "Confirm as shown: Hypotonia"]) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(reasonOf(button)).toBe("Offline \u2013 changes not saved");
      fireEvent.click(button);
    }
    expect(onConfirmValues).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go to Hypotonia" }));
    expect(onGoToRow).toHaveBeenCalledTimes(1);
  });

  it("labels the primary button with the warnings and reads the submit status politely", () => {
    const text = "The unconfirmed values changed. Check the list again.";
    const { rerender } = render(<SubmitCaseDialog {...dialogProps({ submitStatus: { text, count: 1 } })} />);
    expect(submitButton().textContent).toBe("Submit with 3 warnings");
    expect(screen.queryByRole("button", { name: "Continue and submit" })).toBeNull();
    const region = document.querySelector<HTMLElement>("[data-submit-status]")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe(text);
    // The same text a second time (a warning after the resend) is a new node, so it is read again.
    const first = region.firstElementChild;
    rerender(<SubmitCaseDialog {...dialogProps({ submitStatus: { text, count: 2 } })} />);
    expect(region.textContent).toBe(text);
    expect(region.firstElementChild).not.toBe(first);
  });

  describe("modifier warnings and the modifier-as-finding item", () => {
    const warnings = collectOpenItems({ carried: [], evidence: [], reanchor: [], unconfirmed: [], openTargets: [], defaulted: [],
      modifierWarnings: [
        { annotationId: "s", term: "Seizure", kind: "exclusive-modifiers", key: "exclusive:severity", labels: ["Mild", "Severe"], exclusiveClass: "severity" },
        { annotationId: "s", term: "Seizure", kind: "cohort-modifier", key: "cohort:HP:0040283", labels: ["Frequent"] }],
    });
    const standalone = collectOpenItems({ carried: [], evidence: [], reanchor: [], unconfirmed: [], openTargets: [], defaulted: [],
      modifierWarnings: [{ annotationId: "sev", term: "Severe", kind: "modifier-as-finding", key: "term:HP:0012828", labels: ["Severe"] }] });

    it("lists the warnings in their own group after the values and counts them in the primary button", () => {
      const onGoTo = vi.fn();
      render(<SubmitCaseDialog {...dialogProps({ items: warnings, unconfirmed: threeRows().slice(0, 1), onGoTo })} />);
      const section = screen.getByRole("region", { name: "Modifier warnings" });
      expect(within(section).getAllByRole("listitem").map(item => [item.querySelector(".submit-item__what")!.textContent, item.querySelector(".submit-item__line")!.textContent]))
        .toEqual([["Seizure", "Two severities: Mild, Severe."], ["Seizure", "Frequent is a cohort term."]]);
      expect(document.querySelector("[data-unconfirmed-values]")!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(document.querySelectorAll('[data-open-item]:not([data-modifier-warnings] *)')).toHaveLength(0);
      fireEvent.click(within(section).getAllByRole("button", { name: "Go to Seizure" })[0]);
      expect(onGoTo).toHaveBeenCalledWith(warnings[0]);
      // One values row and two modifier warnings.
      expect(submitButton().textContent).toBe("Submit with 3 warnings");
      expect(submitButton().getAttribute("aria-describedby")).toBeNull();
    });

    it("with only modifier warnings (also under the project rule) one click on Submit with N warnings submits", () => {
      const onConfirm = vi.fn();
      render(<SubmitCaseDialog {...dialogProps({ items: warnings, unconfirmed: [], requireChosenAxes: true, onConfirm })} />);
      fireEvent.click(screen.getByRole("button", { name: "Submit with 2 warnings" }));
      expect(onConfirm).toHaveBeenCalledWith(true);
    });

    it("lists a modifier used as a finding as a modifier warning with Go to", () => {
      const onGoTo = vi.fn();
      render(<SubmitCaseDialog {...dialogProps({ items: standalone, unconfirmed: [], onGoTo })} />);
      const section = screen.getByRole("region", { name: "Modifier warnings" });
      const item = section.querySelector<HTMLElement>('[data-open-item="modifier-as-finding"]')!;
      expect(item.textContent).toContain("Severe is a modifier term. Keep it only if it names the finding itself.");
      fireEvent.click(within(item).getByRole("button", { name: "Go to Severe" }));
      expect(onGoTo).toHaveBeenCalledWith(standalone[0]);
      expect(submitButton().textContent).toBe("Submit with 1 warning");
    });
  });
});

describe("submitLabel and summaryText", () => {
  it("uses the singular for one warning and Submit text without warnings", () => {
    expect(submitLabel(0)).toBe("Submit text");
    expect(submitLabel(1)).toBe("Submit with 1 warning");
    expect(submitLabel(2)).toBe("Submit with 2 warnings");
  });

  it("counts findings and open things with real plurals", () => {
    expect(summaryText(1, 0)).toBe("1 finding, nothing open.");
    expect(summaryText(0, 0)).toBe("0 findings, nothing open.");
    expect(summaryText(2, 1)).toBe("2 findings. 1 thing is still open:");
    expect(summaryText(0, 2)).toBe("0 findings. 2 things are still open:");
  });

  it("names Unresolved proposals among the findings (#248)", () => {
    expect(summaryText(34, 0, 1)).toBe("34 findings, 1 unresolved, nothing open.");
    expect(summaryText(3, 1, 2)).toBe("3 findings, 2 unresolved. 1 thing is still open:");
  });
});
