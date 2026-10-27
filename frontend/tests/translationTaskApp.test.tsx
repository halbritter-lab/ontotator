import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, ApiError, type Profile } from "../src/api/client";
import { MyTasks } from "../src/tasks/MyTasks";
import { ProfilePage } from "../src/me/ProfilePage";
import { TaskEditor } from "../src/tasks/TaskEditor";
import { AuthGate } from "../src/app/AuthGate";
import { reviewWorkspace } from "./translationFixtures";
import { testUser } from "./session";
beforeEach(() => { vi.spyOn(api, 'listSourceObligations').mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); api.setCsrfToken(null); window.history.replaceState(null, "", "#/"); });
const profile: Profile = { username: "alice", display_name: "Alice", pseudonym: "R", email: null, orcid: null, orcid_consent: false, languages: ["en", "de"], qualification: null };

it("dispatches a deep-linked owned translation task through metadata without annotation-open", async () => {
  const workspace = reviewWorkspace();
  window.history.replaceState(null, "", "#/tasks/17");
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  const metadata = vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ ...workspace.assignment, display_name: "Alice" });
  const review = vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  const annotation = vi.spyOn(api, "openAssignment").mockRejectedValue(new ApiError(404, "No annotation work", "ASSIGNMENT_NOT_FOUND"));
  render(<App user={testUser("alice")} />);
  await screen.findByRole("textbox", { name: "Translation (de)" });
  expect(metadata).toHaveBeenCalledWith(17); expect(review).toHaveBeenCalledWith(17); expect(annotation).not.toHaveBeenCalled();
  expect(screen.getAllByRole("banner")).toHaveLength(1);
});
it("conceals refused task metadata without opening either workspace", async () => {
  vi.spyOn(api, "getAssignmentMetadata").mockRejectedValue(new ApiError(404, "Concealed", "ASSIGNMENT_NOT_FOUND"));
  const review = vi.spyOn(api, "openTranslationReview"), annotation = vi.spyOn(api, "openAssignment");
  render(<TaskEditor assignmentId={17} user={testUser("alice")} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  await screen.findByText("Task not found or not yours");
  expect(review).not.toHaveBeenCalled(); expect(annotation).not.toHaveBeenCalled();
});
it("discards late task metadata after changing user and assignment", async () => {
  const workspace = reviewWorkspace();
  let finish!: (value: Awaited<ReturnType<typeof api.getAssignmentMetadata>>) => void;
  const metadata = vi.spyOn(api, "getAssignmentMetadata").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockRejectedValueOnce(new ApiError(404, "Concealed", "ASSIGNMENT_NOT_FOUND"));
  const review = vi.spyOn(api, "openTranslationReview"), annotation = vi.spyOn(api, "openAssignment");
  const props = { onNavigate: vi.fn(), routeLeaveRef: { current: null }, leaveGuardRef: { current: null } };
  const mounted = render(<TaskEditor {...props} assignmentId={17} user={testUser("alice")} />);
  mounted.rerender(<TaskEditor {...props} assignmentId={23} user={testUser("bob")} />);
  await screen.findByText("Task not found or not yours");
  await act(async () => { finish({ ...workspace.assignment, display_name: "Alice" }); });
  expect(metadata.mock.calls.map(args => args[0])).toEqual([17, 23]);
  expect(review).not.toHaveBeenCalled(); expect(annotation).not.toHaveBeenCalled();
});
it("labels translation tasks with actual source/target languages and external identity", async () => {
  vi.spyOn(api, "listMyTasks").mockResolvedValue([{ assignment_id: 17, workflow_revision: 0, held: false, project_key: "proj", project_name: "Project", document_id: "opaque-internal", external_id: "EN 1/7", language: "de", source_language: "en", target_language: "de", task: "translation_review", status: "submitted", updated_at: "2026-10-16T12:00:00Z" }]);
  render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
  expect(await screen.findByText("Translation review (en to de)")).toBeDefined();
  expect(screen.getByText("EN 1/7 de")).toBeDefined();
  expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toBe("#/tasks/17");
});
it("edits own qualification and sends only its changed field", async () => {
  vi.spyOn(api, "getProfile").mockResolvedValue(profile);
  const save = vi.spyOn(api, "updateOwnProfile").mockResolvedValue({ ...profile, qualification: "Reviewer" });
  render(<ProfilePage />);
  const input = await screen.findByRole("textbox", { name: "Qualification" });
  expect(input.getAttribute("maxlength")).toBe("200");
  fireEvent.change(input, { target: { value: "Reviewer" } });
  fireEvent.click(within(screen.getByRole("form", { name: "Profile" })).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ qualification: "Reviewer" }));
});

