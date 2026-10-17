import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, ApiError, type AssignmentWorkspace } from "../src/api/client";
import { testUser } from "./session";
import userEvent from "@testing-library/user-event";
import { assigned, taskOf, workspaceFixture } from "./assignments";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/"); });
function clickSection(name: string): void {
  const disclosure = document.querySelector<HTMLDetailsElement>(".shell-reading-navigation");
  if (disclosure && !disclosure.open) fireEvent.click(disclosure.querySelector("summary")!);
  fireEvent.click(screen.getByRole("link", { name }));
}

it("uses the assigned task list, cleans old identity preferences and routes through the real shell", async () => {
  window.history.replaceState(null, "", "#/");
  localStorage.setItem("ontocurator.annotatorId", "someone-else");
  localStorage.setItem("ontocurator.mode.pkg", "assisted");
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  const preferences = vi.spyOn(api, "getPreferences");
  render(<App user={testUser("alice")} />);
  await screen.findByRole("heading", { name: "My tasks" });
  expect(screen.queryByLabelText("Working mode")).toBeNull();
  expect(localStorage.getItem("ontocurator.annotatorId")).toBeNull();
  expect(localStorage.getItem("ontocurator.mode.pkg")).toBeNull();
  expect(preferences).not.toHaveBeenCalled();
  vi.spyOn(api, "adminListUsers").mockResolvedValue([]);
  clickSection("Users");
  await waitFor(() => expect(window.location.hash).toBe("#/admin/users"));
  expect(screen.getAllByRole("banner")).toHaveLength(1);
  expect(await screen.findByRole("heading", { name: "Users" })).toBeDefined();
});

function editorServer() {
  window.history.replaceState(null, "", "#/tasks/17");
  const first = workspaceFixture("z-last"), second = workspaceFixture("a-first");
  const tasks = [taskOf(first.view, 17), { ...taskOf(second.view, 4), status: "submitted" as "submitted" | "open" }];
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue(tasks);
  vi.spyOn(api, "getAssignmentMetadata").mockImplementation(async id => assigned(id === 17 ? first : { ...second, read_only: true }, id).assignment);
  const open = vi.spyOn(api, "openAssignment").mockImplementation(async id => assigned(id === 17 ? first : { ...second, read_only: true }, id));
  return { first, second, open, tasks };
}

it("holds shell navigation during a save and honors only the latest destination", async () => {
  const { first, open } = editorServer();
  let save!: (value: typeof first.view.draft) => void;
  vi.spyOn(api, "applyCommand").mockImplementation(() => new Promise(resolve => { save = resolve; }));
  vi.spyOn(api, "getProfile").mockReturnValue(new Promise(() => {}));
  render(<App user={testUser("alice")} />);
  fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/ }));
  await waitFor(() => expect(api.applyCommand).toHaveBeenCalledOnce());
  const editor = document.querySelector(".text-container");
  clickSection("My tasks");
  clickSection("Profile");
  expect(window.location.hash).toBe("#/tasks/17");
  expect(document.querySelector(".text-container")).toBe(editor);
  await act(async () => save({ ...first.view.draft, revision: 1 }));
  await waitFor(() => expect(window.location.hash).toBe("#/me"));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("cancels a raw-hash leave without losing the editor or duplicating its unsaved dialog", async () => {
  editorServer();
  vi.spyOn(api, "applyCommand").mockRejectedValue(new TypeError("Offline"));
  render(<App user={testUser("alice")} />);
  fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/ }));
  await screen.findByText("Offline – changes not saved");
  const editor = document.querySelector(".text-container");
  act(() => { window.location.hash = "#/me"; });
  const dialog = await screen.findByRole("dialog", { name: "Changes not saved" });
  clickSection("My tasks");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(window.location.hash).toBe("#/tasks/17");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(window.location.hash).toBe("#/tasks/17"));
  expect(document.querySelector(".text-container")).toBe(editor);
  clickSection("My tasks");
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard edits and leave" }));
  await screen.findByRole("heading", { name: "My tasks" });
  expect(window.location.hash).toBe("#/");
});

