import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError, type TaskSummary } from "../src/api/client";
import type { RouteLeaveGuard } from "../src/app/router";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewRecord, reviewWorkspace } from "./translationFixtures";
import { decisionConsequences, decisionLabels, decisionOutcomes, issueMessages } from "../src/translation/labels";
import { ShortcutHelpHost, openShortcutHelp } from "../src/ui/ShortcutHelp";
import type { ReviewDecisionCode } from "../src/translation/reviewRules";

import type { AlignRequest, CoupledScrollOptions, CoupledScrollPane, PairsOrigin } from "../src/variants/useCoupledScroll";

type Pairs = ReadonlyArray<{ paneId: string; paragraph: number }>;
/** The real hook, wrapped to record the screen's options and, where a test sets them, to report given pairs. */
const hook = vi.hoisted(() => ({ calls: [] as { panes: readonly CoupledScrollPane[]; options: CoupledScrollOptions }[], pairs: null as Pairs | null, origin: "scroll" as PairsOrigin, aligns: [] as AlignRequest[] }));
vi.mock("../src/variants/useCoupledScroll", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/variants/useCoupledScroll")>();
  return { ...actual, useCoupledScroll: (panes: readonly CoupledScrollPane[], options: CoupledScrollOptions) => {
    hook.calls.push({ panes, options });
    const result = actual.useCoupledScroll(panes, options);
    const align = (request: AlignRequest) => { hook.aligns.push(request); return result.align(request); };
    return { ...result, align, ...(hook.pairs ? { pairs: hook.pairs, origin: hook.origin } : {}) };
  } };
});

afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); hook.calls.length = 0; hook.pairs = null; hook.origin = "scroll"; hook.aligns.length = 0; });
function setup(workspace = reviewWorkspace(), strict = false, viewport?: { width: number; listeners: Set<() => void> }, reportActions?: JSX.Element, guidelineNotice?: JSX.Element, onSubmitted?: (result: { label: string; assignmentId: number; next?: number }) => void) {
  vi.spyOn(api, 'listSourceObligations').mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  const width = () => viewport?.width ?? 1440;
  const evaluate = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query), max = /max-width:\s*(\d+)px/.exec(query);
    return (!min || width() >= Number(min[1])) && (!max || width() <= Number(max[1]));
  };
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ get matches() { return evaluate(query); }, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: (_: string, cb: () => void) => viewport?.listeners.add(cb), removeEventListener: (_: string, cb: () => void) => viewport?.listeners.delete(cb), dispatchEvent: () => true })));
  const open = vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  const save = vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 41 });
  const submit = vi.spyOn(api, "submitTranslationReview").mockResolvedValue(reviewRecord());
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ ...workspace.variant, translation: null, version: 7, assigned_to_me: false });
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const leaveGuardRef: { current: ((proceed: () => void) => void) | null } = { current: null };
  const navigate = vi.fn();
  const element = <TranslationReviewScreen assignmentId={17} username="alice" onNavigate={navigate} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} reportActions={reportActions} guidelineNotice={guidelineNotice} onSubmitted={onSubmitted} />;
  const rendered = render(strict ? <StrictMode>{element}</StrictMode> : element);
  return { ...rendered, open, save, submit, routeLeaveRef, leaveGuardRef, navigate };
}
const submitButton = () => screen.getByRole("button", { name: "Submit review…" }) as HTMLButtonElement;
/** Opens the confirmation and confirms; submitting is immutable, so it is never one click. */
async function confirmSubmit() {
  await act(async () => { fireEvent.click(submitButton()); });
  const dialog = screen.getByRole("dialog", { name: "Submit this review?" });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Submit review" })); });
}
async function clock(ms = 800) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function edited() {
  await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("radio", { name: "Accepted with corrections" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Changed 😀\nraw" } });
}

it("opens the exact source, inherited run and correction baseline with no default decision or initial save", async () => {
  const { save } = setup();
  expect((await screen.findByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement).value).toBe("Übersetzt.");
  expect(screen.getByRole("region", { name: "Source (en)" }).textContent).toContain("Second paragraph.");
  expect(screen.getByText(/Example MT/)).toBeDefined();
  expect(screen.getByRole("heading", { name: "Automatic translation checks" })).toBeDefined();
  const band = screen.getByRole("region", { name: "Automatic translation checks" });
  expect(band.textContent).toContain("1 automatic check failed: Units added in translation");
  expect(screen.queryByText(/A unit changed/)).toBeNull();
  fireEvent.click(within(band).getByRole("button", { name: "Details" }));
  expect(screen.getAllByText(/A unit changed/)).toHaveLength(2);
  expect(screen.getAllByRole("radio").every(n => !(n as HTMLInputElement).checked)).toBe(true);
  expect(submitButton().getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("Choose a decision to submit.")).toBeDefined();
  expect(screen.queryByText(/Selection intent/)).toBeNull();
  vi.useFakeTimers(); await clock(1600);
  expect(save).not.toHaveBeenCalled();
});
it.each(["accepted_unchanged", "accepted_corrected"] as const)("sends a server-valid fresh nonclinical %s form over the actual draft transport", async selected => {
  const { save } = setup(); save.mockRestore();
  const wire: { form: Record<string, unknown>; text: string; expected_revision: number }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/v1/translation-reviews/17/draft");
    wire.push(JSON.parse(init.body as string));
    return { ok: true, status: 200, json: async () => ({ revision: 41 }) };
  }));
  await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  await clock(1600); expect(wire).toEqual([]);
  fireEvent.click(screen.getByRole("radio", { name: decisionLabels[selected] }));
  if (selected === "accepted_corrected") fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Nonclinical correction" } });
  await clock();
  expect(wire).toEqual([{ expected_revision: 6, text: selected === "accepted_corrected" ? "Nonclinical correction" : "Übersetzt.",
    form: selected === "accepted_unchanged" ? { decision: selected, clinical_change: false, categories: [] } : { decision: selected, clinical_change: false } }]);
});
it("autosaves exact raw data once in StrictMode and submits with the actual confirmed revision", async () => {
  const { save, submit } = setup(undefined, true);
  await edited(); await clock(799);
  expect(save).not.toHaveBeenCalled();
  await clock(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenLastCalledWith(17, { expected_revision: 6, text: "Changed 😀\nraw", form: { decision: "accepted_corrected", clinical_change: false } });
  await act(async () => { fireEvent.click(submitButton()); });
  expect(submit).not.toHaveBeenCalled();
  const confirm = within(screen.getByRole("dialog", { name: "Submit this review?" })).getByRole("button", { name: "Submit review" });
  await act(async () => { fireEvent.click(confirm); fireEvent.click(confirm); });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith(17, 41);
  expect(screen.getByText("Review submitted")).toBeDefined();
  expect(screen.getByText("A corrected version v7 was created.")).toBeDefined();
});
it("hides the guidelines notice once the review is submitted here and lists the guideline stamp", async () => {
  const { submit } = setup(undefined, false, undefined, undefined, <p>Guidelines updated to v2</p>);
  submit.mockResolvedValue(reviewRecord({ guideline_version: 2 }));
  await edited(); await clock();
  expect(screen.getByText("Guidelines updated to v2")).toBeDefined();
  await confirmSubmit();
  expect(screen.getByText("Review submitted")).toBeDefined();
  expect(screen.queryByText("Guidelines updated to v2")).toBeNull();
  const summary = screen.getByRole("region", { name: "Submitted review" });
  const row = within(summary).getByText("Guidelines", { selector: "dt" }).parentElement!;
  expect(row.querySelector("dd")?.textContent).toBe("v2");
});
it.each<ReviewDecisionCode>(["accepted_unchanged", "accepted_corrected", "query", "rejected"])("submits a deliberately selected %s through the real form and saver", async decision => {
  const { save, submit } = setup();
  const clinical = decision === "query" || decision === "rejected";
  const text = decision === "accepted_corrected" ? "Corrected text" : "Übersetzt.";
  submit.mockResolvedValue(reviewRecord({ decision, clinical_change: clinical, proposed_text: text,
    categories: clinical ? ["value"] : [], rationale: clinical ? "Check the dose" : null, created_variant_id: null,
    status_after: decision === "query" ? "needs_review" : decision === "rejected" ? "rejected" : "accepted" }));
  await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  fireEvent.click(screen.getByRole("radio", { name: decisionLabels[decision] }));
  if (decision === "accepted_corrected") fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: text } });
  // The fixture failed an automatic check: accepting it unchanged needs a rationale (R-12).
  if (decision === "accepted_unchanged") fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), { target: { value: "Units checked" } });
  if (clinical) {
    expect(screen.queryByRole("checkbox", { name: "Clinically relevant change" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Number or unit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), { target: { value: "Check the dose" } });
  }
  await clock();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(17, expect.objectContaining({ text, form: expect.objectContaining({ decision }) }));
  expect(submitButton().getAttribute("aria-disabled")).toBeNull();
  await confirmSubmit();
  expect(submit).toHaveBeenCalledWith(17, 41);
  expect(screen.getByText("Review submitted")).toBeDefined();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(within(screen.getByRole("region", { name: "Submitted review" })).getAllByText(decisionLabels[decision])[0]).toBeDefined();
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.queryByText(/needs_review|status_after/)).toBeNull();
  expect((screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement).readOnly).toBe(true);
});
it("retains invalid raw form values while changing a visual field and blocks unknown decisions", async () => {
  const workspace = reviewWorkspace({ draft: { revision: 6, text: "Übersetzt.", form: { decision: "invented", clinical_change: "stored-invalid", categories: ["unknown"], rationale: { invalid: true }, extra: "keep" } } });
  const { save } = setup(workspace);
  await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  expect(screen.getAllByRole("radio").every(n => !(n as HTMLInputElement).checked)).toBe(true);
  // Accepted with corrections keeps clinical change and categories, so the invalid raw values stay untouched.
  fireEvent.click(screen.getByRole("radio", { name: "Accepted with corrections" })); await clock();
  expect(save.mock.calls[0][1].form).toEqual({ decision: "accepted_corrected", clinical_change: "stored-invalid", categories: ["unknown"], rationale: { invalid: true }, extra: "keep" });
  expect(submitButton().getAttribute("aria-disabled")).toBe("true");
});
it("retains latest edits after an ordinary save error and retries explicitly", async () => {
  const { save } = setup(); save.mockRejectedValueOnce(new TypeError("Offline"));
  await edited(); await clock();
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Latest retained" } });
  await clock(2000); expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry save" })); });
  expect(save).toHaveBeenLastCalledWith(17, expect.objectContaining({ text: "Latest retained", expected_revision: 6 }));
});
it("stops conflicts and guards beforeunload and route cancellation without losing input", async () => {
  const { save, routeLeaveRef } = setup(); save.mockRejectedValue(new ApiError(409, "Changed elsewhere", "REVISION_CONFLICT"));
  await edited(); await clock();
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Keep this" } }); await clock(2000);
  expect(save).toHaveBeenCalledTimes(1);
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  let leaving!: Promise<boolean>; await act(async () => { leaving = routeLeaveRef.current!(); });
  const dialog = screen.getByRole("dialog", { name: "Changes not saved" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(await leaving).toBe(false);
  expect((screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement).value).toBe("Keep this");
});
it("reloads a conflicted review only after explicit discard and uses the fresh server revision", async () => {
  const { save, open } = setup(); save.mockRejectedValueOnce(new ApiError(409, "Changed elsewhere", "REVISION_CONFLICT"));
  await edited(); await clock();
  open.mockResolvedValue(reviewWorkspace({ draft: { text: "Fresh baseline", form: {}, revision: 87 } }));
  fireEvent.click(screen.getByRole("button", { name: "Reload from server" }));
  await act(async () => { await Promise.resolve(); });
  const dialog = screen.getByRole("dialog", { name: "Changes not saved" });
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Discard edits and leave" })); });
  expect(open).toHaveBeenCalledTimes(2);
  expect((screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement).value).toBe("Fresh baseline");
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "After reopen" } }); await clock();
  // The edit differs from the machine text, so Accepted with corrections is selected automatically (spec A.4).
  expect(save).toHaveBeenLastCalledWith(17, { expected_revision: 87, text: "After reopen", form: { decision: "accepted_corrected", clinical_change: false } });
});
it("preserves ordered server issues and entered data after submit refusal", async () => {
  const { submit } = setup(); submit.mockRejectedValue(new ApiError(422, "Invalid", "REVIEW_INVALID", { issues: ["RATIONALE_REQUIRED", "NEW_SERVER_RULE", "TEXT_EMPTY"] }));
  await edited(); await clock();
  await confirmSubmit();
  const issues = screen.getByRole("list", { name: "Server review issues" });
  expect(within(issues).getAllByRole("listitem").map(n => n.textContent)).toEqual(["A clinical change needs a rationale.", "Review issue: NEW_SERVER_RULE", "The proposed text must not be empty."]);
  expect((screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement).value).toBe("Changed 😀\nraw");
});
it("uses the current immutable submitted record without a saver or write controls", async () => {
  const record = reviewRecord();
  const { save, submit, routeLeaveRef } = setup(reviewWorkspace({ read_only: true, submitted_record: record, previous_reviews: [reviewRecord({ id: 3, proposed_text: "Older review" })] }));
  const input = await screen.findByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement;
  expect(input.value).toBe(record.proposed_text); expect(input.readOnly).toBe(true);
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.queryByRole("button", { name: "Submit review…" })).toBeNull();
  const summary = within(screen.getByRole("region", { name: "Submitted review" }));
  expect(summary.getByText("Accepted with corrections")).toBeDefined();
  expect(summary.getByText("R, Reviewer")).toBeDefined();
  expect(summary.getByText(/^\d{1,2} October 2026 at \d{2}:\d{2}$/)).toBeDefined();
  expect(screen.getByText("Older review")).toBeDefined();
  vi.useFakeTimers(); await clock(1600); expect(save).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  expect(await routeLeaveRef.current!()).toBe(true);
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
});