function appReview() {
  window.history.replaceState(null, "", "#/tasks/17");
  const workspace = reviewWorkspace({ qualification: null });
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ ...workspace.assignment, display_name: "Alice" });
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  vi.spyOn(api, "getProfile").mockResolvedValue(profile);
  const save = vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 31 });
  const logout = vi.fn(); render(<App user={testUser("alice")} onLogout={logout} />);
  return { save, logout };
}
function section(name: string) {
  const disclosure = document.querySelector<HTMLDetailsElement>(".shell-reading-navigation");
  if (disclosure && !disclosure.open) fireEvent.click(disclosure.querySelector("summary")!);
  fireEvent.click(screen.getByRole("link", { name }));
}
it("flushes raw review work before following its real qualification profile link", async () => {
  const { save } = appReview();
  let finish!: (value: { revision: number }) => void;
  save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const input = await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.change(input, { target: { value: "Preserve this correction" } });
  fireEvent.click(screen.getByRole("link", { name: "Add your qualification in your profile" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(17, { text: "Preserve this correction", form: { decision: "accepted_corrected", clinical_change: false }, expected_revision: 6 }));
  expect(window.location.hash).toBe("#/tasks/17"); expect(screen.getByRole("textbox", { name: "Translation (de)" })).toBe(input);
  await act(async () => { finish({ revision: 31 }); });
  await screen.findByRole("heading", { name: "Profile" }); expect(window.location.hash).toBe("#/me");
});
it("keeps the mounted review and history on cancelled raw-hash leave, then explicitly discards", async () => {
  const { save } = appReview(); save.mockRejectedValue(new TypeError("Offline"));
  const input = await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.change(input, { target: { value: "Keep raw text" } });
  act(() => { window.location.hash = "#/me"; });
  const dialog = await screen.findByRole("dialog", { name: "Changes not saved" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(window.location.hash).toBe("#/tasks/17"));
  await waitFor(() => expect(window.history.state.ontotatorRouteIndex).toBe(0));
  expect(screen.getByRole("textbox", { name: "Translation (de)" })).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe("Keep raw text");
  section("Profile");
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Changes not saved" })).getByRole("button", { name: "Discard edits and leave" }));
  await screen.findByRole("heading", { name: "Profile" });
});
it("keeps shell logout behind explicit save/discard/cancel and does not call logout after failed save", async () => {
  const { save, logout } = appReview(); save.mockRejectedValue(new TypeError("Offline"));
  fireEvent.change(await screen.findByRole("textbox", { name: "Translation (de)" }), { target: { value: "Not saved" } });
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  let dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })); expect(logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save and log out" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((within(dialog).getByRole("button", { name: "Discard and log out" }) as HTMLButtonElement).disabled).toBe(false));
  expect(logout).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Discard and log out" })); expect(logout).toHaveBeenCalledTimes(1);
});
it("guards unsaved own qualification and retains it after a failed save-and-leave", async () => {
  vi.spyOn(api, "getProfile").mockResolvedValue(profile);
  const save = vi.spyOn(api, "updateOwnProfile").mockRejectedValue(new TypeError("Offline"));
  const ref: { current: (() => Promise<boolean>) | null } = { current: null };
  render(<ProfilePage routeLeaveRef={ref} />);
  const input = await screen.findByRole("textbox", { name: "Qualification" }); fireEvent.change(input, { target: { value: "Reviewer" } });
  let leaving!: Promise<boolean>; act(() => { leaving = ref.current!(); });
  const dialog = screen.getByRole("dialog", { name: "Unsaved profile changes" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save and leave" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ qualification: "Reviewer" }));
  await waitFor(() => expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })); expect(await leaving).toBe(false);
  expect((input as HTMLInputElement).value).toBe("Reviewer");
});

it.each(["alice", "bob"])("uses the real AuthGate after an expired translation save and login as %s", async nextUsername => {
  window.history.replaceState(null, "", "#/tasks/17");
  const workspace = reviewWorkspace();
  const initial = testUser("alice", { csrf_token: "old-token" });
  const next = testUser(nextUsername, { csrf_token: "fresh-token" });
  vi.spyOn(api, "me").mockImplementation(async () => { api.setCsrfToken(initial.csrf_token); return initial; });
  vi.spyOn(api, "listProjects").mockResolvedValue([]); vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  const metadata = vi.spyOn(api, "getAssignmentMetadata").mockResolvedValueOnce({ ...workspace.assignment, display_name: "Alice" })
    .mockRejectedValue(new ApiError(404, "Concealed", "ASSIGNMENT_NOT_FOUND"));
  const open = vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  let authenticated = false;
  const writes: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === "/api/v1/auth/login") { authenticated = true; return { ok: true, status: 200, json: async () => next }; }
    if (url === "/api/v1/translation-reviews/17/draft") {
      writes.push(init);
      return authenticated ? { ok: true, status: 200, json: async () => ({ revision: 42 }) }
        : { ok: false, status: 401, json: async () => ({ code: "NOT_AUTHENTICATED", details: "Log in to continue." }) };
    }
    throw new Error(`Unexpected request ${url}`);
  }));
  render(<AuthGate />);
  const input = await screen.findByRole("textbox", { name: "Translation (de)" });
  fireEvent.change(input, { target: { value: "Unsaved Alice text" } });
  const dialog = await screen.findByRole("dialog", { name: "Log in to Ontotator" });
  expect(input.closest("[inert]")).not.toBeNull();
  fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: nextUsername } });
  fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "a long password" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log in to Ontotator" })).toBeNull());
  if (nextUsername === "alice") {
    expect(screen.getByRole("textbox", { name: "Translation (de)" })).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe("Unsaved Alice text");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect((writes[1].headers as Headers).get("X-CSRF-Token")).toBe("fresh-token");
    expect(JSON.parse(writes[1].body as string)).toEqual({ expected_revision: 6, text: "Unsaved Alice text", form: { decision: "accepted_corrected", clinical_change: false } });
    expect(metadata).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1);
  } else {
    // Another user starts afresh at "#/": the landing opens Projects, as they have no last-used project (F8).
    await screen.findByRole('heading', { name: 'Projects', level: 1 });
    expect(window.location.hash).toBe('#/projects');
    expect(screen.queryByDisplayValue("Unsaved Alice text")).toBeNull();
    expect(writes).toHaveLength(1); expect(metadata).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1);
  }
});
it("names the task in the breadcrumb and keeps the assignment number in its title", async () => {
  const workspace = reviewWorkspace();
  window.history.replaceState(null, "", "#/tasks/17");
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  let finish!: (tasks: Awaited<ReturnType<typeof api.listMyTasks>>) => void;
  const tasks = new Promise<Awaited<ReturnType<typeof api.listMyTasks>>>(resolve => { finish = resolve; });
  vi.spyOn(api, "listMyTasks").mockReturnValue(tasks);
  vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ ...workspace.assignment, display_name: "Alice" });
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  render(<App user={testUser("alice")} />);
  const breadcrumb = await screen.findByRole("navigation", { name: "Breadcrumb" });
  const current = () => breadcrumb.querySelector('[aria-current="page"]')!;
  expect(current().textContent).toBe("Task");
  expect(current().getAttribute("title")).toBe("Assignment 17");
  expect(breadcrumb.textContent).not.toMatch(/Task 17/);
  await act(async () => { finish([{ assignment_id: 17, workflow_revision: 0, held: false, project_key: "proj", project_name: "Project", document_id: "opaque-internal", external_id: "EN 1/7", language: "de", source_language: "en", target_language: "de", task: "translation_review", status: "in_progress", updated_at: "2026-10-16T12:00:00Z" }]); });
  await waitFor(() => expect(current().textContent).toBe("EN 1/7, Translation review (de)"));
  expect(current().getAttribute("title")).toBe("Assignment 17");
  expect(within(breadcrumb).getByRole("button", { name: "My tasks" })).toBeDefined();
});