it("does not leave when a refused save emptied the pending queue", async () => {
  editorServer();
  vi.spyOn(api, "applyCommand").mockRejectedValue(new ApiError(422, "Invalid change", "INVALID_COMMAND"));
  render(<App user={testUser("alice")} />);
  fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/ }));
  await screen.findByText("Invalid change");
  clickSection("My tasks");
  await screen.findByText("A change could not be saved. Reload the case before leaving.");
  expect(window.location.hash).toBe("#/tasks/17");
  expect(screen.getByTestId("annotator-identity")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Reload case" }));
  await waitFor(() => expect(api.openAssignment).toHaveBeenCalledTimes(2));
  await screen.findByTestId("annotator-identity");
  clickSection("My tasks");
  await screen.findByRole("heading", { name: "My tasks" });
});

it("restores the accepted history entry after cancelling several raw-hash destinations", async () => {
  editorServer();
  vi.spyOn(api, "applyCommand").mockRejectedValue(new TypeError("Offline"));
  render(<App user={testUser("alice")} />);
  fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/ }));
  await screen.findByText("Offline – changes not saved");
  act(() => { window.location.hash = "#/me"; });
  const dialog = await screen.findByRole("dialog", { name: "Changes not saved" });
  act(() => { window.location.hash = "#/admin/users"; });
  await waitFor(() => expect(window.location.hash).toBe("#/tasks/17"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(window.location.hash).toBe("#/tasks/17"));
  await waitFor(() => expect(window.history.state.ontocuratorRouteIndex).toBe(0));
  expect(screen.getByTestId("annotator-identity")).toBeDefined();
});

it("does not commit a pending route after the authenticated App unmounts", async () => {
  const { first } = editorServer();
  let finish!: (value: typeof first.view.draft) => void;
  vi.spyOn(api, "applyCommand").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const mounted = render(<App user={testUser("alice")} />);
  fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/ }));
  await waitFor(() => expect(api.applyCommand).toHaveBeenCalledOnce());
  clickSection("Profile");
  mounted.unmount();
  await act(async () => finish({ ...first.view.draft, revision: 1 }));
  expect(window.location.hash).toBe("#/tasks/17");
});

it.each(["open", "submitted"] as const)("retains the actual submitted dialog after server reordering and navigates to its %s neighbor by assignment", async (status) => {
  const { first, open, tasks } = editorServer();
  tasks[1] = { ...tasks[1], status };
  open.mockImplementation(async id => assigned(id === 17 ? first : { ...workspaceFixture("a-first"), read_only: status === "submitted" }, id));
  vi.mocked(api.listMyTasks).mockResolvedValueOnce(tasks).mockResolvedValue([tasks[1], { ...tasks[0], status: "submitted" }]);
  first.view.draft.checked_layer_ids = ["phenotype"];
  vi.spyOn(api, "submitWorkspace").mockResolvedValue({ submission_id: "submission", created_at: "2026-10-14T12:00:00Z", draft_revision: 1 } as any);
  render(<App user={testUser("alice")} />);
  fireEvent.click(await screen.findByRole("button", { name: /Finish & Submit Case/ }));
  const submit = await screen.findByRole("dialog", { name: "Submit case" });
  fireEvent.click(within(submit).getByLabelText("Entire text checked for further findings"));
  fireEvent.click(within(submit).getByRole("button", { name: "Submit case" }));
  const dialog = await screen.findByRole("dialog", { name: "Case submitted" });
  await waitFor(() => expect(api.listMyTasks).toHaveBeenCalledTimes(2));
  expect((screen.getByRole("button", { name: /Finish & Submit Case/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(open).toHaveBeenCalledTimes(1);
  expect(first.read_only).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Next task" }));
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(4));
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Select case" }) as HTMLSelectElement).value).toBe("4"));
  expect(window.location.hash).toBe("#/tasks/4");
});

it("reloads a task read-only after another session submitted it, with a visible explanation", async () => {
  const { first, open } = editorServer();
  open.mockResolvedValueOnce(assigned(first, 17)).mockResolvedValue(assigned({ ...first, read_only: true }, 17));
  const command = vi.spyOn(api, "applyCommand").mockRejectedValue(new ApiError(403, "Already submitted", "ASSIGNMENT_SUBMITTED"));
  render(<App user={testUser("alice")} />);
  fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/ }));
  await screen.findByText(/Another session submitted this task/);
  await screen.findByText("Submitted. The project lead can reopen it for changes.");
  expect(open).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: /New Annotation/ }));
  expect(command).toHaveBeenCalledTimes(1);
});