it("drains edits made during a deferred route flush using each actual returned revision", async () => {
  const { save, routeLeaveRef } = setup();
  let finish!: (value: { revision: number }) => void;
  save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ revision: 29 });
  await edited();
  let leaving!: Promise<boolean>; await act(async () => { leaving = routeLeaveRef.current!(); });
  expect(save).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Latest while saving" } });
  await act(async () => { finish({ revision: 20 }); await leaving; });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(17, expect.objectContaining({ expected_revision: 20, text: "Latest while saving" }));
  expect(await leaving).toBe(true);
});
it("coalesces concurrent failed leave attempts so Cancel resolves every caller", async () => {
  const { save, routeLeaveRef } = setup();
  let reject!: (error: Error) => void;
  save.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await edited();
  const settled: boolean[] = [];
  await act(async () => {
    void routeLeaveRef.current!().then(value => settled.push(value));
    void routeLeaveRef.current!().then(value => settled.push(value));
  });
  await act(async () => { reject(new TypeError("Offline")); });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Changes not saved" })).getByRole("button", { name: "Cancel" }));
  await act(async () => {});
  expect(settled).toEqual([false, false]);
});
it("requires explicit logout choice and never logs out before a save succeeds", async () => {
  const { save, leaveGuardRef } = setup();
  await edited(); const proceed = vi.fn();
  act(() => leaveGuardRef.current!(proceed));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(proceed).not.toHaveBeenCalled();
  save.mockRejectedValueOnce(new TypeError("Offline"));
  act(() => leaveGuardRef.current!(proceed));
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save and log out" })); });
  expect(proceed).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeDefined();
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save and log out" })); });
  expect(proceed).toHaveBeenCalledTimes(1);
});
it("refreshes current qualification after server refusal while preserving edited data", async () => {
  const { submit } = setup();
  submit.mockRejectedValue(new ApiError(422, "Qualification required", "QUALIFICATION_REQUIRED"));
  const profile = vi.spyOn(api, "getProfile").mockResolvedValue({ username: "alice", display_name: "Alice", pseudonym: "R", email: null, orcid: null, orcid_consent: false, languages: ["en", "de"], qualification: null });
  await edited(); await clock();
  await confirmSubmit();
  expect(profile).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Add your qualification in your profile" }).getAttribute("href")).toBe("#/me");
  expect(submitButton().getAttribute("aria-disabled")).toBe("true");
  expect((screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement).value).toBe("Changed 😀\nraw");
});
it("clinical-off clears categories through the actual controlled form but retains rationale", async () => {
  const workspace = reviewWorkspace({ draft: { revision: 6, text: "Changed", form: { decision: "accepted_corrected", clinical_change: true, categories: ["omission"], rationale: "Keep rationale" } } });
  const { save } = setup(workspace);
  await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  fireEvent.click(screen.getByRole("checkbox", { name: "Clinically relevant change" })); await clock();
  expect(save).toHaveBeenCalledWith(17, { expected_revision: 6, text: "Changed", form: { decision: "accepted_corrected", clinical_change: false, categories: [], rationale: "Keep rationale" } });
});
const COUPLING_NOTE = "Paragraphs are paired by position, not by meaning. Merged or split paragraphs shift the pairing.";
const EDITING_NOTE = "While you edit, only the other texts follow your translation.";
/** The Comparison pane starts closed; "Compare with …" opens it, as a menu of the choices when there are several. */
const openComparison = (item?: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: /^Compare with/ }));
  if (item) fireEvent.click(screen.getByRole("menuitem", { name: item }));
};
const coupleBox = () => screen.queryByRole<HTMLInputElement>("checkbox", { name: "Couple scrolling" });
const translationBox = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Translation (de)" });
const typeTranslation = (value: string) => fireEvent.change(translationBox(), { target: { value } });
const lastOptions = () => hook.calls.at(-1)!.options;
const targetStarts = () => {
  const starts = hook.calls.at(-1)!.panes.find(pane => pane.id === "target")!.starts;
  return typeof starts === "function" ? starts() : starts;
};
it("offers Couple scrolling beside the editable translation, unchecked by default", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  const box = coupleBox()!;
  expect(box.checked).toBe(false); expect(box.disabled).toBe(false);
  expect(box.closest(".translation-tools")).not.toBeNull();
  expect(translationBox().readOnly).toBe(false);
  expect(screen.queryByText(COUPLING_NOTE)).toBeNull();
  fireEvent.click(box);
  expect(coupleBox()!.checked).toBe(true);
  expect(screen.getByText(COUPLING_NOTE)).toBeDefined();
  expect(screen.getByRole("status", { name: "Paragraph pairing" })).toBeDefined();
});
it("keeps the request across edits and Show changes", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(coupleBox()!);
  typeTranslation("Changed");
  expect(coupleBox()!.checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
  expect(coupleBox()!.checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
  expect(coupleBox()!.checked).toBe(true);
  typeTranslation("Changed again");
  expect(coupleBox()!.checked).toBe(true);
});
it("resets the request on comparison change, reload and submit", async () => {
  const workspace = reviewWorkspace({ comparisons: [
    { variant: { ...reviewWorkspace().variant, document_id: "comparison-1", external_id: "First MT" }, text: "First comparison" },
    { variant: { ...reviewWorkspace().variant, document_id: "comparison-2", external_id: "Second MT" }, text: "Second comparison" }] });
  const { open } = setup(workspace); await screen.findByRole("textbox", { name: "Translation (de)" });
  openComparison(/^First MT/);
  fireEvent.click(coupleBox()!);
  fireEvent.click(screen.getByRole("button", { name: "Close comparison" })); openComparison(/^Second MT/);
  expect(screen.getByText("Second comparison")).toBeDefined();
  expect(coupleBox()!.checked).toBe(false);
  fireEvent.click(coupleBox()!);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reload from server" })); });
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(open).toHaveBeenCalledTimes(2);
  expect(coupleBox()!.checked).toBe(false);
  fireEvent.click(coupleBox()!);
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("radio", { name: "Accepted with corrections" }));
  typeTranslation("Corrected");
  await clock();
  expect(coupleBox()!.checked).toBe(true);
  await confirmSubmit();
  expect(screen.getByText("Review submitted")).toBeDefined();
  expect(coupleBox()!.checked).toBe(false);
});
it("passes fixedLeader target only while the editable translation is shown", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(lastOptions()).toMatchObject({ minWidth: 700, fixedLeader: "target", frozenPaneId: "target" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
  expect(lastOptions().minWidth).toBe(700);
  expect(lastOptions().fixedLeader).toBeUndefined(); expect(lastOptions().frozenPaneId).toBeUndefined();
  cleanup(); hook.calls.length = 0;
  setup(reviewWorkspace({ read_only: true, submitted_record: reviewRecord() })); await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(lastOptions().fixedLeader).toBeUndefined(); expect(lastOptions().frozenPaneId).toBeUndefined();
});
it("recomputes translation starts 300 ms after the last edit, at once on blur, and not during composition", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  fireEvent.click(coupleBox()!);
  const revision = () => lastOptions().startsRevision ?? 0;
  const before = revision();
  const differ = (translation: number) => `Paragraphs differ (source 2, translation ${translation}); the other text may show a neighbouring paragraph.`;
  expect(screen.getByText(differ(1))).toBeDefined();
  fireEvent.compositionStart(translationBox());
  typeTranslation("A\n\nB");
  await clock(500);
  expect(targetStarts()).toEqual([0]); expect(revision()).toBe(before);
  expect(screen.getByText(differ(1))).toBeDefined();
  fireEvent.compositionEnd(translationBox());
  await clock(299);
  expect(targetStarts()).toEqual([0]);
  await clock(1);
  expect(targetStarts()).toEqual([0, 3]); expect(revision()).toBe(before + 1);
  expect(screen.queryByText(differ(1))).toBeNull();
  typeTranslation("A\n\nB\n\nC");
  await clock(200);
  typeTranslation("A\n\nB\n\nC\n\nD");
  await clock(200);
  expect(targetStarts()).toEqual([0, 3]);
  await clock(100);
  expect(targetStarts()).toEqual([0, 3, 6, 9]);
  expect(screen.getByText(differ(4))).toBeDefined();
  typeTranslation("A");
  fireEvent.blur(translationBox());
  expect(targetStarts()).toEqual([0]);
  expect(screen.getByText(differ(1))).toBeDefined();
});
it("a recompute never changes selectionStart or the translation scrollTop", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  fireEvent.click(coupleBox()!);
  const editor = translationBox().closest<HTMLElement>(".translation-editor")!;
  const writes: number[] = [];
  Object.defineProperty(editor, "scrollTop", { configurable: true, get: () => 40, set: (value: number) => { writes.push(value); } });
  typeTranslation("First\n\nSecond\n\nThird");
  translationBox().setSelectionRange(9, 11);
  const revision = lastOptions().startsRevision ?? 0;
  await clock(300);
  expect(lastOptions().startsRevision).toBe(revision + 1);
  expect(translationBox().selectionStart).toBe(9); expect(translationBox().selectionEnd).toBe(11);
  expect(writes).toEqual([]);
});
it("shows the always note and the editing note while coupled and editing", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.queryByText(EDITING_NOTE)).toBeNull();
  fireEvent.click(coupleBox()!);
  expect(screen.getByText(COUPLING_NOTE)).toBeDefined();
  expect(screen.getByText(EDITING_NOTE)).toBeDefined();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
  expect(screen.getByText(COUPLING_NOTE)).toBeDefined();
  expect(screen.queryByText(EDITING_NOTE)).toBeNull();
  expect(screen.queryByText("Paragraphs are paired by position, not by meaning")).toBeNull();
});
it("names both counts when they differ", async () => {
  const workspace = reviewWorkspace({ comparisons: [{ variant: { ...reviewWorkspace().variant, document_id: "comparison-1", external_id: "First MT" }, text: "One\n\nTwo\n\nThree" }] });
  setup(workspace); await screen.findByRole("textbox", { name: "Translation (de)" });
  openComparison(); fireEvent.click(coupleBox()!);
  expect(screen.getByText("Paragraphs differ (source 2, translation 1); the other text may show a neighbouring paragraph.")).toBeDefined();
  expect(screen.getByText("Paragraphs differ (translation 1, comparison 3); the other text may show a neighbouring paragraph.")).toBeDefined();
  expect(screen.queryByText(/scrolling is approximate/)).toBeNull();
});
it("announces a count change from edits once", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  fireEvent.click(coupleBox()!);
  const changedNote = "Your edits changed the number of paragraphs (1 → 2). Pairing after that point may be off.";
  expect(screen.queryByText(changedNote)).toBeNull();
  typeTranslation("A\n\nB");
  await clock(300);
  const note = screen.getByText(changedNote);
  expect(note.closest("[aria-live='polite']")).not.toBeNull();
  typeTranslation("A\n\nBB");
  await clock(300);
  expect(screen.getAllByText(changedNote)).toHaveLength(1);
  expect(screen.getByText(changedNote)).toBe(note);
  typeTranslation("Back to one");
  await clock(300);
  expect(screen.queryByText(changedNote)).toBeNull();
});
it("updates the pair line only after scrolling rests for 150 ms", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  fireEvent.click(coupleBox()!);
  const line = () => screen.getByRole("status", { name: "Paragraph pairing" }).textContent;
  hook.pairs = [{ paneId: "source", paragraph: 0 }, { paneId: "target", paragraph: 0 }];
  typeTranslation("Changed");
  await clock(149);
  expect(line()).toBe("");
  await clock(1);
  expect(line()).toBe("Source paragraph 1 ↔ Translation paragraph 1");
  hook.pairs = [{ paneId: "source", paragraph: 1 }, { paneId: "target", paragraph: 0 }];
  typeTranslation("Changed again");
  await clock(100);
  hook.pairs = [{ paneId: "source", paragraph: 1 }, { paneId: "target", paragraph: 1 }];
  typeTranslation("Changed once more");
  await clock(100);
  expect(line()).toBe("Source paragraph 1 ↔ Translation paragraph 1");
  await clock(50);
  expect(line()).toBe("Source paragraph 2 ↔ Translation paragraph 2");
});
it("keeps the pair line on a recompute or align and updates it only after a scroll", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  fireEvent.click(coupleBox()!);
  const line = () => screen.getByRole("status", { name: "Paragraph pairing" }).textContent;
  hook.pairs = [{ paneId: "source", paragraph: 0 }, { paneId: "target", paragraph: 0 }];
  typeTranslation("Changed");
  await clock(150);
  expect(line()).toBe("Source paragraph 1 ↔ Translation paragraph 1");
  for (const origin of ["refresh", "align"] as const) {
    hook.origin = origin; hook.pairs = [{ paneId: "source", paragraph: 1 }, { paneId: "target", paragraph: 1 }];
    typeTranslation(`Changed by ${origin}`);
    await clock(300);
    expect(line()).toBe("Source paragraph 1 ↔ Translation paragraph 1");
  }
  hook.origin = "scroll"; hook.pairs = [{ paneId: "source", paragraph: 1 }, { paneId: "target", paragraph: 1 }];
  typeTranslation("Scrolled");
  await clock(150);
  expect(line()).toBe("Source paragraph 2 ↔ Translation paragraph 2");
});
it("puts the coupling notes in one line spanning the text columns, outside every column head", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(coupleBox()!);
  const hint = screen.getByText(COUPLING_NOTE).closest<HTMLElement>(".translation-column-hint")!;
  expect(hint.parentElement!.classList.contains("translation-columns")).toBe(true);
  expect(hint.closest(".translation-column-head")).toBeNull();
  expect(screen.getByRole("status", { name: "Paragraph pairing" }).closest(".translation-column-hint")).toBe(hint);
  expect(screen.getByText(EDITING_NOTE).closest(".translation-column-hint")).toBe(hint);
});
const FIVE = "One 😀\n\nTwo\n\nThree\n\nFour\n\nFive";
const comparisonRow = (text = FIVE) => ({ variant: { ...reviewWorkspace().variant, document_id: "comparison-1", external_id: "First MT" }, text });
const matchingWorkspace = (changes: Parameters<typeof reviewWorkspace>[0] = {}) => reviewWorkspace({ text: FIVE, draft: { text: FIVE, form: {}, revision: 6 },
  source: { ...reviewWorkspace().source, text: "S one\n\nS two\n\nS three\n\nS four\n\nS five" }, ...changes });
