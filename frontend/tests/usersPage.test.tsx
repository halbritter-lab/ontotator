import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, type AdminUser, type CodeResponse, type CreatedUser, type CurrentUser } from "../src/api/client";
import { UsersPage } from "../src/admin/UsersPage";

const currentUser: CurrentUser = { username: "root", display_name: "Root", pseudonym: "ann-root", is_system_admin: true, csrf_token: "csrf" };
const root: AdminUser = { qualification: null, username: "root", display_name: "Root", email: null, pseudonym: "ann-root", is_system_admin: true, active: true, languages: ["de"], projects: [] };
const alex: AdminUser = { ...root, username: "alex", display_name: "Alex Smith", email: "alex@example.org", pseudonym: "ann-alex", languages: ["en"], projects: [{ project_key: "study-one", roles: ["lead", "annotator"] }] };
const created: CreatedUser = { user: { ...alex, username: "bea", display_name: "Beatrice", pseudonym: "ann-bea", is_system_admin: false, projects: [] }, code: "new-setup-secret", expires_at: "2026-10-17T12:30:00Z" };
const reset: CodeResponse = { code: "new-reset-secret", expires_at: "2026-10-17T13:30:00Z" };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const load = () => screen.findByText("Alex Smith");
const newForm = () => within(screen.getByRole("form", { name: "New user" }));
const editForm = () => within(screen.getByRole("form", { name: "Edit user" }));