it("ignores an open response after navigating away while it was loading", async () => {
  editorServer();
  let finish!: (value: AssignmentWorkspace) => void;
  vi.mocked(api.openAssignment).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<App user={testUser("alice")} />);
  await screen.findByText("Opening task...");
  clickSection("My tasks");
  await screen.findByRole("heading", { name: "My tasks" });
  await act(async () => finish(assigned(workspaceFixture(), 17)));
  expect(screen.queryByTestId("annotator-identity")).toBeNull();
  expect(window.location.hash).toBe("#/");
});

it("refreshes displayed identity from the saved Profile response and keeps the session pseudonym", async () => {
  const { first, open } = editorServer();
  window.history.replaceState(null, "", "#/me");
  const identity = testUser("alice", { display_name: "Alice" });
  const profile = { qualification: null, username: identity.username, pseudonym: "alice", display_name: "Alice", email: null, orcid: null, orcid_consent: false, languages: [] };
  vi.spyOn(api, "getProfile").mockResolvedValue(profile);
  vi.spyOn(api, "updateOwnProfile").mockResolvedValue({ ...profile, display_name: "Alice Smith" });
  const logout = vi.fn();
  render(<App user={identity} onLogout={logout} />);
  const input = await screen.findByLabelText("Display name (required)");
  const user = userEvent.setup();
  await user.clear(input); await user.type(input, "Alice Smith ");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByTestId("current-user").textContent).toBe("Alice Smith · alice"));
  expect(logout).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  clickSection("My tasks");
  const table = await screen.findByRole("table", { name: "My tasks" });
  fireEvent.click(within(table).getAllByRole("link", { name: /^(Start|Continue|View)$/ })[0]);
  await waitFor(() => expect(screen.getByTestId("annotator-identity").textContent).toContain("Alice Smith (alice)"));
  expect(first.view.key.annotator_id).toBe("alice");
});

it.each(["ASSIGNMENT_NOT_FOUND", "ASSIGNMENT_REQUIRED", "DOCUMENT_NOT_FOUND"])("explains unavailable assignment %s with a way back", async code => {
  const { open } = editorServer();
  open.mockRejectedValue(new ApiError(404, "Unavailable", code));
  render(<App user={testUser("alice")} />);
  await screen.findByText("This task is no longer assigned to you.");
  fireEvent.click(screen.getByRole("link", { name: "Back to my tasks" }));
  await screen.findByRole("heading", { name: "My tasks" });
});

it("uses assignment identity, project/task scope and server order for select and keyboard navigation", async () => {
  const { first, second, tasks, open } = editorServer();
  vi.mocked(api.listMyTasks).mockResolvedValue([
    { ...tasks[0], assignment_id: 99, project_key: "elsewhere" }, tasks[0],
    { ...tasks[0], assignment_id: 28, task: "review" }, tasks[1],
  ]);
  render(<App user={testUser("alice")} />);
  const select = await screen.findByRole("combobox", { name: "Select case" }) as HTMLSelectElement;
  expect(Array.from(select.options).map(option => option.value)).toEqual(["17", "4"]);
  expect(select.selectedOptions[0].textContent).toContain(first.view.document.document_id);
  fireEvent.change(select, { target: { value: "4" } });
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(4));
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Select case" }) as HTMLSelectElement).selectedOptions[0].textContent).toContain(second.view.document.document_id));
  fireEvent.keyDown(document.querySelector(".text-container")!, { key: "ArrowLeft", altKey: true });
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(17));
});