const matchingButton = () => screen.getByRole("button", { name: "Show matching paragraph" });
const rectAt = (top: number) => ({ top, bottom: top + 20, left: 0, right: 100, x: 0, y: top, width: 100, height: 20, toJSON: () => ({}) }) as DOMRect;
/** Places the paragraph markers of a pane at the given viewport tops; the pane itself starts at 0. */
const placeMarkers = (pane: HTMLElement, tops: number[]) => [...pane.querySelectorAll<HTMLElement>("[data-paragraph]")]
  .forEach((marker, index) => { vi.spyOn(marker, "getBoundingClientRect").mockReturnValue(rectAt(tops[index] ?? 0)); });
const caretIn = (offset: number) => { const box = translationBox(); act(() => box.focus()); box.setSelectionRange(offset, offset); return box; };
const altM = (target: Element | Document = translationBox(), key = "m") => fireEvent.keyDown(target, { key, code: "KeyM", altKey: true });
it("Show matching paragraph sits after Show changes and Couple scrolling with Kbd Alt M", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  const showChanges = screen.getByRole("checkbox", { name: "Show changes" }), button = matchingButton();
  expect(screen.getAllByRole("button", { name: "Show matching paragraph" })).toHaveLength(1);
  expect(button.closest(".translation-tools")).toBe(showChanges.closest(".translation-tools"));
  expect(showChanges.compareDocumentPosition(coupleBox()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(coupleBox()!.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Visibly a button (bordered secondary), not a text link.
  expect(button.className).toContain("btn-secondary"); expect(button.className).toContain("btn-sm");
  expect(button.querySelector("kbd")?.textContent).toBe("Alt M");
  expect(button.querySelector("kbd")?.closest("[aria-hidden='true']")).not.toBeNull();
  expect(button.title).toBe("Scroll the other text to the paragraph paired with the one at your cursor or the one you clicked.");
  expect(button.getAttribute("aria-disabled")).toBeNull();
  expect(button.getAttribute("aria-keyshortcuts")).toBe("Alt+M");
});
it("the Comparison pane starts closed, opens from the Translation controls and is remembered; its head puts the title first", async () => {
  setup(matchingWorkspace({ comparisons: [comparisonRow()] })); await screen.findByRole("textbox", { name: "Translation (de)" });
  const heads = () => [...document.querySelectorAll<HTMLElement>(".translation-column-head")];
  expect(heads()).toHaveLength(2);
  const compare = screen.getByRole("button", { name: "Compare with First MT de" });
  expect(compare.closest(".translation-tools")).not.toBeNull();
  fireEvent.click(compare);
  expect(heads()).toHaveLength(3);
  for (const head of heads()) expect(head.firstElementChild!.classList.contains("translation-column-title")).toBe(true);
  expect(heads()[2].querySelector("label")).toBeNull();
  const close = screen.getByRole("button", { name: "Close comparison" });
  expect(close.closest(".translation-column-controls")).toBe(heads()[2].querySelector(".translation-column-controls"));
  expect(screen.queryByRole("button", { name: /^Compare with/ })).toBeNull();
  // Remembered for the next review: open again on a new mount.
  cleanup(); setup(matchingWorkspace({ comparisons: [comparisonRow()] })); await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(heads()).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Close comparison" }));
  expect(heads()).toHaveLength(2);
});
it("anchor 1: from the textarea uses the caret paragraph with fresh starts", async () => {
  setup(matchingWorkspace({ comparisons: [comparisonRow()] })); await screen.findByRole("textbox", { name: "Translation (de)" }); openComparison();
  vi.useFakeTimers();
  const edited = `${FIVE}\n\nSix`;
  typeTranslation(edited);
  const revision = lastOptions().startsRevision ?? 0;
  expect(targetStarts()).toHaveLength(5);
  caretIn(edited.indexOf("Four") + 2);
  altM();
  expect(lastOptions().startsRevision).toBe(revision + 1);
  expect(targetStarts()).toHaveLength(6);
  expect(hook.aligns).toHaveLength(1);
  expect(hook.aligns[0]).toMatchObject({ anchor: { paneId: "target", paragraph: 3 }, targets: ["source", "comparison"], topInset: 12 });
  // The caret offset counts code points: the emoji in paragraph 1 is two UTF-16 units but one character.
  caretIn(edited.indexOf("Four") - 1);
  altM();
  expect(hook.aligns[1].anchor).toEqual({ paneId: "target", paragraph: 2 });
});
it("anchor 2: the last click in the source uses the last marker above the click point", async () => {
  setup(matchingWorkspace({ comparisons: [comparisonRow()] })); await screen.findByRole("textbox", { name: "Translation (de)" }); openComparison();
  const source = screen.getByRole("region", { name: "Source (en)" });
  placeMarkers(source, [-50, 50, 150, 250, 350]);
  fireEvent(source.querySelector("[data-diff-op]")!, new MouseEvent("pointerdown", { bubbles: true, clientY: 175 }));
  fireEvent.click(matchingButton());
  expect(hook.aligns).toHaveLength(1);
  expect(hook.aligns[0]).toMatchObject({ anchor: { paneId: "source", paragraph: 2 }, targets: ["target", "comparison"], anchorOffset: 150 });
});
it("anchor 3: otherwise the paragraph at the top of the last focused or scrolled pane", async () => {
  setup(matchingWorkspace()); await screen.findByRole("textbox", { name: "Translation (de)" });
  const source = screen.getByRole("region", { name: "Source (en)" });
  placeMarkers(source, [-120, -20, 80, 180, 280]);
  act(() => source.focus());
  fireEvent.click(matchingButton());
  expect(hook.aligns[0]).toMatchObject({ anchor: { paneId: "source", paragraph: 1 }, targets: ["target"], anchorOffset: -20 });
  act(() => source.blur());
  const editor = translationBox().closest<HTMLElement>(".translation-editor")!;
  placeMarkers(editor, [-300, -200, -100, 40, 140]);
  fireEvent.wheel(editor);
  fireEvent.click(matchingButton());
  expect(hook.aligns[1]).toMatchObject({ anchor: { paneId: "target", paragraph: 2 }, targets: ["source"], anchorOffset: -100 });
});
it("keeps focus, caret and selection", async () => {
  setup(matchingWorkspace()); await screen.findByRole("textbox", { name: "Translation (de)" });
  const box = translationBox(); act(() => box.focus()); box.setSelectionRange(5, 8);
  const editor = box.closest<HTMLElement>(".translation-editor")!;
  const writes: number[] = [];
  Object.defineProperty(editor, "scrollTop", { configurable: true, get: () => 0, set: (value: number) => { writes.push(value); } });
  expect(fireEvent.mouseDown(matchingButton())).toBe(false);
  fireEvent.click(matchingButton());
  expect(hook.aligns).toHaveLength(1);
  expect(document.activeElement).toBe(box);
  expect(box.selectionStart).toBe(5); expect(box.selectionEnd).toBe(8);
  expect(writes).toEqual([]);
});
it("announces the result in the polite status", async () => {
  setup(matchingWorkspace()); await screen.findByRole("textbox", { name: "Translation (de)" });
  caretIn(FIVE.indexOf("Four") + 1);
  fireEvent.click(matchingButton());
  const status = screen.getByText("Source paragraph 4 is shown next to translation paragraph 4.");
  expect(status.getAttribute("role")).toBe("status");
  expect([...document.querySelectorAll("[role='status'], [aria-live]")].filter(node => node.textContent?.includes("is shown next to"))).toHaveLength(1);
  vi.useFakeTimers();
  const edited = `${FIVE}\n\nSix`;
  typeTranslation(edited);
  caretIn(edited.indexOf("Four") + 1);
  fireEvent.click(matchingButton());
  expect(status.textContent).toBe("Source paragraph 3 is shown next to translation paragraph 4. Paragraph counts differ, so this is an estimate.");
});
it("announces a repeated identical result again: cleared, then set on the next frame", async () => {
  setup(matchingWorkspace()); await screen.findByRole("textbox", { name: "Translation (de)" });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  caretIn(FIVE.indexOf("Four") + 1);
  altM();
  const text = "Source paragraph 4 is shown next to translation paragraph 4.";
  const status = screen.getByText(text);
  expect(frames).toHaveLength(0);
  altM();
  expect(status.textContent).toBe("");
  expect(frames).toHaveLength(1);
  act(() => frames[0](0));
  expect(status.textContent).toBe(text);
});
it("Alt+M works from the textarea, also via event.code, and types nothing", async () => {
  setup(matchingWorkspace()); await screen.findByRole("textbox", { name: "Translation (de)" });
  const box = caretIn(FIVE.indexOf("Two"));
  expect(altM(box)).toBe(false);
  expect(hook.aligns).toHaveLength(1);
  expect(altM(box, "µ")).toBe(false);
  expect(hook.aligns).toHaveLength(2);
  expect(hook.aligns[1].anchor).toEqual({ paneId: "target", paragraph: 1 });
  expect(fireEvent.keyDown(box, { key: "m", code: "KeyM" })).toBe(true);
  expect(hook.aligns).toHaveLength(2);
  expect(box.value).toBe(FIVE);
  expect(document.activeElement).toBe(box);
});
it("Alt+M does nothing while a dialog is open", async () => {
  setup(matchingWorkspace());
  render(<ShortcutHelpHost />);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  act(openShortcutHelp);
  expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();
  expect(altM(document.body)).toBe(true);
  expect(hook.aligns).toHaveLength(0);
});
it("help lists Alt+M in group Translation review", async () => {
  setup();
  render(<ShortcutHelpHost />);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  act(openShortcutHelp);
  const group = screen.getByRole("heading", { name: "Translation review" }).closest("section") as HTMLElement;
  const row = within(group).getByText("Show the paragraph paired with the one at your cursor").parentElement!;
  expect(row.querySelector("dt")?.textContent).toBe("Alt+M");
});
it("below 700 px the action scrolls the target into view with block nearest", async () => {
  setup(matchingWorkspace(), false, { width: 699, listeners: new Set() });
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(coupleBox()).toBeNull();
  const source = screen.getByRole("region", { name: "Source (en)" });
  const into = vi.fn(); source.scrollIntoView = into;
  const box = caretIn(FIVE.indexOf("Four"));
  altM(box);
  expect(hook.aligns).toHaveLength(1);
  expect(into).toHaveBeenCalledWith({ block: "nearest" });
  expect(document.activeElement).toBe(box);
  cleanup(); hook.aligns.length = 0;
  setup(matchingWorkspace());
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const wideSource = screen.getByRole("region", { name: "Source (en)" });
  const wideInto = vi.fn(); wideSource.scrollIntoView = wideInto;
  altM(caretIn(FIVE.indexOf("Four")));
  expect(hook.aligns).toHaveLength(1);
  expect(wideInto).not.toHaveBeenCalled();
});
it("works with coupling off and while busy", async () => {
  const { submit } = setup(matchingWorkspace()); await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(coupleBox()!.checked).toBe(false);
  altM(caretIn(FIVE.indexOf("Three")));
  expect(hook.aligns).toHaveLength(1);
  expect(screen.getByText("Source paragraph 3 is shown next to translation paragraph 3.")).toBeDefined();
  vi.useFakeTimers();
  submit.mockReturnValue(new Promise(() => {}));
  fireEvent.click(radio("Accepted unchanged"));
  fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), { target: { value: "Units checked" } });
  await clock();
  await act(async () => { fireEvent.click(submitButton()); });
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "Submit this review?" })).getByRole("button", { name: "Submit review" })); });
  expect(translationBox().disabled).toBe(true);
  expect(matchingButton().getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(matchingButton());
  expect(hook.aligns).toHaveLength(2);
});
it("uses only the workspace's comparison choices and shows passed inherited checks on demand", async () => {
  const workspace = reviewWorkspace();
  workspace.translation_ancestor.translation = { ...workspace.translation_ancestor.translation, checks: [{ code: "units_added", passed: false, detail: "A unit changed" }, { code: "numbers", passed: true }] };
  workspace.comparisons = [{ variant: { ...workspace.variant, document_id: "comparison-1", external_id: "First MT" }, text: "First comparison" }, { variant: { ...workspace.variant, document_id: "comparison-2", external_id: "Second MT" }, text: "Second comparison" }];
  setup(workspace); await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.queryByText("First comparison")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Compare with…" }));
  expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["First MT de", "Second MT de"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "First MT de" })); expect(screen.getByText("First comparison")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Close comparison" })); openComparison(/^Second MT/);
  expect(screen.getByText("Second comparison")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  const all = screen.getByText("Show all checks").closest("details") as HTMLDetailsElement;
  expect(all.open).toBe(false);
  expect(within(all).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Failed Units added in translation: A unit changedTechnical codeunits_added", "Passed NumbersTechnical codenumbers"]);
});
it("disposes an unmounted draft timer and ignores late workspace data after identity changes", async () => {
  const { unmount, save } = setup(); await edited(); unmount(); await clock(1600); expect(save).not.toHaveBeenCalled();
  vi.useRealTimers();
  let old!: (value: ReturnType<typeof reviewWorkspace>) => void;
  vi.mocked(api.openTranslationReview).mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce(reviewWorkspace({ draft: { text: "Bob draft", form: {}, revision: 3 } }));
  const refs = { current: null };
  const mounted = render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={refs} leaveGuardRef={{ current: null }} />);
  mounted.rerender(<TranslationReviewScreen assignmentId={18} username="bob" onNavigate={vi.fn()} routeLeaveRef={refs} leaveGuardRef={{ current: null }} />);
  await screen.findByDisplayValue("Bob draft");
  await act(async () => { old(reviewWorkspace({ draft: { text: "Private Alice draft", form: {}, revision: 9 } })); });
  expect(screen.queryByDisplayValue("Private Alice draft")).toBeNull(); expect(screen.getByDisplayValue("Bob draft")).toBeDefined();
});
it("preserves raw input on stale-predecessor refusal and never rebases or creates a client version", async () => {
  const { submit } = setup(); submit.mockRejectedValue(new ApiError(409, "A newer text version exists. Reload the review.", "VARIANT_REVIEW_STALE"));
  await edited(); await clock();
  await confirmSubmit();
  expect(screen.getByText(/A newer text version exists/)).toBeDefined();
  expect((screen.getByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement).value).toBe("Changed 😀\nraw");
  expect(api.getVariantMetadata).not.toHaveBeenCalled();
});
it("always lists Ctrl+Enter in help; it explains a blocked submit and otherwise only opens the confirmation", async () => {
  const { submit } = setup();
  render(<ShortcutHelpHost />);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  act(openShortcutHelp);
  expect(screen.getByText("Submit review (asks for confirmation)")).toBeDefined();
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Choose a decision to submit.");
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("radio", { name: "Accepted unchanged" })); await clock();
  // R-12: the failed check blocks an unchanged accept until the rationale says why.
  expect(submitButton().getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText(issueMessages.CHECK_RATIONALE_REQUIRED)).toBeDefined();
  fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), { target: { value: "Units checked" } }); await clock();
  expect(submitButton().getAttribute("aria-disabled")).toBeNull();
  (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  const dialog = screen.getByRole("dialog", { name: "Submit this review?" });
  expect(dialog.textContent).toContain("1 automatic check failed: Units added in translation.");
  expect(dialog.textContent).toContain(decisionConsequences.accepted_unchanged);
  expect(dialog.textContent).toContain("A submitted review cannot be changed later.");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(submitButton());
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});
it("summarises decision, categories and a rationale excerpt before submitting, then reports the outcome in words", async () => {
  const rationale = `The dose differs. ${"Long explanation ".repeat(20)}`;
  const { submit } = setup(reviewWorkspace({ draft: { revision: 6, text: "Übersetzt.", form: { decision: "query", clinical_change: true, categories: ["value", "omission"], rationale } } }));
  submit.mockResolvedValue(reviewRecord({ decision: "query", clinical_change: true, categories: ["omission", "value"], rationale, proposed_text: "Übersetzt.", created_variant_id: null, status_after: "reviewed" }));
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(submitButton());
  const dialog = within(screen.getByRole("dialog", { name: "Submit this review?" }));
  expect(dialog.getByText("Query")).toBeDefined();
  expect(dialog.getByText("Yes: Number or unit, Omission")).toBeDefined();
  const excerpt = dialog.getByText(/^The dose differs\./).textContent!;
  expect(excerpt.endsWith("…")).toBe(true); expect(Array.from(excerpt).length).toBeLessThanOrEqual(161);
  expect(dialog.getByText(decisionConsequences.query)).toBeDefined();
  await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Submit review" })); });
  expect(submit).toHaveBeenCalledWith(17, 6);
  expect(screen.getByText(decisionOutcomes.query)).toBeDefined();
  const summary = within(screen.getByRole("region", { name: "Submitted review" }));
  expect(summary.getByText("Reviewed")).toBeDefined();
  expect(screen.queryByText("reviewed")).toBeNull();
});
it("explains a blocked submit right at the button with the rules' own issues", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(document.getElementById(submitButton().getAttribute("aria-describedby")!)?.textContent).toBe("Choose a decision to submit.");
  fireEvent.click(screen.getByRole("radio", { name: "Query" }));
  const issues = screen.getByRole("list", { name: "Review issues" });
  expect(within(issues).getAllByRole("listitem").map(item => item.textContent)).toEqual([issueMessages.CATEGORY_REQUIRED, issueMessages.RATIONALE_REQUIRED]);
  expect(issues.closest(".translation-decision-footer")?.contains(submitButton())).toBe(true);
  expect(screen.getAllByRole("list", { name: "Review issues" })).toHaveLength(1);
  expect(submitButton().getAttribute("aria-disabled")).toBe("true");
});

