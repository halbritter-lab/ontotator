import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { DocumentsPage } from "../src/admin/DocumentsPage";
const documents = [
  { document_id: "z-first", language: "en", status: "not_started", position: 9, text_length: 4, assignees: [{ assignment_id: 1, username: "private-user", pseudonym: "Reader A", task: "annotate", status: "open" }] },
  { document_id: "a-second", language: "de", status: "in_progress", position: 23, text_length: 6, assignees: [] },
];
beforeEach(() => {
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue(documents as never);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ languages: ["en", "de"] } as never);
  vi.spyOn(api, "listUploads").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("uses controlled URL filters, preserves server order and shows actual assignment metadata", async () => {
  const navigate = vi.fn();
  render(<DocumentsPage projectKey="p" query={{ language: "en", status: "open", q: "z" }} onNavigate={navigate} />);
  await screen.findByText("z-first");
  expect(api.listProjectDocuments).toHaveBeenCalledWith("p", { language: "en", status: "open", q: "z" });
  expect(screen.getAllByTestId("document-row").map(row => row.textContent)).toEqual([expect.stringContaining("z-first"), expect.stringContaining("a-second")]);
  expect(screen.getByText("Reader A: annotate open")).toBeTruthy();
  expect(screen.queryByText("private-user")).toBeNull();
  fireEvent.change(screen.getByLabelText("Language"), { target: { value: "de" } });
  expect(navigate).toHaveBeenLastCalledWith({ name: "projectDocuments", key: "p", language: "de", status: "open", q: "z", select: undefined });
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "reopened" } });
  expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ status: "reopened", language: "en" }));
  fireEvent.change(screen.getByLabelText("ID prefix"), { target: { value: "ID +/#" } });
  expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ q: "ID +/#" }));
});
it("selects only visible IDs and replaces selection after filters change", async () => {
  const navigate = vi.fn(); const { rerender } = render(<DocumentsPage projectKey="p" query={{}} onNavigate={navigate} />);
  await screen.findByText("z-first");
  fireEvent.click(screen.getByLabelText("Select all visible"));
  expect(screen.getByText("2 selected")).toBeTruthy();
  vi.mocked(api.listProjectDocuments).mockResolvedValueOnce([documents[1]] as never);
  rerender(<DocumentsPage projectKey="p" query={{ language: "de", select: "a-second" }} onNavigate={navigate} />);
  await waitFor(() => expect(screen.queryByText("z-first")).toBeNull());
  expect(screen.getByLabelText("Select a-second")).toHaveProperty("checked", true);
  expect(screen.getByText("1 selected")).toBeTruthy();
});
it("ignores old filter replies", async () => {
  let resolve!: (value: never) => void;
  vi.mocked(api.listProjectDocuments).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce([documents[1]] as never);
  const { rerender } = render(<DocumentsPage projectKey="p" query={{}} onNavigate={vi.fn()} />);
  rerender(<DocumentsPage projectKey="p" query={{ q: "a" }} onNavigate={vi.fn()} />);
  await screen.findByText("a-second"); resolve(documents as never);
  await waitFor(() => expect(screen.queryByText("z-first")).toBeNull());
});
it("preselects an exact special-character ID only when visible", async () => {
  const special = { ...documents[0], document_id: "ID +/ß#" };
  vi.mocked(api.listProjectDocuments).mockResolvedValueOnce([special] as never);
  render(<DocumentsPage projectKey="p" query={{ select: special.document_id }} onNavigate={vi.fn()} />);
  await screen.findByText(special.document_id);
  expect(screen.getByLabelText(`Select ${special.document_id}`)).toHaveProperty("checked", true);
  expect(screen.getByText("1 selected")).toBeTruthy();
});
it("renders all one thousand rows in server order without client truncation", async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ ...documents[1], document_id: `doc-${1000 - index}` }));
  vi.mocked(api.listProjectDocuments).mockResolvedValue(rows as never);
  render(<DocumentsPage projectKey="p" query={{ select: "hidden" }} onNavigate={vi.fn()} />);
  await screen.findByText("doc-1");
  const visible = screen.getAllByTestId("document-row");
  expect(visible).toHaveLength(1000); expect(visible[0].textContent).toContain("doc-1000");
  expect(screen.getByText("0 selected")).toBeTruthy();
});
