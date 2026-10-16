import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { AssignDialog } from "../src/admin/AssignDialog";
import { assignment, deferred, documents, members } from "./assignmentFixtures";
beforeEach(() => { vi.spyOn(api, "listCases").mockResolvedValue([]); vi.spyOn(api, "listMembers").mockResolvedValue(members); vi.spyOn(api, "createAssignments").mockResolvedValue({ created: [assignment], refused: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const props = () => ({ projectKey: "p/key", documents, onClose: vi.fn(), onChanged: vi.fn() });
it("assigns visible selected documents to role holders and shows their language warnings", async () => {
  const options = props(); render(<AssignDialog {...options} />);
  fireEvent.click(await screen.findByLabelText(/Alice \(alice\)/));
  expect(screen.getByText(/1 document.*language/)).toBeDefined();
  expect(screen.queryByLabelText(/Lead \(lead\)/)).toBeNull();
  fireEvent.click(screen.getByLabelText(/Bob \(bob\)/));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  await screen.findByText(/2 documents|assignment.*complete/i);
  expect(api.createAssignments).toHaveBeenCalledWith("p/key", { task: "annotate", confirm_language: false, rows: [{ document_id: "z/doc", username: "alice" }, { document_id: "z/doc", username: "bob" }, { document_id: "a", username: "alice" }, { document_id: "a", username: "bob" }] });
  expect(options.onChanged).toHaveBeenCalledOnce();
});
it("changes to the actual review role and clears old member selections", async () => {
  render(<AssignDialog {...props()} />); fireEvent.click(await screen.findByLabelText(/Alice \(alice\)/));
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "review" } });
  expect(screen.queryByLabelText(/Alice \(alice\)/)).toBeNull();
  expect(screen.getByLabelText(/Bob \(bob\)/)).toHaveProperty("checked", false);
  expect(screen.getByRole("button", { name: "Assign" })).toHaveProperty("disabled", true);
});
it("retains actual refusals and retries only language rows without replaying successes", async () => {
  vi.mocked(api.createAssignments).mockResolvedValueOnce({ created: [assignment], refused: [{ document_id: "a", username: "alice", code: "LANGUAGE_CONFIRMATION_REQUIRED" }, { document_id: "a", username: "bob", code: "ADJUDICATOR_IS_ANNOTATOR" }] }).mockResolvedValueOnce({ created: [assignment], refused: [] });
  render(<AssignDialog {...props()} />); fireEvent.click(await screen.findByLabelText(/Alice \(alice\)/)); fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(await screen.findByText(/This reviewer also has annotation/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Assign anyway" }));
  await waitFor(() => expect(api.createAssignments).toHaveBeenCalledTimes(2));
  expect(api.createAssignments).toHaveBeenLastCalledWith("p/key", { task: "annotate", confirm_language: true, rows: [{ document_id: "a", username: "alice" }] });
  expect(screen.getByText(/This reviewer also has annotation/)).toBeDefined();
});
it("blocks duplicate submits and ignores responses after unmount", async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.createAssignments>>>(); vi.mocked(api.createAssignments).mockReturnValue(pending.promise);
  const options = props(); const view = render(<AssignDialog {...options} />); fireEvent.click(await screen.findByLabelText(/Alice \(alice\)/));
  const button = screen.getByRole("button", { name: "Assign" }); fireEvent.click(button); fireEvent.click(button);
  expect(api.createAssignments).toHaveBeenCalledOnce(); view.unmount(); await act(async () => { pending.resolve({ created: [assignment], refused: [] }); }); expect(options.onChanged).not.toHaveBeenCalled();
});