it('allows explicit coupling on a submitted read-only target',async()=>{
  setup(reviewWorkspace({read_only:true,submitted_record:reviewRecord()}));
  await screen.findByRole('textbox',{name:'Translation (de)'});
  const box=screen.getByRole<HTMLInputElement>('checkbox',{name:'Couple scrolling'});
  expect(box.disabled).toBe(false);expect(box.checked).toBe(false);fireEvent.click(box);expect(box.checked).toBe(true);
  expect(screen.getByText(COUPLING_NOTE)).toBeDefined();
  expect(screen.queryByText(EDITING_NOTE)).toBeNull();
});

it.each([
  ["a read-only target", () => reviewWorkspace({ read_only: true, submitted_record: reviewRecord() })],
  ["the editable translation", () => reviewWorkspace()],
])("offers coupling at 800 px and hides it below 700 px, keeping the request (%s)", async (_, workspace) => {
  const viewport = { width: 800, listeners: new Set<() => void>() };
  const resize = (width: number) => act(() => { viewport.width = width; viewport.listeners.forEach(listener => listener()); });
  setup(workspace(), false, viewport);
  await screen.findByRole('textbox', { name: 'Translation (de)' });
  const couple = () => screen.queryByRole<HTMLInputElement>('checkbox', { name: 'Couple scrolling' });
  expect(couple()!.checked).toBe(false);
  fireEvent.click(couple()!);
  expect(screen.getByRole('status', { name: 'Paragraph pairing' })).toBeDefined();
  resize(699);
  expect(couple()).toBeNull();
  expect(screen.queryByText(/widen/i)).toBeNull();
  expect(screen.queryByText(COUPLING_NOTE)).toBeNull();
  expect(screen.queryByRole('status', { name: 'Paragraph pairing' })).toBeNull();
  resize(700);
  expect(couple()!.checked).toBe(true);
});

