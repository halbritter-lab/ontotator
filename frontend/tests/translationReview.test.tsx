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

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(workspace = reviewWorkspace(), strict = false, viewport?: { width: number; listeners: Set<() => void> }, reportActions?: JSX.Element) {
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
  const element = <TranslationReviewScreen assignmentId={17} username="alice" onNavigate={navigate} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} reportActions={reportActions} />;
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
it("couples only opted-in reading views and clears the request on return to editing", async () => {
  setup(); await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.queryByRole('checkbox',{name:'Couple scrolling'})).toBeNull();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show changes'}));
  const box=screen.getByRole<HTMLInputElement>('checkbox',{name:'Couple scrolling'});
  expect(box.checked).toBe(false); expect(box.disabled).toBe(false); fireEvent.click(box);
  expect(screen.getByText('Paragraphs are paired by position, not by meaning')).toBeDefined();
  expect(screen.getByLabelText('Paragraph pairing')).toBeDefined();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show changes'}));
  expect(screen.queryByRole('checkbox',{name:'Couple scrolling'})).toBeNull();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show changes'}));
  expect(screen.getByRole<HTMLInputElement>('checkbox',{name:'Couple scrolling'}).checked).toBe(false);
});
it("uses only the workspace's comparison choices and shows passed inherited checks on demand", async () => {
  const workspace = reviewWorkspace();
  workspace.translation_ancestor.translation = { ...workspace.translation_ancestor.translation, checks: [{ code: "units_added", passed: false, detail: "A unit changed" }, { code: "numbers", passed: true }] };
  workspace.comparisons = [{ variant: { ...workspace.variant, document_id: "comparison-1", external_id: "First MT" }, text: "First comparison" }, { variant: { ...workspace.variant, document_id: "comparison-2", external_id: "Second MT" }, text: "Second comparison" }];
  setup(workspace); await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.getByText("First comparison")).toBeDefined();
  const select = screen.getByRole("combobox", { name: "Comparison translation" });
  expect(Array.from((select as HTMLSelectElement).options).map(option => option.value)).toEqual(["comparison-1", "comparison-2"]);
  fireEvent.change(select, { target: { value: "comparison-2" } }); expect(screen.getByText("Second comparison")).toBeDefined();
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
  expect(submitButton().getAttribute("aria-disabled")).toBeNull();
  (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  const dialog = screen.getByRole("dialog", { name: "Submit this review?" });
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
  expect(screen.getByText('Paragraphs are paired by position, not by meaning')).toBeDefined();
});

it('pauses read-only coupling while stacked and retains opt-in through a resize', async () => {
  const viewport = { width: 1024, listeners: new Set<() => void>() };
  const resize = (width: number) => act(() => { viewport.width = width; viewport.listeners.forEach(listener => listener()); });
  setup(reviewWorkspace({ read_only: true, submitted_record: reviewRecord() }), false, viewport);
  await screen.findByRole('textbox', { name: 'Translation (de)' });
  const couple = () => screen.queryByRole<HTMLInputElement>('checkbox', { name: 'Couple scrolling' });
  expect(couple()).toBeNull();
  expect(screen.queryByText(/widen/i)).toBeNull();
  resize(1100);
  expect(couple()!.checked).toBe(false);
  fireEvent.click(couple()!);
  expect(screen.getByRole('status', { name: 'Paragraph pairing' })).toBeDefined();
  resize(1099);
  expect(couple()).toBeNull();
  expect(screen.queryByText('Paragraphs are paired by position, not by meaning')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Paragraph pairing' })).toBeNull();
  resize(1440);
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
  const hint = screen.getByText("Ctrl + Enter submits · 1–4 choose a decision outside the text");
  expect(hint.closest(".translation-decision-footer")).not.toBeNull();
});

it("puts the document name, meta and tools in one bar without a back link", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  const title = screen.getByRole("heading", { level: 1, name: "EN 1/7" });
  const bar = title.closest(".translation-review-bar") as HTMLElement;
  expect(bar).not.toBeNull();
  expect(screen.queryByRole("link", { name: "Back to my tasks" })).toBeNull();
  expect(within(bar).getByText("Translation details").closest("details")).not.toBeNull();
  expect(within(bar).getByRole("button", { name: "Reload from server" })).toBeDefined();
  expect(bar.textContent).toContain("English");
  expect(bar.textContent).not.toContain("Translation review ·");
});
it("folds the text toolbar into the column heads", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.getByRole("checkbox", { name: "Show changes" }).closest(".translation-column-head")?.textContent).toContain("Translation (de)");
  expect(screen.queryByRole("group", { name: "Text view" })).toBeNull();
});
it("hides Couple scrolling while it is unavailable and offers it on a read-only target at 1440 px", async () => {
  setup();
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(screen.queryByRole("checkbox", { name: "Couple scrolling" })).toBeNull();
  expect(screen.queryByText("Coupled scrolling is available in read-only views.")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show changes" }));
  expect(screen.getByRole("checkbox", { name: "Couple scrolling" }).closest(".translation-column-head")?.textContent).toContain("Translation (de)");
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
  assignment_id, workflow_revision: 0, held: false, project_key: "proj", project_name: "Project",
  document_id: `document-${assignment_id}`, language: "de", task: "translation_review", status: "open",
  updated_at: "2026-10-20T12:00:00Z", ...overrides,
});
async function submitAcceptedUnchanged() {
  await screen.findByRole("textbox", { name: "Translation (de)" }); vi.useFakeTimers();
  fireEvent.click(screen.getByRole("radio", { name: decisionLabels.accepted_unchanged }));
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
  const next = screen.getByRole("button", { name: "Next task: case-2 (de)" });
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
  expect(navigate).toHaveBeenCalledWith({ name: "tasks" });
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
  expect(screen.getByRole("button", { name: "Next task: case-2 (de)" })).toBeDefined();
  expect(screen.queryByText(/Network down/)).toBeNull();
});
const leadWorkspace = () => reviewWorkspace({ lead_correction: true, assignment: { ...reviewWorkspace().assignment, lead_correction: true } });
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
