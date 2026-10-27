import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, type AdminUser, type CodeResponse, type CreatedUser, type CurrentUser } from "../src/api/client";
import { auditActor, auditDetails, UsersPage } from "../src/admin/UsersPage";
import { formatDateTime, formatShortDateTime } from "../src/app/labels";

const currentUser: CurrentUser = { username: "root", display_name: "Root", pseudonym: "ann-root", is_system_admin: true, csrf_token: "csrf" };
const root: AdminUser = { qualification: null, username: "root", display_name: "Root", email: null, pseudonym: "ann-root", is_system_admin: true, active: true, languages: ["de"], projects: [], setup_pending: false, anonymised: false };
const alex: AdminUser = { ...root, username: "alex", display_name: "Alex Smith", email: "alex@example.org", pseudonym: "ann-alex", languages: ["en"], projects: [{ project_key: "study-one", project_name: "Study One", roles: ["lead", "annotator"] }] };
const created: CreatedUser = { user: { ...alex, username: "bea", display_name: "Beatrice", pseudonym: "ann-bea", is_system_admin: false, projects: [] }, code: "new-setup-secret", expires_at: "2026-10-17T12:30:00Z" };
const reset: CodeResponse = { code: "new-reset-secret", expires_at: "2026-10-17T13:30:00Z" };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const load = () => screen.findByText("Alex Smith");
const newForm = () => within(screen.getByRole("form", { name: "New user" }));
const editForm = () => within(screen.getByRole("form", { name: "Edit user" }));
/** Opens a row's More menu; with `item`, chooses that action. */
const more = (username: string, item?: string) => {
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${username}` }));
  if (item) fireEvent.click(screen.getByRole("menuitem", { name: item }));
};

beforeEach(() => {
  vi.spyOn(api, "adminListUsers").mockResolvedValue([root, alex]);
  vi.spyOn(api, "adminCreateUser").mockResolvedValue(created);
  vi.spyOn(api, "adminIssueResetCode").mockResolvedValue(reset);
  vi.spyOn(api, "adminUpdateUser").mockResolvedValue(alex);
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function fillCreate() {
  fireEvent.click(screen.getByRole("button", { name: "New user…" }));
  fireEvent.change(newForm().getByLabelText("Username (required)"), { target: { value: "bea" } });
  fireEvent.change(newForm().getByLabelText("Display name (required)"), { target: { value: "Bea" } });
}

describe("users administration", () => {
  it("lists server fields and filters by username or display name", async () => {
    render(<UsersPage currentUser={currentUser} />); await load();
    const table = within(screen.getByRole("table", { name: "Users" }));
    expect(table.getByText("ann-alex")).toBeTruthy(); expect(table.getByText("Study One: Lead, Annotator")).toBeTruthy();
    expect(table.getByText("en")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "New user" })).toBeNull(); expect(screen.getByRole("group", { name: "Users actions" }).textContent).toContain("New user…");
    fireEvent.change(screen.getByLabelText("Filter users"), { target: { value: "SMITH" } }); expect(table.queryByText("Root")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter users"), { target: { value: "root" } }); expect(table.queryByText("Alex Smith")).toBeNull();
  });

  it("creates a user and keeps the setup code transient until acknowledged close", async () => {
    const leave = { current: null as (() => Promise<boolean>) | null };
    render(<UsersPage currentUser={currentUser} routeLeaveRef={leave} />); await load(); await fillCreate();
    fireEvent.click(newForm().getByRole("button", { name: "Create user" }));
    const dialog = await screen.findByRole("dialog", { name: "Setup code for bea" });
    expect(within(dialog).getByText(created.code)).toBeTruthy();
    expect(api.adminCreateUser).toHaveBeenCalledWith({ username: "bea", display_name: "Bea", email: null, languages: [], system_admin: false, projects: [] });
    expect(await leave.current?.()).toBe(false);
    expect((within(dialog.querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().click(within(dialog).getByLabelText("I have handed over or stored the code"));
    await userEvent.setup().click(within(dialog.querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(created.code)).toBeNull(); expect(await leave.current?.()).toBe(true);
    expect(screen.getByText("Beatrice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh users" })); await load(); expect(screen.queryByText(created.code)).toBeNull();
  });

  it("issues a reset code for the selected actual username only after confirmation", async () => {
    render(<UsersPage currentUser={currentUser} />); await load();
    more("alex", "Reset code");
    let confirm = screen.getByRole("dialog", { name: "Issue a new reset code for Alex Smith?" });
    expect(confirm.textContent).toContain("Any unused code stops working.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" })); expect(api.adminIssueResetCode).not.toHaveBeenCalled();
    more("alex", "Reset code");
    confirm = screen.getByRole("dialog", { name: "Issue a new reset code for Alex Smith?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Reset code" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset code for alex" });
    expect(within(dialog).getByText(reset.code)).toBeTruthy(); expect(api.adminIssueResetCode).toHaveBeenCalledWith("alex");
  });

  it("offers a new setup code to a user whose setup is pending", async () => {
    vi.mocked(api.adminListUsers).mockResolvedValue([root, { ...alex, setup_pending: true }]);
    render(<UsersPage currentUser={currentUser} />); await load();
    more("alex", "New setup code");
    const confirm = screen.getByRole("dialog", { name: "Issue a new setup code for Alex Smith?" });
    expect(confirm.textContent).toContain("The current setup code stops working.");
    fireEvent.click(within(confirm).getByRole("button", { name: "New setup code" }));
    const dialog = await screen.findByRole("dialog", { name: "Setup code for alex" });
    expect(dialog.textContent).toContain("Your Ontotator account is ready.");
  });

  it("confirms deactivation, cancels safely and updates from the real response", async () => {
    vi.mocked(api.adminUpdateUser).mockResolvedValue({ ...alex, active: false });
    render(<UsersPage currentUser={currentUser} />); await load();
    more("alex", "Deactivate…");
    let dialog = screen.getByRole("dialog", { name: "Deactivate alex" });
    expect(within(dialog).getByText("This logs the user out everywhere.")).toBeTruthy();
    expect(api.adminUpdateUser).not.toHaveBeenCalled(); fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    more("alex", "Deactivate…"); dialog = screen.getByRole("dialog", { name: "Deactivate alex" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(api.adminUpdateUser).toHaveBeenCalledWith("alex", { active: false }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); more("alex"); expect(screen.getByRole("menuitem", { name: "Activate" })).toBeTruthy();
  });

  it("activates an inactive user without a deactivation confirmation", async () => {
    vi.mocked(api.adminListUsers).mockResolvedValue([root, { ...alex, active: false }]); vi.mocked(api.adminUpdateUser).mockResolvedValue(alex);
    render(<UsersPage currentUser={currentUser} />); await load(); more("alex", "Activate");
    await waitFor(() => expect(api.adminUpdateUser).toHaveBeenCalledWith("alex", { active: true }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Users" })).queryByText("No")).toBeNull());
  });

  it("offers no self-deactivation and disables the own administrator checkbox with an explanation", async () => {
    render(<UsersPage currentUser={currentUser} />); await load();
    more("root"); expect(screen.queryByRole("menuitem", { name: "Deactivate…" })).toBeNull(); expect(screen.getByRole("menuitem", { name: "History" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
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
    fireEvent.click(newForm().getByRole("button", { name: "Create user" })); await screen.findByRole("dialog", { name: "Setup code for bea" });
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
    else { more("alex", "Reset code"); fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset code" })); }
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

describe("account status, projects at creation, history and erasure", () => {
  const project = { project_key: "study-one", name: "Study One", description: null, roles: [], allowed_modes: [], document_count: 0, can_manage: true } as unknown as import("../src/api/client").ProjectSummary;

  it("shows setup pending and last login, and disables reset for a deactivated user", async () => {
    vi.mocked(api.adminListUsers).mockResolvedValue([{ ...root, last_login_at: "2026-10-20T08:00:00Z" }, { ...alex, active: false, setup_pending: true }]);
    render(<UsersPage currentUser={currentUser} />); await load();
    const table = within(screen.getByRole("table", { name: "Users" }));
    expect(table.getByRole("columnheader", { name: /Setup/ })).toBeTruthy();
    expect(table.getByText("Pending")).toBeTruthy();
    expect(table.getByText("Never")).toBeTruthy();
    const login = table.getByText(formatShortDateTime("2026-10-20T08:00:00Z"));
    expect(login.getAttribute("title")).toBe(formatDateTime("2026-10-20T08:00:00Z"));
    more("alex");
    expect(screen.queryByRole("menuitem", { name: "New setup code" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Activate" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Needed before a new code can be issued.")).toBeTruthy();
  });

  it("adds the new user to the chosen projects with roles", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([project]);
    render(<UsersPage currentUser={currentUser} />); await load(); await fillCreate();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Study One: Consolidator" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Study One: Annotator" }));
    fireEvent.click(newForm().getByRole("button", { name: "Create user" }));
    await screen.findByRole("dialog", { name: "Setup code for bea" });
    expect(api.adminCreateUser).toHaveBeenCalledWith(expect.objectContaining({ projects: [{ project_key: "study-one", roles: ["adjudicator", "annotator"] }] }));
  });

  it("shows a user's history in words", async () => {
    vi.spyOn(api, "adminUserAudit").mockResolvedValue([
      { at: "2026-10-20T08:00:00Z", actor: "user:root", action: "project.member_add", target_type: "user", target_id: "alex", project_key: "study-one", details: { username: "alex", roles: ["adjudicator"] } },
      { at: "2026-10-19T08:00:00Z", actor: "cli:ops", action: "user.create", target_type: "user", target_id: "alex", project_key: null, details: { pseudonym: "ann-alex", system_admin: false } },
      { at: "2026-10-18T08:00:00Z", actor: "user:alex", action: "assignment.create", target_type: "assignment", target_id: "115", project_key: "study-one", details: { task: "annotate" } },
    ]);
    render(<UsersPage currentUser={currentUser} />); await load();
    more("alex", "History");
    const dialog = await screen.findByRole("dialog", { name: "History of alex" });
    await within(dialog).findByText("Roles added");
    expect(within(dialog).getByText("Consolidator")).toBeTruthy();
    expect(within(dialog).getByText("Account created")).toBeTruthy();
    expect(within(dialog).getByText("Command line (ops)")).toBeTruthy();
    expect(within(dialog).getByText("Task assigned")).toBeTruthy();
    expect(within(dialog).getByText("Assignment 115")).toBeTruthy();
    expect(within(dialog).getByText("Task: Annotation")).toBeTruthy();
    expect(within(dialog).getByText(formatShortDateTime("2026-10-18T08:00:00Z"))).toBeTruthy();
    expect(api.adminUserAudit).toHaveBeenCalledWith("alex");
  });

  it("anonymises a deactivated user only after the username is typed", async () => {
    const erased = { ...alex, username: "anonymised-7", display_name: "Anonymised user", email: null, active: false, anonymised: true, languages: [] };
    vi.mocked(api.adminListUsers).mockResolvedValue([root, { ...alex, active: false }]);
    vi.spyOn(api, "adminAnonymiseUser").mockResolvedValue(erased);
    render(<UsersPage currentUser={currentUser} />); await load();
    more("root"); expect(screen.queryByRole("menuitem", { name: "Anonymise…" })).toBeNull(); fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    more("alex", "Anonymise…");
    const dialog = screen.getByRole("dialog", { name: "Anonymise alex" });
    expect(dialog.textContent).toContain("cannot be undone");
    const confirm = within(dialog).getByRole("button", { name: "Anonymise permanently" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Type alex to confirm/), { target: { value: "alex" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.adminAnonymiseUser).toHaveBeenCalledWith("alex", "alex");
    const table = within(screen.getByRole("table", { name: "Users" }));
    expect(table.getByText("anonymised-7")).toBeTruthy();
    expect(table.queryByText("Alex Smith")).toBeNull();
    expect(table.getByText("Anonymised")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit anonymised-7" })).toBeNull();
  });

  it("words audit details", () => {
    const base = { at: "", actor: "", action: "", target_type: "user", target_id: "x", project_key: null };
    expect(auditDetails({ ...base, details: { active: false } })).toBe("Deactivated");
    expect(auditDetails({ ...base, details: { fields: ["email"] } })).toBe("email");
    expect(auditDetails({ ...base, details: {} })).toBe("");
    expect(auditDetails({ ...base, details: { purpose: "setup" } })).toBe("Setup code");
    expect(auditDetails({ ...base, details: { task: "annotate", user_id: 4, document_id: "case-1", ok: true } })).toBe("Task: Annotation; User id: 4; Document id: case-1; Ok: yes");
  });

  it("words audit actors", () => {
    expect(auditActor("user:lena")).toBe("lena");
    expect(auditActor("cli:jan-p")).toBe("Command line (jan-p)");
    expect(auditActor("system:bootstrap")).toBe("System");
    expect(auditActor("odd")).toBe("odd");
  });
});