const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const SELECTED_NOTE = "Selected because you edited the translation. You can choose another decision.";
it("auto-selects Accepted with corrections on the first edit, announces it once and reverts when the edit is undone", async () => {
  const { save } = setup();
  const input = await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  fireEvent.change(input, { target: { value: "Übersetzt!" } });
  expect(radio("Accepted with corrections").checked).toBe(true);
  const status = screen.getByText(SELECTED_NOTE);
  expect(status.getAttribute("role")).toBe("status");
  fireEvent.change(input, { target: { value: "Übersetzt!!" } });
  expect(screen.getAllByText(SELECTED_NOTE)).toEqual([status]);
  fireEvent.change(input, { target: { value: "Übersetzt." } });
  expect(screen.getAllByRole("radio").every(n => !(n as HTMLInputElement).checked)).toBe(true);
  expect(screen.queryByText(SELECTED_NOTE)).toBeNull();
  expect(screen.getByText("Your edits are undone, so the decision is back to not chosen.")).toBeDefined();
  await clock();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][1].text).toBe("Übersetzt.");
  expect(save.mock.calls[0][1].form).not.toHaveProperty("decision");
});
it("names a replaced Accepted unchanged and drops the note once the reviewer picks a decision", async () => {
  const { save } = setup();
  const input = await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  fireEvent.click(radio("Accepted unchanged"));
  fireEvent.change(input, { target: { value: "Übersetzt!" } });
  expect(radio("Accepted with corrections").checked).toBe(true);
  expect(screen.getByText("Changed from Accepted unchanged because you edited the translation.")).toBeDefined();
  await clock();
  expect(save).toHaveBeenLastCalledWith(17, { expected_revision: 6, text: "Übersetzt!", form: { decision: "accepted_corrected", clinical_change: false, categories: [] } });
  fireEvent.change(input, { target: { value: "Übersetzt." } });
  expect(radio("Accepted unchanged").checked).toBe(true);
  expect(screen.getByText("Your edits are undone, so the decision is back to Accepted unchanged.")).toBeDefined();
  fireEvent.change(input, { target: { value: "Übersetzt?" } });
  fireEvent.click(radio("Query"));
  expect(screen.queryByText(/because you edited the translation|Your edits are undone/)).toBeNull();
  fireEvent.change(input, { target: { value: "Übersetzt." } });
  expect(radio("Query").checked).toBe(true);
});
it("offers a way out when Accepted unchanged meets edited text", async () => {
  setup();
  const input = await screen.findByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "Übersetzt!" } });
  fireEvent.click(radio("Accepted unchanged"));
  expect(screen.getAllByText("You edited the text. Choose Accepted with corrections, or undo your edits.").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Undo my edits" }));
  expect(input.value).toBe("Übersetzt.");
  expect(radio("Accepted unchanged").checked).toBe(true);
  expect(screen.queryByRole("button", { name: "Undo my edits" })).toBeNull();
  fireEvent.change(input, { target: { value: "Übersetzt!" } });
  fireEvent.click(radio("Accepted unchanged"));
  fireEvent.click(screen.getByRole("button", { name: "Choose Accepted with corrections" }));
  expect(radio("Accepted with corrections").checked).toBe(true);
  expect(input.value).toBe("Übersetzt!");
});
it("treats a stored decision as chosen by the user after reload", async () => {
  setup(reviewWorkspace({ draft: { revision: 6, text: "Übersetzt.", form: { decision: "accepted_corrected", clinical_change: false } } }));
  const input = await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.queryByText(/because you edited the translation|Your edits are undone/)).toBeNull();
  const footer = document.querySelector(".translation-decision-footer") as HTMLElement;
  expect(within(footer).getByText("Accepted with corrections needs changed text.")).toBeDefined();
  fireEvent.change(input, { target: { value: "Übersetzt!" } });
  fireEvent.change(input, { target: { value: "Übersetzt." } });
  expect(radio("Accepted with corrections").checked).toBe(true);
  expect(screen.queryByText(/because you edited the translation|Your edits are undone/)).toBeNull();
  expect(within(footer).getByText("Accepted with corrections needs changed text.")).toBeDefined();
});
it("keys 1 to 4 choose decisions outside text fields and never inside the translation or rationale", async () => {
  setup();
  const input = await screen.findByRole("textbox", { name: "Translation (de)" }) as HTMLTextAreaElement;
  fireEvent.keyDown(document.body, { key: "3" });
  expect(radio("Query").checked).toBe(true);
  expect(screen.getByText("Clinically relevant change: yes, always for a query.")).toBeDefined();
  input.focus(); fireEvent.keyDown(input, { key: "1" });
  expect(radio("Query").checked).toBe(true);
  expect(input.value).toBe("Übersetzt.");
  const rationale = screen.getByRole("textbox", { name: "Rationale" });
  rationale.focus(); fireEvent.keyDown(rationale, { key: "4" });
  expect(radio("Query").checked).toBe(true);
  expect(document.activeElement).toBe(rationale);
  fireEvent.keyDown(radio("Query"), { key: "4" });
  expect(radio("Rejected").checked).toBe(true);
  fireEvent.keyDown(document.body, { key: "1" });
  expect(radio("Accepted unchanged").checked).toBe(true);
  fireEvent.keyDown(document.body, { key: "2" });
  expect(radio("Accepted with corrections").checked).toBe(true);
});
it("ignores decision keys while a review is read-only", async () => {
  const base = reviewWorkspace();
  const { save } = setup(reviewWorkspace({ read_only: true, assignment: { ...base.assignment, held: true } }));
  await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  fireEvent.keyDown(document.body, { key: "3" });
  expect(screen.getAllByRole("radio").every(n => !(n as HTMLInputElement).checked)).toBe(true);
  await clock(1600); expect(save).not.toHaveBeenCalled();
  vi.useRealTimers(); cleanup();
  setup(reviewWorkspace({ read_only: true, submitted_record: reviewRecord() }));
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.keyDown(document.body, { key: "3" });
  expect(screen.queryByRole("radio")).toBeNull();
  expect(within(screen.getByRole("region", { name: "Submitted review" })).getByText("Accepted with corrections")).toBeDefined();
});
it("lists the four decision keys under Translation review in ? help", async () => {
  setup();
  render(<ShortcutHelpHost />);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  act(openShortcutHelp);
  const group = screen.getByRole("heading", { name: "Translation review" }).closest("section") as HTMLElement;
  for (const description of ["Choose Accepted unchanged", "Choose Accepted with corrections", "Choose Query", "Choose Rejected"])
    expect(within(group).getByText(description)).toBeDefined();
});
it("never shows CLINICAL_CHANGE_REQUIRED for query or rejected", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(radio("Query"));
  expect(screen.queryByText(issueMessages.CLINICAL_CHANGE_REQUIRED)).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Number or unit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), { target: { value: "Dose differs" } });
  expect(screen.queryByRole("list", { name: "Review issues" })).toBeNull();
  fireEvent.click(radio("Rejected"));
  expect(screen.queryByRole("list", { name: "Review issues" })).toBeNull();
});
it("normalises a stored legacy query draft to an implied clinical change once on open", async () => {
  const { save } = setup(reviewWorkspace({ draft: { revision: 6, text: "Übersetzt.", form: { decision: "query", clinical_change: false, categories: ["value"], rationale: "r" } } }), true);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.queryByText(issueMessages.CLINICAL_CHANGE_REQUIRED)).toBeNull();
  // The saver starts on mount, before fake timers could be installed, so wait in real time.
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(17, { expected_revision: 6, text: "Übersetzt.", form: { decision: "query", clinical_change: true, categories: ["value"], rationale: "r" } });
});
it("shows the key hint line in the rail footer", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const hint = screen.getByText("Ctrl + Enter submits, 1–4 choose a decision outside the text");
  expect(hint.closest(".translation-decision-footer")).not.toBeNull();
});

