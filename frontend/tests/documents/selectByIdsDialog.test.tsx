import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../src/api/client";
import { SelectByIdsDialog } from "../../src/documents/SelectByIdsDialog";

const known = new Set(Array.from({ length: 2600 }, (_, index) => `case-${String(index).padStart(4, "0")}`));
const idsOf = (count: number, start = 0) => Array.from({ length: count }, (_, index) => `case-${String(start + index).padStart(4, "0")}`);

beforeEach(() => {
  vi.spyOn(api, "lookupCaseIds").mockImplementation(async (_key, ids) => ({ found: ids.filter(id => known.has(id)), unknown: ids.filter(id => !known.has(id)) }));
  // Two texts per case, in reversed list order (the dialog keeps the pasted order).
  vi.spyOn(api, "documentRowKeys").mockImplementation(async (_key, body) => {
    const cases = [...(body?.case_ids ?? [])].reverse();
    return { keys: cases.flatMap(caseId => [{ case_id: caseId, language: "en" }, { case_id: caseId, language: "de" }]), cases: cases.length, total: cases.length * 2, truncated: false };
  });
});
/** Text keys of the given cases as the dialog reports them. */
const keysOf = (ids: readonly string[]) => ids.flatMap(id => [`${id}:en`, `${id}:de`]);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderDialog(current: readonly string[] = []) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(<SelectByIdsDialog projectKey="p" current={new Set(current)} onClose={onClose} onSelect={onSelect} />);
  const dialog = screen.getByRole("dialog", { name: "Select by case IDs" });
  const paste = (text: string) => fireEvent.change(within(dialog).getByLabelText("Paste case IDs"), { target: { value: text } });
  return { dialog, paste, onSelect, onClose };
}

it("looks up pasted ids live and shows found and unknown", async () => {
  const { dialog, paste } = renderDialog();
  expect(within(dialog).getByText("Paste case IDs, one per line or separated by commas.")).toBeTruthy();
  paste(idsOf(20).join("\n"));
  expect(within(dialog).getByText("Looking up…", { selector: "[role=status]" })).toBeTruthy();
  expect(await within(dialog).findByText("20 found, 0 unknown")).toBeTruthy();
  expect(api.lookupCaseIds).toHaveBeenCalledWith("p", idsOf(20));
  const unknown = Array.from({ length: 23 }, (_, index) => `missing-${index}`);
  paste([...idsOf(2), ...unknown].join(", "));
  expect(await within(dialog).findByText("2 found, 23 unknown")).toBeTruthy();
  expect(within(dialog).getByText(`Unknown: ${unknown.slice(0, 20).join(", ")} and 3 more`)).toBeTruthy();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy unknown IDs" }));
  expect(writeText).toHaveBeenCalledWith(unknown.join("\n"));
  vi.unstubAllGlobals();
});

it("replaces the selection by default and can add instead", async () => {
  const { dialog, paste, onSelect } = renderDialog(["c1", "c2", "c3", "c4", "c5"]);
  paste("case-0001 case-0002");
  await within(dialog).findByText("2 found, 0 unknown");
  expect(within(dialog).getByText("This replaces the current selection of 5 cases.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Select 2" }));
  // Every text of the found cases (VD4), looked up through the row keys.
  await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(keysOf(["case-0001", "case-0002"]), "replace"));
  expect(api.documentRowKeys).toHaveBeenLastCalledWith("p", { case_ids: ["case-0001", "case-0002"] });
  fireEvent.click(within(dialog).getByLabelText("Add to the current selection instead"));
  expect(within(dialog).queryByText("This replaces the current selection of 5 cases.")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Select 2" }));
  await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(keysOf(["case-0001", "case-0002"]), "add"));
});

