import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView, type VariantSummary } from "../../src/api/client";
import { LeadCorrectionPanel } from "../../src/documents/LeadCorrectionPanel";
import { rejectedRow } from "./fixtures";

const assignment = (id: number) => ({ id, project_key: "p", document_id: "case-0101-de", task: "translation_review", status: "open", lead_correction: true }) as AssignmentView;

function renderPanel(row = rejectedRow("case-0101", "de", { version: 2 })) {
  const props = { row, projectKey: "p", onNavigate: vi.fn(), onCancel: vi.fn() };
  render(<LeadCorrectionPanel {...props} />);
  return props;
}
const panel = () => screen.getByRole("group", { name: "Correct the translation, case-0101 · de" });
const open = () => within(panel()).getByRole("button", { name: "Open translation review" });

beforeEach(() => {
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ document_id: "case-0101-de", text_sha256: "sha-v2" } as VariantSummary);
  vi.spyOn(api, "startLeadCorrection");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("explains v{n} → v{n+1} and opens the translation review", async () => {
  vi.mocked(api.startLeadCorrection).mockResolvedValue(assignment(41));
  const props = renderPanel();
  expect(within(panel()).getByText("You review v2 yourself and submit it as Accepted with corrections. The corrected text becomes v3 and counts as accepted.")).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(within(panel()).getByRole("heading", { name: "Correct the translation, case-0101 · de" })));
  expect(within(panel()).queryByRole("checkbox")).toBeNull();
  fireEvent.click(open());
  await waitFor(() => expect(api.startLeadCorrection).toHaveBeenCalledWith("p", "case-0101-de", { expected_text_sha256: "sha-v2", confirm_language: false }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 41 }));
  fireEvent.click(within(panel()).getByRole("button", { name: "Cancel" }));
  expect(props.onCancel).toHaveBeenCalled();
});

it("asks for language confirmation only on LANGUAGE_CONFIRMATION_REQUIRED", async () => {
  vi.mocked(api.startLeadCorrection)
    .mockRejectedValueOnce(new ApiError(409, "confirm", "LANGUAGE_CONFIRMATION_REQUIRED", { document_language: "de", user_languages: ["en"], required_languages: ["de", "en"] }))
    .mockResolvedValueOnce(assignment(42));
  const props = renderPanel();
  fireEvent.click(open());
  const checkbox = await within(panel()).findByRole("checkbox", { name: "Correct despite missing de in your profile" });
  expect(open().getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(open());
  expect(api.startLeadCorrection).toHaveBeenCalledTimes(1);
  fireEvent.click(checkbox);
  fireEvent.click(open());
  await waitFor(() => expect(api.startLeadCorrection).toHaveBeenLastCalledWith("p", "case-0101-de", { expected_text_sha256: "sha-v2", confirm_language: true }));
  await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 42 }));
});

it("shows the qualification message with a profile link", async () => {
  vi.mocked(api.startLeadCorrection).mockRejectedValueOnce(new ApiError(409, "qualification", "QUALIFICATION_REQUIRED"));
  const props = renderPanel();
  fireEvent.click(open());
  const link = await within(panel()).findByRole("link", { name: "Add your qualification in your profile" });
  expect(within(panel()).getByText("A translation review records your qualification. Your profile has none yet.")).toBeTruthy();
  fireEvent.click(link);
  expect(props.onNavigate).toHaveBeenCalledWith({ name: "me" });
  expect(within(panel()).queryByRole("checkbox")).toBeNull();
});

it("shows LEAD_CORRECTION_NOT_AVAILABLE reasons in words", async () => {
  const cases: Array<[string, string]> = [
    ["not_newest", "A newer version of this translation exists. Reload the row to see it."],
    ["not_rejected_or_queried", "This version is no longer rejected or queried. Reload the row to see its current state."],
    ["review_open", "A translation review of this version is open. Withdraw it under Assignment actions before you correct the translation yourself."],
  ];
  for (const [reason, text] of cases) {
    vi.mocked(api.startLeadCorrection).mockRejectedValueOnce(new ApiError(409, "nope", "LEAD_CORRECTION_NOT_AVAILABLE", { reason }));
    const props = renderPanel();
    fireEvent.click(open());
    expect(await within(panel()).findByText(text)).toBeTruthy();
    expect(props.onNavigate).not.toHaveBeenCalled();
    cleanup();
  }
});
