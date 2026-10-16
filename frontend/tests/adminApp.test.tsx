import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { AuthGate } from "../src/app/AuthGate";
import { api, ApiError, type AdminUser, type CreatedUser, type ProjectSummary } from "../src/api/client";
import { testUser } from "./session";
import { deferred, ontologies, settings } from "./projectFixtures";

const user = testUser("root", { username: "root", is_system_admin: true });
const alex: AdminUser = { username: "alex", display_name: "Alex", email: null, pseudonym: "ann-alex", is_system_admin: false, active: true, languages: [], projects: [] };
const created: CreatedUser = { user: { ...alex, username: "bea" }, code: "setup-secret", expires_at: "2026-10-17T12:30:00Z" };
const project: ProjectSummary = { project_key: settings.project_key, name: settings.name, can_manage: true, document_count: 0, description: null, roles: ["lead"], allowed_modes: ["independent"] };
beforeEach(() => {
  window.history.replaceState(null, "", "#/admin/users");
  vi.spyOn(api, "listProjects").mockResolvedValue([project]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.spyOn(api, "adminListUsers").mockResolvedValue([alex]);
  vi.spyOn(api, "listOntologies").mockResolvedValue(ontologies);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); api.setCsrfToken(null); window.history.replaceState(null, "", "#/"); });
const link = (name: string) => fireEvent.click(screen.getByRole("link", { name }));
const logout = () => fireEvent.click(screen.getByRole("button", { name: "Log out" }));
async function create() {
  const form = await screen.findByRole("form", { name: "New user" });
  fireEvent.change(within(form).getByLabelText("Username (required)"), { target: { value: "bea" } });
  fireEvent.change(within(form).getByLabelText("Display name (required)"), { target: { value: "Bea" } });
  fireEvent.click(within(form).getByRole("button", { name: "Create user" }));
}

it("keeps pending issuance and visible one-time code through shell/hash/logout until actual Close", async () => {
  const pending = deferred<CreatedUser>();
  vi.spyOn(api, "adminCreateUser").mockReturnValue(pending.promise);
  const onLogout = vi.fn(); render(<App user={user} onLogout={onLogout} />);
  await create();
  await waitFor(() => expect(api.adminCreateUser).toHaveBeenCalledOnce());
  link("My tasks"); logout();
  await act(async () => {});
  expect(window.location.hash).toBe("#/admin/users"); expect(onLogout).not.toHaveBeenCalled();
  act(() => { window.location.hash = "#/me"; });
  await waitFor(() => expect(window.location.hash).toBe("#/admin/users"));
  await act(async () => pending.resolve(created));
  const dialog = await screen.findByRole("dialog", { name: "Setup code" });
  link("My tasks"); logout(); await act(async () => {});
  expect(screen.getByText("setup-secret")).toBeTruthy(); expect(onLogout).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByLabelText("I have handed over or stored the code"));
  link("My tasks"); logout(); await act(async () => {});
  expect(window.location.hash).toBe("#/admin/users"); expect(onLogout).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  logout(); await waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
  link("My tasks"); await screen.findByRole("heading", { name: "My tasks" });
  expect(screen.queryByText("setup-secret")).toBeNull();
});

it("uses controlled document query routes and actual managed-project documents", async () => {
  window.history.replaceState(null, "", "#/projects/p%2Fkey/documents?language=de&status=invalid&q=ID&select=ID%20%2B%2F%C3%9F");
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue([{ document_id: "ID +/ß", language: "de", status: "not_started", position: null, text_length: 4 }] as never);
  render(<App user={user} />);
  await screen.findByText("ID +/ß");
  expect(api.listProjectDocuments).toHaveBeenLastCalledWith("p/key", { language: "de", status: undefined, q: "ID" });
  expect(screen.getByLabelText("Select ID +/ß")).toHaveProperty("checked", true);
  expect(screen.getByRole("link", { name: "Documents" }).getAttribute("aria-current")).toBe("page");
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "open" } });
  await waitFor(() => expect(window.location.hash).toBe("#/projects/p%2Fkey/documents?language=de&status=open&q=ID"));
  await waitFor(() => expect(api.listProjectDocuments).toHaveBeenLastCalledWith("p/key", { language: "de", status: "open", q: "ID" }));
});

it("restores native history during reset issuance and acknowledged code, then permits Back and Forward after Close", async () => {
  window.history.replaceState(null, "", "#/");
  const pending = deferred<{ code: string; expires_at: string }>();
  vi.spyOn(api, "adminIssueResetCode").mockReturnValue(pending.promise);
  render(<App user={user} />);
  await screen.findByRole("heading", { name: "My tasks" });
  link("Users");
  fireEvent.click(await screen.findByRole("button", { name: "Reset code for alex" }));
  act(() => window.history.back());
  // Native traversal and the controller's return traversal both run asynchronously.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 70)); });
  expect(window.location.hash).toBe("#/admin/users");
  expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
  await act(async () => pending.resolve({ code: "reset-secret", expires_at: created.expires_at }));
  const dialog = await screen.findByRole("dialog", { name: "Reset code" });
  fireEvent.click(within(dialog).getByLabelText("I have handed over or stored the code"));
  act(() => window.history.back());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 70)); });
  expect(window.location.hash).toBe("#/admin/users"); expect(screen.getByText("reset-secret")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  act(() => window.history.back());
  await screen.findByRole("heading", { name: "My tasks" });
  act(() => window.history.forward());
  await screen.findByRole("heading", { name: "Users" });
  expect(screen.queryByText("reset-secret")).toBeNull();
});