beforeEach(() => {
  vi.spyOn(api, "adminListUsers").mockResolvedValue([root, alex]);
  vi.spyOn(api, "adminCreateUser").mockResolvedValue(created);
  vi.spyOn(api, "adminIssueResetCode").mockResolvedValue(reset);
  vi.spyOn(api, "adminUpdateUser").mockResolvedValue(alex);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function fillCreate() {
  fireEvent.change(newForm().getByLabelText("Username (required)"), { target: { value: "bea" } });
  fireEvent.change(newForm().getByLabelText("Display name (required)"), { target: { value: "Bea" } });
}

describe("users administration", () => {
  it("lists server fields and filters by username or display name", async () => {
    render(<UsersPage currentUser={currentUser} />); await load();
    const table = within(screen.getByRole("table", { name: "Users" }));
    expect(table.getByText("ann-alex")).toBeTruthy(); expect(table.getByText("study-one: Project lead, Annotator")).toBeTruthy();
    expect(table.getByText("en")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter users"), { target: { value: "SMITH" } }); expect(table.queryByText("Root")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter users"), { target: { value: "root" } }); expect(table.queryByText("Alex Smith")).toBeNull();
  });

  it("creates a user and keeps the setup code transient until acknowledged close", async () => {
    const leave = { current: null as (() => Promise<boolean>) | null };
    render(<UsersPage currentUser={currentUser} routeLeaveRef={leave} />); await load(); await fillCreate();
    fireEvent.click(newForm().getByRole("button", { name: "Create user" }));
    const dialog = await screen.findByRole("dialog", { name: "Setup code" });
    expect(within(dialog).getByText(created.code)).toBeTruthy();
    expect(api.adminCreateUser).toHaveBeenCalledWith({ username: "bea", display_name: "Bea", email: null, languages: [], system_admin: false });
    expect(await leave.current?.()).toBe(false);
    expect((within(dialog).getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().click(within(dialog).getByLabelText("I have handed over or stored the code"));
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(created.code)).toBeNull(); expect(await leave.current?.()).toBe(true);
    expect(screen.getByText("Beatrice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh users" })); await load(); expect(screen.queryByText(created.code)).toBeNull();
  });

  it("issues a reset code for the selected actual username", async () => {
    render(<UsersPage currentUser={currentUser} />); await load();
    fireEvent.click(screen.getByRole("button", { name: "Reset code for alex" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset code" });
    expect(within(dialog).getByText(reset.code)).toBeTruthy(); expect(api.adminIssueResetCode).toHaveBeenCalledWith("alex");
  });

  it("confirms deactivation, cancels safely and updates from the real response", async () => {
    vi.mocked(api.adminUpdateUser).mockResolvedValue({ ...alex, active: false });
    render(<UsersPage currentUser={currentUser} />); await load();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate alex" }));
    let dialog = screen.getByRole("dialog", { name: "Deactivate alex" });
    expect(within(dialog).getByText("This logs the user out everywhere.")).toBeTruthy();
    expect(api.adminUpdateUser).not.toHaveBeenCalled(); fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate alex" })); dialog = screen.getByRole("dialog", { name: "Deactivate alex" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await screen.findByRole("button", { name: "Activate alex" }); expect(api.adminUpdateUser).toHaveBeenCalledWith("alex", { active: false });
  });

  it("activates an inactive user without a deactivation confirmation", async () => {
    vi.mocked(api.adminListUsers).mockResolvedValue([root, { ...alex, active: false }]); vi.mocked(api.adminUpdateUser).mockResolvedValue(alex);
    render(<UsersPage currentUser={currentUser} />); await load(); fireEvent.click(screen.getByRole("button", { name: "Activate alex" }));
    await screen.findByRole("button", { name: "Deactivate alex" }); expect(api.adminUpdateUser).toHaveBeenCalledWith("alex", { active: true });
  });

  it("disables self-deactivation and own administrator checkbox with explanations", async () => {
    render(<UsersPage currentUser={currentUser} />); await load();
    const deactivate = screen.getByRole("button", { name: "Deactivate root" }) as HTMLButtonElement;
    expect(deactivate.disabled).toBe(true); expect(deactivate.title).toContain("yourself");
    fireEvent.click(screen.getByRole("button", { name: "Edit root" }));
    const admin = editForm().getByLabelText("System administrator") as HTMLInputElement;
    expect(admin.disabled).toBe(true); expect(admin.title).toContain("own administrator");
  });

  it("sends one compound changed-only patch after one administrator-change confirmation", async () => {
    vi.mocked(api.adminUpdateUser).mockResolvedValue({ ...alex, display_name: "Server name", email: null, languages: [], is_system_admin: false });
    render(<UsersPage currentUser={currentUser} />); await load(); fireEvent.click(screen.getByRole("button", { name: "Edit alex" }));
    fireEvent.change(editForm().getByLabelText("Display name (required)"), { target: { value: "Edited name" } });
    fireEvent.change(editForm().getByLabelText("E-mail"), { target: { value: "" } });
    fireEvent.click(editForm().getByRole("button", { name: "Remove en" })); fireEvent.click(editForm().getByLabelText("System administrator"));
    fireEvent.click(editForm().getByRole("button", { name: "Save changes" }));
    const confirm = screen.getByRole("dialog", { name: "Change administrator role" }); expect(api.adminUpdateUser).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Save changes" }));
    await screen.findByText("Server name"); expect(api.adminUpdateUser).toHaveBeenCalledOnce();
    expect(api.adminUpdateUser).toHaveBeenCalledWith("alex", { display_name: "Edited name", email: null, languages: [], is_system_admin: false });
  });

  it("sends only edited fields and closes an unchanged edit without an API write", async () => {
    render(<UsersPage currentUser={currentUser} />); await load(); fireEvent.click(screen.getByRole("button", { name: "Edit alex" }));
    fireEvent.click(editForm().getByRole("button", { name: "Save changes" })); expect(api.adminUpdateUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit alex" })); fireEvent.change(editForm().getByLabelText("Display name (required)"), { target: { value: "Alex Jones" } });
    fireEvent.click(editForm().getByRole("button", { name: "Save changes" })); await screen.findByRole("button", { name: "Edit alex" });
    expect(api.adminUpdateUser).toHaveBeenCalledWith("alex", { display_name: "Alex Jones" });
  });

  it("keeps create input after a server refusal and allows correction", async () => {
    vi.mocked(api.adminCreateUser).mockRejectedValue(new ApiError(422, "Already used", "USERNAME_TAKEN"));
    render(<UsersPage currentUser={currentUser} />); await load(); await fillCreate(); fireEvent.click(newForm().getByRole("button", { name: "Create user" }));
    await screen.findByText("This username is already taken. Choose another username.");
    expect((newForm().getByLabelText("Username (required)") as HTMLInputElement).value).toBe("bea");
  });

  it("keeps edits after session expiry without adding another login dialog", async () => {
    vi.mocked(api.adminUpdateUser).mockRejectedValue(new AuthError("Ended", undefined, "NOT_AUTHENTICATED", 401));
    render(<UsersPage currentUser={currentUser} />); await load(); fireEvent.click(screen.getByRole("button", { name: "Edit alex" }));
    fireEvent.change(editForm().getByLabelText("Display name (required)"), { target: { value: "Unsaved name" } }); fireEvent.click(editForm().getByRole("button", { name: "Save changes" }));
    await screen.findByText("Your session has ended. Please log in again.");
    expect((editForm().getByLabelText("Display name (required)") as HTMLInputElement).value).toBe("Unsaved name"); expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("retains native language validation and submits normalized selected languages", async () => {
    render(<UsersPage currentUser={currentUser} />); await load(); await fillCreate();
    const language = newForm().getByLabelText("Languages") as HTMLInputElement;
    fireEvent.change(language, { target: { value: "invalid" } });
    act(() => (screen.getByRole("form", { name: "New user" }) as HTMLFormElement).requestSubmit()); expect(api.adminCreateUser).not.toHaveBeenCalled();
    fireEvent.change(language, { target: { value: "DE" } }); fireEvent.keyDown(language, { key: "Enter" });
    fireEvent.click(newForm().getByRole("button", { name: "Create user" })); await screen.findByRole("dialog", { name: "Setup code" });
    expect(api.adminCreateUser).toHaveBeenCalledWith(expect.objectContaining({ languages: ["de"] }));
  });

  it("blocks duplicate create actions while pending and ignores a reply after unmount", async () => {
    const pending = deferred<CreatedUser>(); vi.mocked(api.adminCreateUser).mockReturnValue(pending.promise);
    const view = render(<UsersPage currentUser={currentUser} />); await load(); await fillCreate();
    fireEvent.click(newForm().getByRole("button", { name: "Create user" })); fireEvent.click(newForm().getByRole("button", { name: "Create user" })); expect(api.adminCreateUser).toHaveBeenCalledOnce();
    view.unmount(); await act(async () => pending.resolve(created)); expect(screen.queryByText(created.code)).toBeNull();
  });

  it("retries list failure and ignores stale StrictMode loads", async () => {
    const old = deferred<AdminUser[]>(); vi.mocked(api.adminListUsers).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error("Offline"));
    render(<StrictMode><UsersPage currentUser={currentUser} /></StrictMode>); await screen.findByText("Offline");
    fireEvent.click(screen.getByRole("button", { name: "Refresh users" })); await load();
    await act(async () => old.resolve([{ ...root, display_name: "Stale account" }])); expect(screen.queryByText("Stale account")).toBeNull();
  });

  it("does not clear a newer route guard owned by another page during cleanup", async () => {
    const leave = { current: null as (() => Promise<boolean>) | null }; const other = async () => false;
    const view = render(<UsersPage currentUser={currentUser} routeLeaveRef={leave} />); await load(); leave.current = other; view.unmount(); expect(leave.current).toBe(other);
  });

  it.each(["create", "reset"])("blocks route leave during pending %s issuance and releases it after refusal", async operation => {
    const pending = deferred<CreatedUser>();
    if (operation === "create") vi.mocked(api.adminCreateUser).mockReturnValue(pending.promise);
    else vi.mocked(api.adminIssueResetCode).mockReturnValue(pending.promise);
    const leave = { current: null as (() => Promise<boolean>) | null };
    render(<UsersPage currentUser={currentUser} routeLeaveRef={leave} />); await load();
    if (operation === "create") { await fillCreate(); fireEvent.click(newForm().getByRole("button", { name: "Create user" })); }
    else fireEvent.click(screen.getByRole("button", { name: "Reset code for alex" }));
    expect(await leave.current?.()).toBe(false);
    await act(async () => pending.reject(new Error("Issuance failed")));
    await screen.findByText("Issuance failed"); expect(await leave.current?.()).toBe(true);
  });
});

describe("users page access", () => {
  it("shows only an explanation to someone who is not a system administrator", () => {
    render(<UsersPage currentUser={{ ...currentUser, is_system_admin: false }} />);
    expect(screen.getByText(/Only system administrators can see and manage user accounts/)).toBeDefined();
    expect(screen.queryByRole("form", { name: "New user" })).toBeNull();
    expect(screen.queryByLabelText("Filter users")).toBeNull();
    expect(api.adminListUsers).not.toHaveBeenCalled();
  });

  it("drops the create form when the server refuses the user list", async () => {
    vi.mocked(api.adminListUsers).mockRejectedValue(new ApiError(403, "Only a system administrator may do this.", "NOT_ALLOWED"));
    render(<UsersPage currentUser={currentUser} />);
    await screen.findByText(/Only system administrators can see and manage user accounts/);
    expect(screen.queryByRole("form", { name: "New user" })).toBeNull();
  });
});