it("puts the document name, meta and tools in one bar without a back link", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const title = screen.getByRole("heading", { level: 1, name: "case de v3 corrected" });
  const bar = title.closest(".translation-review-bar") as HTMLElement;
  expect(bar).not.toBeNull();
  expect(screen.queryByRole("link", { name: "Back to my tasks" })).toBeNull();
  expect(within(bar).getByText("Translation details").closest("details")).not.toBeNull();
  expect(within(bar).getByRole("button", { name: "Reload from server" })).toBeDefined();
  expect(bar.textContent).toContain("English");
  expect(bar.textContent).not.toContain("Translation review ·");
});
it("keeps the text controls on one line above the texts", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.getByRole("checkbox", { name: "Show changes" }).closest(".translation-tools")).toBe(screen.getByRole("group", { name: "Text view" }));
});
it("hides Couple scrolling below 700 px without a sentence and offers it above the texts at 1440 px", async () => {
  setup(undefined, false, { width: 699, listeners: new Set() });
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.queryByRole("checkbox", { name: "Couple scrolling" })).toBeNull();
  expect(screen.queryByText("Coupled scrolling is available in read-only views.")).toBeNull();
  cleanup();
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
  expect(screen.getByRole("checkbox", { name: "Couple scrolling" }).closest(".translation-tools")).not.toBeNull();
});
it("shows the pinned bottom bar with the decision and the only Submit button below 1100 px", async () => {
  setup(undefined, false, { width: 800, listeners: new Set() });
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const submits = screen.getAllByRole("button", { name: "Submit review…" });
  expect(submits).toHaveLength(1);
  const bar = submits[0].closest(".translation-pinned-bar") as HTMLElement;
  expect(bar).not.toBeNull();
  expect(bar.getAttribute("role")).toBe("region");
  expect(bar.getAttribute("aria-label")).toBe("Decision and submit");
  expect(bar.textContent).toContain("Decision: Not chosen");
  expect(submits[0].getAttribute("aria-describedby")).toBe("review-submit-reason");
  expect(document.querySelectorAll("#review-submit-reason")).toHaveLength(1);
  expect(document.querySelector(".translation-decision-footer")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Query" }));
  expect(bar.textContent).toContain("Decision: Query");
  fireEvent.click(within(bar).getByRole("button", { name: "Change ↓" }));
  expect(document.activeElement).toBe(document.querySelector("[data-decision-legend]"));
  expect(screen.getAllByRole("button", { name: "Submit review…" })).toHaveLength(1);
  expect(submitButton().getAttribute("aria-describedby")).toBe("review-submit-reason");
});
it("keeps the rail footer with Submit at 1440 px and renders no pinned bar", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.getAllByRole("button", { name: "Submit review…" })).toHaveLength(1);
  expect(submitButton().closest(".translation-decision-footer")).not.toBeNull();
  expect(document.querySelector(".translation-pinned-bar")).toBeNull();
  expect(screen.queryByRole("region", { name: "Decision and submit" })).toBeNull();
});
it("keeps Skip to decision", async () => {
  setup(undefined, false, { width: 800, listeners: new Set() });
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(screen.getByRole("button", { name: "Skip to decision" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your review" }));
});
const viewportOf = (width: number) => {
  const viewport = { width, listeners: new Set<() => void>() };
  const resize = (next: number) => act(() => { viewport.width = next; viewport.listeners.forEach(listener => listener()); });
  return { viewport, resize };
};
it("keeps one Submit, one reason and the focus while crossing 1100 px", async () => {
  const { viewport, resize } = viewportOf(1440);
  setup(undefined, false, viewport);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  submitButton().focus();
  resize(800);
  expect(screen.getAllByRole("button", { name: "Submit review…" })).toHaveLength(1);
  expect(document.querySelectorAll("#review-submit-reason")).toHaveLength(1);
  expect(submitButton().closest(".translation-pinned-bar")).not.toBeNull();
  expect(document.activeElement).toBe(submitButton());
  (document.getElementById("review-submit-reason") as HTMLElement).focus();
  resize(1440);
  expect(screen.getAllByRole("button", { name: "Submit review…" })).toHaveLength(1);
  expect(document.querySelectorAll("#review-submit-reason")).toHaveLength(1);
  expect(submitButton().closest(".translation-decision-footer")).not.toBeNull();
  expect(document.activeElement).toBe(document.getElementById("review-submit-reason"));
});
it("renders no pinned bar on a read-only review at 800 px", async () => {
  setup(reviewWorkspace({ read_only: true, submitted_record: reviewRecord() }), false, viewportOf(800).viewport);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(document.querySelector(".translation-pinned-bar")).toBeNull();
  expect(screen.queryByRole("button", { name: "Submit review…" })).toBeNull();
});
it("scrolls the decision legend to the start for Change ↓", async () => {
  setup(undefined, false, viewportOf(800).viewport);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const legend = document.querySelector<HTMLElement>("[data-decision-legend]")!;
  const scroll = vi.fn(); legend.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole("button", { name: "Change ↓" }));
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
  expect(document.activeElement).toBe(legend);
});
it("shows one reason line in the pinned bar and the full issue list in the decision form", async () => {
  setup(undefined, false, viewportOf(800).viewport);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(screen.getByRole("radio", { name: "Query" }));
  const reason = document.getElementById(submitButton().getAttribute("aria-describedby")!)!;
  expect(reason.closest(".translation-pinned-bar")).not.toBeNull();
  expect(reason.textContent).toBe(`${issueMessages.CATEGORY_REQUIRED} and 1 more`);
  expect(within(reason).queryByRole("list")).toBeNull();
  const lists = screen.getAllByRole("list", { name: "Review issues" });
  expect(lists).toHaveLength(1);
  expect(lists[0].closest(".translation-decision")).not.toBeNull();
  expect(within(lists[0]).getAllByRole("listitem")).toHaveLength(2);
});
const liveRegionsWith = (text: string) => [...document.querySelectorAll("[aria-live]")].filter(node => node.textContent?.includes(text));
it("below 1100 px exactly one live region carries the submit reason", async () => {
  setup(undefined, false, viewportOf(800).viewport);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(screen.getByRole("radio", { name: "Query" }));
  expect(screen.getAllByRole("list", { name: "Review issues" })).toHaveLength(1);
  const regions = liveRegionsWith(issueMessages.CATEGORY_REQUIRED);
  expect(regions).toHaveLength(1);
  expect(regions[0].id).toBe("review-submit-reason");
});
it("at 1100 px and wider the reason is announced once in the rail", async () => {
  setup(undefined, false, viewportOf(1100).viewport);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.click(screen.getByRole("radio", { name: "Query" }));
  const regions = liveRegionsWith(issueMessages.CATEGORY_REQUIRED);
  expect(regions).toHaveLength(1);
  expect(regions[0].id).toBe("review-submit-reason");
  expect(regions[0].closest(".translation-pinned-bar")).toBeNull();
});
it("keeps an unavailable Submit focusable and only points at the reason when activated", async () => {
  const { submit } = setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(submitButton().disabled).toBe(false);
  expect(submitButton().getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(submitButton());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(document.getElementById("review-submit-reason"));
  expect(submit).not.toHaveBeenCalled();
});
it("closes the translation details popover on Escape and on a click outside", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const summary = screen.getByText("Translation details");
  const details = summary.closest("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent.keyDown(details, { key: "Escape" });
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(summary);
  details.open = true;
  fireEvent.pointerDown(details.querySelector("dl")!);
  expect(details.open).toBe(true);
  fireEvent.pointerDown(document.body);
  expect(details.open).toBe(false);
});
it("measures the bands and the pinned bar into inline custom properties", async () => {
  const callbacks: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} unobserve() {} disconnect() {} });
  setup(undefined, false, viewportOf(800).viewport);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const bar = document.querySelector<HTMLElement>(".translation-pinned-bar")!;
  vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({ height: 72, top: 0, bottom: 72, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) });
  act(() => callbacks.forEach(callback => callback()));
  const root = screen.getByRole("region", { name: "Translation review" });
  expect(root.style.getPropertyValue("--review-bar")).toBe("72px");
  expect(root.style.getPropertyValue("--review-bands")).toMatch(/^\d+(\.\d+)?px$/);
});

