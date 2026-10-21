import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AssignmentView, type CarryResponse } from "../../src/api/client";
import { CarryDialog, carrySourceOfFinal, carrySourceOfStep } from "../../src/documents/CarryDialog";
import { final } from "./fixtures";
import { preview, submittedOnOldText } from "./textChangeFixtures";

const carried = (overrides: Partial<CarryResponse> = {}): CarryResponse => ({ resolution: "carried", assignment: {} as AssignmentView, round: null, carried_findings: 3, ...overrides });

beforeEach(() => { vi.spyOn(api, "previewTextChange").mockResolvedValue(preview()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const { row, step } = submittedOnOldText();
  const props = { onClose: vi.fn(), onDone: vi.fn(), onReload: vi.fn(), onFromScratch: vi.fn() };
  render(<CarryDialog projectKey="demo" row={row} source={carrySourceOfStep(row, step)} {...props} />);
  return props;
}
const dialog = () => screen.getByRole("dialog", { name: "Carry to v2 · case-113 · de" });
const assign = () => within(dialog()).getByRole("button", { name: "Assign" });

describe("CarryDialog", () => {
  it("author preselected with the carried sentence", async () => {
    setup();
    expect(await within(dialog()).findByText("Ana Weber submitted on v1 (Round 1 · 3 findings).")).toBeDefined();
    const author = screen.getByRole("radio", { name: "Ana Weber (author)" }) as HTMLInputElement;
    expect(author.checked).toBe(true);
    expect(document.getElementById(author.getAttribute("aria-describedby")!)?.textContent).toBe("Their findings are carried to v2 for them to check.");
    expect(api.previewTextChange).toHaveBeenCalledWith("demo", { submission_id: "sub-ana-1", target_document_id: "case-113-de-v2" });
  });

  it("Someone else… lists members, people with own work muted with already annotating this text", async () => {
    setup();
    await screen.findByText(/submitted on v1/);
    expect(screen.queryByRole("radio", { name: /Mia Kranz/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Someone else…" }));
    const people = within(screen.getByRole("group", { name: "Annotator" }));
    expect(people.queryByRole("radio", { name: /Ana Weber/ })).toBeNull();
    const luc = people.getByRole("radio", { name: /Luc Martin/ });
    expect(luc.getAttribute("aria-disabled")).toBe("true");
    expect(people.getByText("already annotating this text")).toBeDefined();
    expect(assign().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(luc);
    expect((luc as HTMLInputElement).checked).toBe(false);
    const carry = vi.spyOn(api, "carrySubmission").mockResolvedValue(carried({ resolution: "handed_over", carried_findings: 1 }));
    fireEvent.click(people.getByRole("radio", { name: "Mia Kranz" }));
    expect(assign().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(assign());
    await waitFor(() => expect(carry).toHaveBeenCalledWith("demo", "sub-ana-1", expect.objectContaining({ mode: "other", username: "mia", target_document_id: "case-113-de-v2", confirm_language: false })));
  });

  it("Annotate v2 from scratch records dismiss and opens the assign dialog", async () => {
    const carry = vi.spyOn(api, "carrySubmission").mockResolvedValue(carried({ resolution: "dismissed", assignment: null, carried_findings: 0 }));
    const props = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Annotate v2 from scratch" }));
    fireEvent.click(assign());
    await waitFor(() => expect(props.onFromScratch).toHaveBeenCalled());
    expect(carry).toHaveBeenCalledWith("demo", "sub-ana-1", expect.objectContaining({ mode: "dismiss" }));
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it("success toast {person} continues on v2 with {n} carried findings.", async () => {
    const carry = vi.spyOn(api, "carrySubmission").mockResolvedValue(carried());
    const props = setup();
    await screen.findByText(/submitted on v1/);
    fireEvent.click(assign());
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Ana Weber continues on v2 with 3 carried findings."));
    expect(carry).toHaveBeenCalledWith("demo", "sub-ana-1", expect.objectContaining({ mode: "author", request_id: expect.any(String) }));
  });

  it("HANDOVER_NOT_INDEPENDENT message", async () => {
    vi.spyOn(api, "carrySubmission").mockRejectedValue(new ApiError(422, "x", "HANDOVER_NOT_INDEPENDENT"));
    const props = setup();
    await screen.findByText(/submitted on v1/);
    fireEvent.click(screen.getByRole("radio", { name: "Someone else…" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mia Kranz" }));
    fireEvent.click(assign());
    expect(await within(dialog()).findByText("This person is already annotating this text. Choose someone without own work on it, so the annotations stay independent.")).toBeDefined();
    expect((screen.getByRole("radio", { name: "Mia Kranz" }) as HTMLInputElement).checked).toBe(true);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it("asks before assigning someone who does not read the language, then confirms", async () => {
    const carry = vi.spyOn(api, "carrySubmission")
      .mockRejectedValueOnce(new ApiError(422, "x", "LANGUAGE_CONFIRMATION_REQUIRED"))
      .mockResolvedValueOnce(carried());
    const props = setup();
    await screen.findByText(/submitted on v1/);
    fireEvent.click(assign());
    fireEvent.click(await within(dialog()).findByRole("button", { name: "Assign anyway" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(carry).toHaveBeenLastCalledWith("demo", "sub-ana-1", expect.objectContaining({ confirm_language: true }));
  });

  it("carries a final's submission to the corrected version", () => {
    const { row } = submittedOnOldText();
    const withFinal = { ...row, final: final({ case_id: "case-113", language: "de", document_id: "case-113-de-v1", submission_id: "sub-final", round_ordinal: 2 }) };
    expect(carrySourceOfFinal(withFinal, "case-113-de-v2")).toEqual({ submissionId: "sub-final", targetDocumentId: "case-113-de-v2", fromVersion: 1, roundOrdinal: 2, author: null });
  });
});
