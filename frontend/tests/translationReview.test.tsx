import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import type { RouteLeaveGuard } from "../src/app/router";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewRecord, reviewWorkspace } from "./translationFixtures";
import { decisionConsequences, decisionLabels, decisionOutcomes, issueMessages } from "../src/translation/labels";
import { ShortcutHelpHost, openShortcutHelp } from "../src/ui/ShortcutHelp";
import type { ReviewDecisionCode } from "../src/translation/reviewRules";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(workspace = reviewWorkspace(), strict = false) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: true, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  const open = vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  const save = vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 41 });
  const submit = vi.spyOn(api, "submitTranslationReview").mockResolvedValue(reviewRecord());
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ ...workspace.variant, translation: null, version: 7, assigned_to_me: false });
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const leaveGuardRef: { current: ((proceed: () => void) => void) | null } = { current: null };
  const navigate = vi.fn();
  const element = <TranslationReviewScreen assignmentId={17} username="alice" onNavigate={navigate} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} />;
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
  expect(screen.getByText("1 automatic check failed")).toBeDefined();
  expect(within(screen.getByText("1 automatic check failed").closest(".notice") as HTMLElement).getByText("Units added in translation")).toBeDefined();
  expect(screen.getAllByText(/A unit changed/)).toHaveLength(2);
  expect(screen.getAllByRole("radio").every(n => !(n as HTMLInputElement).checked)).toBe(true);
  expect(submitButton().disabled).toBe(true);
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
    form: { decision: selected, clinical_change: false } }]);
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Clinically relevant change" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Number or unit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), { target: { value: "Check the dose" } });
  }
  await clock();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(17, expect.objectContaining({ text, form: expect.objectContaining({ decision }) }));
  expect(submitButton().disabled).toBe(false);
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
  fireEvent.click(screen.getByRole("radio", { name: "Accepted unchanged" })); await clock();
  expect(save.mock.calls[0][1].form).toEqual({ decision: "accepted_unchanged", clinical_change: "stored-invalid", categories: ["unknown"], rationale: { invalid: true }, extra: "keep" });
  expect(submitButton().disabled).toBe(true);
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
  expect(save).toHaveBeenLastCalledWith(17, { expected_revision: 87, text: "After reopen", form: {} });
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
  expect(submitButton().disabled).toBe(true);
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
  const box=screen.getByRole<HTMLInputElement>('checkbox',{name:'Couple scrolling'});
  expect(box.checked).toBe(false); expect(box.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:'Show changes'}));
  expect(box.disabled).toBe(false); fireEvent.click(box);
  expect(screen.getByText('Paragraphs are paired by position, not by meaning')).toBeDefined();
  expect(screen.getByLabelText('Paragraph pairing')).toBeDefined();
  fireEvent.click(screen.getByRole('checkbox',{name:'Show changes'}));
  expect(box.checked).toBe(false); expect(box.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:'Show changes'})); expect(box.checked).toBe(false);
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
  const all = screen.getByText("Show all checks").closest("details") as HTMLDetailsElement;
  expect(all.open).toBe(false);
  expect(within(all).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Failed Units added in translation: A unit changedunits_added", "Passed Numbersnumbers"]);
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
  expect(submitButton().disabled).toBe(false);
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
  expect(within(issues).getAllByRole("listitem").map(item => item.textContent)).toEqual([issueMessages.CLINICAL_CHANGE_REQUIRED]);
  expect(issues.closest(".translation-decision-footer")?.contains(submitButton())).toBe(true);
  expect(screen.getAllByRole("list", { name: "Review issues" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Clinically relevant change" }));
  expect(within(screen.getByRole("list", { name: "Review issues" })).getAllByRole("listitem").map(item => item.textContent))
    .toEqual([issueMessages.CATEGORY_REQUIRED, issueMessages.RATIONALE_REQUIRED]);
  expect(submitButton().disabled).toBe(true);
});

it('allows explicit coupling on a submitted read-only target',async()=>{
  setup(reviewWorkspace({read_only:true,submitted_record:reviewRecord()}));
  await screen.findByRole('textbox',{name:'Translation (de)'});
  const box=screen.getByRole<HTMLInputElement>('checkbox',{name:'Couple scrolling'});
  expect(box.disabled).toBe(false);expect(box.checked).toBe(false);fireEvent.click(box);expect(box.checked).toBe(true);
  expect(screen.getByText('Paragraphs are paired by position, not by meaning')).toBeDefined();
});