const taskSummary = (assignment_id: number, overrides: Partial<TaskSummary> = {}): TaskSummary => ({
  assignment_id, workflow_revision: 0, held: false, report_answered: false, waiting_for_translation_review: false, waiting_for_lead: false, project_key: "proj", project_name: "Project",
  document_id: `document-${assignment_id}`, language: "de", task: "translation_review", status: "open",
  updated_at: "2026-10-20T12:00:00Z", ...overrides,
});
async function submitAcceptedUnchanged() {
  await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  fireEvent.click(screen.getByRole("radio", { name: decisionLabels.accepted_unchanged }));
  fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), { target: { value: "Units checked" } });
  await clock();
  await confirmSubmit();
  await clock(0);
}
it("offers the next task focused after submit and opens it", async () => {
  const { navigate } = setup();
  const tasks = vi.spyOn(api, "listMyTasks").mockResolvedValue([taskSummary(17, { status: "in_progress" }),
    taskSummary(30, { project_key: "other", external_id: "elsewhere" }), taskSummary(18, { external_id: "case-2", task: "annotate" })]);
  await submitAcceptedUnchanged();
  expect(tasks).toHaveBeenCalledTimes(1);
  const next = screen.getByRole("button", { name: "Next task: case-2 de" });
  expect(document.activeElement).toBe(next);
  expect(screen.getByRole("link", { name: "Back to my tasks" })).toBeDefined();
  expect(screen.getByText("1 more open task in this project.").getAttribute("role")).toBe("status");
  fireEvent.click(next);
  expect(navigate).toHaveBeenCalledWith({ name: "task", assignmentId: 18 });
});
it("makes Back to my tasks primary when nothing is left", async () => {
  const { navigate } = setup();
  vi.spyOn(api, "listMyTasks").mockResolvedValue([taskSummary(17, { status: "submitted" })]);
  await submitAcceptedUnchanged();
  expect(screen.getByText("No more open tasks in this project.")).toBeDefined();
  expect(screen.queryByRole("button", { name: /^Next task/ })).toBeNull();
  const back = screen.getByRole("button", { name: "Back to my tasks" });
  expect(back.className).toContain("primary");
  fireEvent.click(back);
  expect(navigate).toHaveBeenCalledWith({ name: "tasks", status: "all" });
});
it("shows loading and an error with Retry for the task list", async () => {
  setup();
  let fail: (reason: unknown) => void = () => {};
  const tasks = vi.spyOn(api, "listMyTasks").mockImplementationOnce(() => new Promise<TaskSummary[]>((_, reject) => { fail = reject; }));
  await submitAcceptedUnchanged();
  const loading = screen.getByRole("button", { name: /^Next task/ });
  expect(loading.getAttribute("aria-disabled")).toBe("true");
  expect(loading.getAttribute("aria-busy")).toBe("true");
  await act(async () => { fail(new Error("Network down")); });
  expect(screen.queryByRole("button", { name: /^Next task/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Back to my tasks" })).toBeDefined();
  expect(screen.getByText(/Network down/)).toBeDefined();
  tasks.mockResolvedValueOnce([taskSummary(18, { external_id: "case-2" })]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
  expect(tasks).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Next task: case-2 de" })).toBeDefined();
  expect(screen.queryByText(/Network down/)).toBeNull();
});
it("hands a submitted review to the task flow with the next open task of the project (issue 125)", async () => {
  const onSubmitted = vi.fn();
  setup(undefined, false, undefined, undefined, undefined, onSubmitted);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([taskSummary(17, { status: "submitted" }),
    taskSummary(30, { project_key: "other", external_id: "elsewhere" }), taskSummary(18, { external_id: "case-2", task: "annotate" })]);
  const heading = (await screen.findByRole("heading", { level: 1 })).textContent;
  await submitAcceptedUnchanged();
  expect(onSubmitted).toHaveBeenCalledTimes(1);
  expect(onSubmitted).toHaveBeenCalledWith({ label: heading, assignmentId: 17, next: 18 });
  // The flow leaves the page: no in-page next-task block meanwhile.
  expect(screen.queryByRole("button", { name: /^Next task/ })).toBeNull();
});
it("hands over without a next task when none is left or the list cannot load (My tasks)", async () => {
  const onSubmitted = vi.fn();
  setup(undefined, false, undefined, undefined, undefined, onSubmitted);
  vi.spyOn(api, "listMyTasks").mockRejectedValue(new Error("Network down"));
  await submitAcceptedUnchanged();
  expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ assignmentId: 17, next: undefined }));
  expect(screen.queryByText(/Network down/)).toBeNull();
});
it("lead correction never hands over to the task flow", async () => {
  const onSubmitted = vi.fn();
  setup(leadWorkspace(), false, undefined, undefined, undefined, onSubmitted);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Lead fix" } });
  await clock();
  await confirmSubmit();
  await clock(0);
  expect(screen.getByText("Review submitted")).toBeDefined();
  expect(onSubmitted).not.toHaveBeenCalled();
});
const leadWorkspace =() => reviewWorkspace({ lead_correction: true, assignment: { ...reviewWorkspace().assignment, lead_correction: true } });
it("lead correction shows only Accepted with corrections, preselected, with the lead note", async () => {
  const { save } = setup(leadWorkspace());
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const radios = screen.getAllByRole("radio") as HTMLInputElement[];
  expect(radios).toHaveLength(1);
  expect(radios[0].checked).toBe(true);
  expect(screen.getByRole("radio", { name: "Accepted with corrections" })).toBe(radios[0]);
  expect(screen.getByText("You are correcting this translation as project lead.")).toBeDefined();
  expect(screen.getByText(issueMessages.TEXT_UNCHANGED, { selector: "#review-submit-reason *" })).toBeDefined();
  expect(screen.queryByText(/1–4 choose a decision/)).toBeNull();
  vi.useFakeTimers();
  fireEvent.keyDown(document.body, { key: "3" });
  expect((screen.getByRole("radio", { name: "Accepted with corrections" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Lead fix" } });
  await clock();
  expect(save).toHaveBeenLastCalledWith(17, { expected_revision: 6, text: "Lead fix", form: { decision: "accepted_corrected", clinical_change: false } });
  expect(submitButton().getAttribute("aria-disabled")).toBeNull();
});
it("lead correction turns a stored other decision into Accepted with corrections", async () => {
  const workspace = leadWorkspace();
  const { save } = setup({ ...workspace, draft: { ...workspace.draft, form: { decision: "query", clinical_change: true } } });
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect((screen.getByRole("radio", { name: "Accepted with corrections" }) as HTMLInputElement).checked).toBe(true);
  await waitFor(() => expect(save).toHaveBeenCalledWith(17, expect.objectContaining({ form: expect.objectContaining({ decision: "accepted_corrected" }) })));
});
it("lead correction hides Report a problem and offers Back to Documents after submit", async () => {
  const { submit, navigate } = setup(leadWorkspace(), false, undefined, <button type="button">Report a problem</button>);
  const tasks = vi.mocked(api.listMyTasks);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Lead fix" } });
  await clock();
  await confirmSubmit();
  expect(submit).toHaveBeenCalledWith(17, 41);
  expect(screen.getByText("Review submitted")).toBeDefined();
  expect(tasks).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /^Next task/ })).toBeNull();
  expect(screen.queryByText("Back to my tasks")).toBeNull();
  const back = screen.getByRole("link", { name: "Back to Documents" });
  expect(back.getAttribute("href")).toContain("documents");
  fireEvent.click(back);
  expect(navigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "proj", case: "case", language: "de" });
});
it("a normal review keeps Report a problem", async () => {
  setup(undefined, false, undefined, <button type="button">Report a problem</button>);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.getByRole("button", { name: "Report a problem" })).toBeDefined();
});
it("shows the lead correction refusal from the server", async () => {
  const { submit } = setup(leadWorkspace());
  submit.mockRejectedValue(new ApiError(422, "Invalid review", "REVIEW_INVALID", { issues: ["LEAD_CORRECTION_DECISION"] }));
  await screen.findByRole("textbox", { name: "Translation (de)" });
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Lead fix" } });
  await clock();
  await confirmSubmit();
  expect(within(screen.getByRole("list", { name: "Server review issues" })).getByText("A lead correction is submitted as Accepted with corrections.")).toBeDefined();
});
it("a paused lead correction shows only Accepted with corrections and the lead note", async () => {
  const workspace = leadWorkspace();
  setup({ ...workspace, read_only: true, assignment: { ...workspace.assignment, held: true } });
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.getByText("This task is paused. Your review choices are kept.")).toBeDefined();
  const radios = screen.getAllByRole("radio");
  expect(radios).toHaveLength(1);
  expect(screen.getByRole("radio", { name: "Accepted with corrections" })).toBe(radios[0]);
  expect(screen.getByText("You are correcting this translation as project lead.")).toBeDefined();
});