it("caps at 2000 with Select the first 2000", async () => {
  const { dialog, paste, onSelect } = renderDialog();
  paste(idsOf(2500).join("\n"));
  await within(dialog).findByText("2500 found, 0 unknown");
  expect(within(dialog).getByText("Selection is limited to 2000 cases.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Select the first 2000" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(keysOf(idsOf(2000)), "replace"));
  expect(api.documentRowKeys).toHaveBeenCalledWith("p", { case_ids: idsOf(2000) });
  cleanup();
  // Adding beyond 2000 likewise.
  const second = renderDialog(idsOf(1990, 100));
  second.paste(idsOf(20, 2100).join("\n"));
  await within(second.dialog).findByText("20 found, 0 unknown");
  expect(within(second.dialog).getByRole("button", { name: "Select 20" })).toBeTruthy();
  fireEvent.click(within(second.dialog).getByLabelText("Add to the current selection instead"));
  expect(within(second.dialog).getByRole("button", { name: "Select the first 2000" })).toBeTruthy();
  expect(within(second.dialog).getByText("Selection is limited to 2000 cases.")).toBeTruthy();
});

it("keeps Select unavailable with a reason when nothing is found", async () => {
  const { dialog, paste, onSelect } = renderDialog();
  const select = within(dialog).getByRole("button", { name: "Select 0" });
  expect(select.getAttribute("aria-disabled")).toBe("true");
  paste(Array.from({ length: 20 }, (_, index) => `nope-${index}`).join("\n"));
  await within(dialog).findByText("0 found, 20 unknown");
  expect(select.getAttribute("aria-disabled")).toBe("true");
  const reason = document.getElementById(select.getAttribute("aria-describedby")!);
  expect(reason?.textContent).toBe("None of these case IDs exist in this project.");
  fireEvent.click(select);
  expect(onSelect).not.toHaveBeenCalled();
  // A failed lookup offers Retry.
  vi.mocked(api.lookupCaseIds).mockRejectedValueOnce(new Error("offline"));
  paste("case-0001");
  const retry = await within(dialog).findByRole("button", { name: "Retry" });
  fireEvent.click(retry);
  await waitFor(() => expect(within(dialog).getByText("1 found, 0 unknown")).toBeTruthy());
});

it("shows an error when the texts of the found cases cannot be loaded", async () => {
  vi.mocked(api.documentRowKeys).mockRejectedValueOnce(new Error("offline"));
  const { dialog, paste, onSelect } = renderDialog();
  paste("case-0001");
  await within(dialog).findByText("1 found, 0 unknown");
  fireEvent.click(within(dialog).getByRole("button", { name: "Select 1" }));
  expect(await within(dialog).findByText(/offline/)).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
  expect(api.documentRowKeys).toHaveBeenCalledWith("p", { case_ids: ["case-0001"] });
  // The dialog stays open with the found IDs; a second try clears the error and selects.
  fireEvent.click(within(dialog).getByRole("button", { name: "Select 1" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(keysOf(["case-0001"]), "replace"));
  expect(within(dialog).queryByText(/offline/)).toBeNull();
});

it("matches another case only when one case ID fits and lists ambiguous IDs (issue 237)", async () => {
  vi.mocked(api.lookupCaseIds).mockResolvedValue({
    found: ["Ab5"],
    unknown: ["x9"],
    case_insensitive: [{ id: "ab5", case_id: "Ab5" }, { id: "AB5", case_id: "Ab5" }],
    ambiguous: [{ id: "fr100907", candidates: ["FR100907", "Fr100907"] }],
  });
  const { dialog, paste, onSelect } = renderDialog();
  paste("fr100907 ab5 AB5 x9");
  expect(await within(dialog).findByText("1 found, 1 unknown, 1 ambiguous")).toBeTruthy();
  expect(within(dialog).getByText("fr100907 matches FR100907 and Fr100907; enter the exact ID.")).toBeTruthy();
  expect(within(dialog).getByText("Matched in another case: ab5 as Ab5, AB5 as Ab5")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Select 1" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(keysOf(["Ab5"]), "replace"));
  expect(api.documentRowKeys).toHaveBeenCalledWith("p", { case_ids: ["Ab5"] });
});

it("keeps Select unavailable with a reason when every match is ambiguous", async () => {
  vi.mocked(api.lookupCaseIds).mockResolvedValue({ found: [], unknown: [], ambiguous: [{ id: "fr1", candidates: ["FR1", "Fr1", "fR1"] }] });
  const { dialog, paste, onSelect } = renderDialog();
  paste("fr1");
  expect(await within(dialog).findByText("0 found, 0 unknown, 1 ambiguous")).toBeTruthy();
  expect(within(dialog).getByText("fr1 matches FR1, Fr1 and fR1; enter the exact ID.")).toBeTruthy();
  const select = within(dialog).getByRole("button", { name: "Select 0" });
  expect(select.getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(select.getAttribute("aria-describedby")!)?.textContent).toBe("Enter the exact case IDs listed as ambiguous.");
  fireEvent.click(select);
  expect(onSelect).not.toHaveBeenCalled();
});