it("restores browser history after cancelling Back, then lets Back and Forward navigate normally", async () => {
  const { first, second, open } = editorServer();
  vi.mocked(api.openAssignment).mockImplementation(async id => assigned(id === 17 ? first : second, id));
  vi.spyOn(api, "applyCommand").mockRejectedValue(new TypeError("Offline"));
  render(<App user={testUser("alice")} />);
  fireEvent.click(await screen.findByRole("button", { name: "Next Case" }));
  await waitFor(() => expect(window.location.hash).toBe("#/tasks/4"));
  fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/ }));
  await screen.findByText("Offline – changes not saved");
  act(() => window.history.back());
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Changes not saved" })).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(window.location.hash).toBe("#/tasks/4"));
  // The cancelled traversal must retain the previous entry, rather than replacing it with task 4.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); window.history.back(); });
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Changes not saved" })).getByRole("button", { name: "Discard edits and leave" }));
  await waitFor(() => expect(window.location.hash).toBe("#/tasks/17"));
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(17));
  act(() => window.history.forward());
  await waitFor(() => expect(window.location.hash).toBe("#/tasks/4"));
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(4));
});

async function threeTaskHistory() {
  const { first, second, tasks, open } = editorServer();
  const third = workspaceFixture("third");
  vi.mocked(api.listMyTasks).mockResolvedValue([tasks[0], { ...tasks[1], status: "open" }, taskOf(third.view, 8)]);
  open.mockImplementation(async id => assigned(id === 17 ? first : id === 4 ? second : third, id));
  vi.spyOn(api, "applyCommand").mockRejectedValue(new TypeError("Offline"));
  vi.spyOn(api, "getProfile").mockReturnValue(new Promise(() => {}));
  render(<App user={testUser("alice")} />);
  for (const id of [4, 8]) {
    fireEvent.click(await screen.findByRole("button", { name: "Next Case" }));
    await waitFor(() => expect(window.location.hash).toBe(`#/tasks/${id}`));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith(id));
  }
  fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/ }));
  await screen.findByText("Offline – changes not saved");
  act(() => window.history.back());
  const dialog = await screen.findByRole("dialog", { name: "Changes not saved" });
  await waitFor(() => expect(window.history.state.ontocuratorRouteIndex).toBe(1));
  act(() => window.history.back());
  await waitFor(() => expect(window.history.state.ontocuratorRouteIndex).toBe(0));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(window.location.hash).toBe("#/tasks/8");
  return { dialog, open };
}

it("preserves the intermediate task after two pending Back traversals are cancelled", async () => {
  const { dialog, open } = await threeTaskHistory();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(window.history.state.ontocuratorRouteIndex).toBe(2));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  act(() => window.history.back());
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Changes not saved" })).getByRole("button", { name: "Discard edits and leave" }));
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(4));
  expect(window.location.hash).toBe("#/tasks/4");
  act(() => window.history.forward());
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(8));
});

it("preserves intermediate Forward entries after discarding through two pending Back traversals", async () => {
  const { dialog, open } = await threeTaskHistory();
  fireEvent.click(within(dialog).getByRole("button", { name: "Discard edits and leave" }));
  await waitFor(() => expect(open).toHaveBeenLastCalledWith(17));
  for (const id of [4, 8]) {
    act(() => window.history.forward());
    await waitFor(() => expect(window.location.hash).toBe(`#/tasks/${id}`));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith(id));
  }
});

it("keeps historical task entries when a shell link supersedes two pending Back traversals", async () => {
  const { dialog, open } = await threeTaskHistory();
  clickSection("Profile");
  fireEvent.click(within(dialog).getByRole("button", { name: "Discard edits and leave" }));
  await waitFor(() => expect(window.location.hash).toBe("#/me"));
  for (const id of [8, 4]) {
    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toBe(`#/tasks/${id}`));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith(id));
  }
});