it("guards ordinary user writes without opening a new leave dialog", async () => {
  const pending = deferred<AdminUser>();
  vi.spyOn(api, "adminUpdateUser").mockReturnValue(pending.promise);
  const onLogout = vi.fn(); render(<App user={user} onLogout={onLogout} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit alex" }));
  const form = screen.getByRole("form", { name: "Edit user" });
  fireEvent.change(within(form).getByLabelText("Display name (required)"), { target: { value: "Alex updated" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(api.adminUpdateUser).toHaveBeenCalledOnce());
  link("My tasks"); logout(); await act(async () => {});
  expect(window.location.hash).toBe("#/admin/users"); expect(onLogout).not.toHaveBeenCalled();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.queryByRole("dialog", { name: "Changes not saved" })).toBeNull();
  await act(async () => pending.resolve({ ...alex, display_name: "Alex updated" }));
  link("My tasks"); await screen.findByRole("heading", { name: "My tasks" });
});

it("refreshes authoritative project navigation after creation and a saved name", async () => {
  window.history.replaceState(null, "", "#/projects/new");
  vi.mocked(api.listProjects).mockResolvedValueOnce([]).mockResolvedValueOnce([project])
    .mockResolvedValue([{ ...project, name: "Returned server name" }]);
  vi.spyOn(api, "listTemplates").mockResolvedValue([{ id: "template", label: "Template", required_ontology_ids: [] }]);
  vi.spyOn(api, "createProject").mockResolvedValue(settings);
  vi.spyOn(api, "updateProjectSettings").mockResolvedValue({ ...settings, name: "Returned server name" });
  render(<App user={user} />);
  fireEvent.change(await screen.findByLabelText(/^Built-in template/), { target: { value: "template" } });
  fireEvent.change(screen.getByLabelText(/^Project key/), { target: { value: "requested-key" } });
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Requested name" } });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("heading", { name: "Project settings" });
  expect(window.location.hash).toBe("#/projects/p%2Fkey/settings");
  await screen.findByRole("region", { name: "Research (p/key)" });
  fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Edited name" } });
  fireEvent.click(screen.getByRole("button", { name: "Save general" }));
  await screen.findByRole("region", { name: "Returned server name (p/key)" });
  expect(api.updateProjectSettings).toHaveBeenCalledWith("p/key", { name: "Edited name", description: "Original", languages: ["de"] });
  expect(api.listProjects).toHaveBeenCalledTimes(3);
  expect(screen.getByLabelText(/^Name/)).toHaveProperty("value", "Returned server name");
});

it("loads ontology administration only on its route and follows actual pinned-project links", async () => {
  window.history.replaceState(null, "", "#/");
  vi.spyOn(api, "adminListOntologies").mockResolvedValue([{ filename: "hp.json", kind: "ontology", prefix: "HP", release: "2026", language: null, sha256: "a".repeat(64), uploaded_at: "2026-10-01T12:00:00Z", projects: ["p/key"] }] as never);
  render(<App user={user} />);
  await screen.findByRole("heading", { name: "My tasks" });
  expect(api.adminListUsers).not.toHaveBeenCalled(); expect(api.adminListOntologies).not.toHaveBeenCalled();
  expect(api.getProjectSettings).not.toHaveBeenCalled(); expect(api.listOntologies).not.toHaveBeenCalled();
  link("Ontologies"); await screen.findByText("hp.json");
  link("p/key"); await screen.findByRole("heading", { name: "Project settings" });
  expect(api.getProjectSettings).toHaveBeenCalledWith("p/key");
});

it.each([403, 404])("retains the server's managed-route denial (%s) without inventing local rights", async status => {
  window.history.replaceState(null, "", "#/projects/private/settings");
  vi.mocked(api.listProjects).mockResolvedValue([]);
  vi.mocked(api.getProjectSettings).mockRejectedValue(new ApiError(status, "private", status === 403 ? "NOT_ALLOWED" : "PROJECT_NOT_FOUND"));
  render(<App user={{ ...user, is_system_admin: false }} />);
  await screen.findByText(status === 403 ? "You do not have permission to do this." : "You do not have access to this project, or it no longer exists.");
  expect(api.getProjectSettings).toHaveBeenCalledWith("private");
  expect(screen.queryByRole("button", { name: "Save general" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
});

it("sends actual Users writes with CSRF and keeps its form through the existing session recovery", async () => {
  vi.spyOn(api, "me").mockImplementation(async () => { api.setCsrfToken("csrf-admin"); return user; });
  vi.spyOn(api, "login").mockImplementation(async () => { api.setCsrfToken("csrf-renewed"); return user; });
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "NOT_AUTHENTICATED" }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthGate />);
  const form = await screen.findByRole("form", { name: "New user" });
  await create();
  await screen.findByText("Your session has ended. Please log in again.");
  expect(document.contains(form)).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
  const [endpoint, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(endpoint).toBe("/api/v1/admin/users/");
  expect(options.method).toBe("POST"); expect(options.credentials).toBe("same-origin");
  expect((options.headers as Headers).get("X-CSRF-Token")).toBe("csrf-admin");
  expect(JSON.parse(options.body as string)).toEqual({ username: "bea", display_name: "Bea", email: null, languages: [], system_admin: false });
  const login = screen.getByRole("dialog", { name: "Log in to Ontocurator" });
  fireEvent.change(within(login).getByLabelText(/^Username/), { target: { value: "root" } });
  fireEvent.change(within(login).getByLabelText(/^Password/), { target: { value: "correct-password" } });
  fireEvent.click(within(login).getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log in to Ontocurator" })).toBeNull());
  expect(screen.getByRole("form", { name: "New user" })).toBe(form);
  expect(within(form).getByLabelText("Username (required)")).toHaveProperty("value", "bea");
  expect(api.adminListUsers).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce(); // Recovery does not silently retry code issuance.
});
