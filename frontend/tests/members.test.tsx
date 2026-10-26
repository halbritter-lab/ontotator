import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { MembersSection, roleChangeText } from "../src/admin/MembersSection";
import { deferred, members } from "./projectFixtures";

beforeEach(() => {
  vi.spyOn(api, "listMembers").mockResolvedValue(members);
  vi.spyOn(api, "setMemberRoles").mockImplementation(async (_key, username, roles) => ({ ...members[0], username, roles }));
  vi.spyOn(api, "adminListUsers").mockResolvedValue([]);
  vi.spyOn(api, "listMemberCandidates").mockResolvedValue([]);
});
const confirmRemoval = async (label: string) => fireEvent.click(await screen.findByRole("button", { name: label }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("project members", () => {
  it("renders actual metadata and saves role toggles, including empty removal", async () => {
    render(<MembersSection projectKey="p/key" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice: Consolidator" }));
    expect(api.setMemberRoles).toHaveBeenCalledWith("p/key", "alice", ["annotator", "adjudicator"], false);
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "alice: Consolidator" }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText("Alice (ann-1)")).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Username" })).toBeDefined();
    fireEvent.click(screen.getByRole("checkbox", { name: "lead: Lead" }));
    await confirmRemoval("Remove from project");
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "lead: Lead" })).toBeNull());
    expect(api.setMemberRoles).toHaveBeenLastCalledWith("p/key", "lead", [], false);
    expect(api.adminListUsers).not.toHaveBeenCalled();
  });

  it("shows LAST_LEAD inline without optimistically removing the role", async () => {
    vi.mocked(api.setMemberRoles).mockRejectedValue(new ApiError(409, "Cannot remove", "LAST_LEAD"));
    render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "lead: Lead" }));
    await confirmRemoval("Remove from project");
    expect(await screen.findByRole("alert")).toBeDefined();
    expect((screen.getByRole("checkbox", { name: "lead: Lead" }) as HTMLInputElement).checked).toBe(true);
  });

  it("confirms all actual affected assignment details before resending with revocation", async () => {
    vi.mocked(api.setMemberRoles).mockRejectedValueOnce(new ApiError(409, "Has work", "MEMBER_HAS_ASSIGNMENTS", { assignments: [{ id: 2, document_id: "doc-reopened", task: "annotate" }, { id: 3, document_id: "doc-in-progress", task: "review" }] })).mockResolvedValueOnce({ ...members[0], roles: [] });
    render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice: Annotator" }));
    await confirmRemoval("Remove from project");
    const confirm = await screen.findByRole("button", { name: "Remove and revoke their open assignments" });
    expect(screen.getByText(/doc-reopened/)).toBeDefined();
    expect(screen.getByText(/doc-in-progress/)).toBeDefined();
    expect(api.setMemberRoles).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.setMemberRoles).toHaveBeenLastCalledWith("p", "alice", [], true);
    expect(screen.queryByRole("checkbox", { name: "alice: Annotator" })).toBeNull();
  });

  it("cancels role-loss confirmation without another write", async () => {
    vi.mocked(api.setMemberRoles).mockRejectedValue(new ApiError(409, "Has work", "MEMBER_HAS_ASSIGNMENTS", { assignments: [{ id: 2, document_id: "doc", task: "annotate" }] }));
    render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice: Annotator" }));
    await confirmRemoval("Remove from project");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(api.setMemberRoles).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("checkbox", { name: "alice: Annotator" }) as HTMLInputElement).checked).toBe(true);
  });

  it("asks before taking a role away, says it logs the person out, and cancels without a write", async () => {
    render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice: Annotator" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Alice from the project?" });
    expect(dialog.textContent).toContain("Alice loses access to this project.");
    expect(dialog.textContent).toContain("This logs Alice out of Ontocurator on all devices");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.setMemberRoles).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox", { name: "alice: Annotator" }) as HTMLInputElement).checked).toBe(true);
  });

  it("suggests matching people to a lead from three typed letters on", async () => {
    vi.mocked(api.listMemberCandidates).mockResolvedValue([{ username: "maria.k", display_name: "Maria Klein" }]);
    const view = render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add member…" }));
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "ma" } });
    expect(api.listMemberCandidates).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "mar" } });
    expect(api.listMemberCandidates).toHaveBeenCalledWith("p", "mar");
    await waitFor(() => expect(view.container.querySelector("datalist option")?.getAttribute("value")).toBe("maria.k"));
    expect(view.container.querySelector("datalist option")?.textContent).toBe("Maria Klein (maria.k)");
  });

  it("says plainly when the typed username does not exist", async () => {
    vi.mocked(api.setMemberRoles).mockRejectedValue(new ApiError(409, "There is no user 'mraia'.", "USER_NOT_FOUND"));
    render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add member…" }));
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "mraia" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "New member: Annotator" }));
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect((await screen.findByRole("alert")).textContent).toContain("There is no user with this username. Check the spelling.");
  });

  it("adds a typed username without loading the whole user list", async () => {
    const view = render(<MembersSection projectKey="p" isSystemAdmin={true} />);
    // The form stays closed until "Add member…".
    expect(screen.queryByRole("form", { name: "Add member" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Add member…" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Username/));
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: "new.user" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "New member: Annotator" }));
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(api.setMemberRoles).toHaveBeenCalledWith("p", "new.user", ["annotator"], false);
    await screen.findByRole("checkbox", { name: "new.user: Annotator" });
    // The form stays open for the next member; Close collapses it.
    expect((screen.getByLabelText(/^Username/) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("form", { name: "Add member" })).toBeNull();
    view.rerender(<MembersSection projectKey="q" isSystemAdmin={false} />);
    await screen.findByRole("checkbox", { name: "alice: Annotator" });
    expect(api.adminListUsers).not.toHaveBeenCalled();
  });

  it("blocks repeated role changes while a write is pending and ignores unmounted replies", async () => {
    const pending = deferred<typeof members[0]>();
    vi.mocked(api.setMemberRoles).mockReturnValue(pending.promise);
    const view = render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    const checkbox = await screen.findByRole("checkbox", { name: "alice: Consolidator" });
    fireEvent.click(checkbox); fireEvent.click(checkbox);
    expect(api.setMemberRoles).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { pending.resolve({ ...members[0], roles: [] }); });
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("role change confirmation (M-8d)", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("confirms each role change in words in a status line", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue(members);
    vi.spyOn(api, "setMemberRoles").mockImplementation(async (_key, username, roles) => ({ ...members[0], username, roles }));
    vi.spyOn(api, "adminListUsers").mockResolvedValue([]);
    render(<MembersSection projectKey="p/key" isSystemAdmin={false} />);
    expect(await screen.findByText(/^Role changes save immediately\./)).toBeDefined();
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice: Consolidator" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Alice is now Consolidator."));
    fireEvent.click(screen.getByRole("checkbox", { name: "alice: Annotator" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove role" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Alice is no longer Annotator."));
  });

  it("words added, removed and dropped roles", () => {
    expect(roleChangeText("Ana Weber", ["annotator"], ["annotator", "adjudicator"])).toBe("Ana Weber is now Consolidator.");
    expect(roleChangeText("Ana Weber", ["annotator", "lead"], ["lead", "adjudicator"])).toBe("Ana Weber is now Consolidator. Ana Weber is no longer Annotator.");
    expect(roleChangeText("Ana Weber", ["annotator"], [])).toBe("Ana Weber is no longer a member of this project.");
  });
});
