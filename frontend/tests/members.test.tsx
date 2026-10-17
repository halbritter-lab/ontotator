import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { MembersSection } from "../src/admin/MembersSection";
import { deferred, members } from "./projectFixtures";

beforeEach(() => {
  vi.spyOn(api, "listMembers").mockResolvedValue(members);
  vi.spyOn(api, "setMemberRoles").mockImplementation(async (_key, username, roles) => ({ ...members[0], username, roles }));
  vi.spyOn(api, "adminListUsers").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("project members", () => {
  it("renders actual metadata and saves role toggles, including empty removal", async () => {
    render(<MembersSection projectKey="p/key" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice: Adjudicator" }));
    expect(api.setMemberRoles).toHaveBeenCalledWith("p/key", "alice", ["annotator", "adjudicator"], false);
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "alice: Adjudicator" }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText("ann-1")).toBeDefined();
    fireEvent.click(screen.getByRole("checkbox", { name: "lead: Project lead" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "lead: Project lead" })).toBeNull());
    expect(api.setMemberRoles).toHaveBeenLastCalledWith("p/key", "lead", [], false);
    expect(api.adminListUsers).not.toHaveBeenCalled();
  });

  it("shows LAST_LEAD inline without optimistically removing the role", async () => {
    vi.mocked(api.setMemberRoles).mockRejectedValue(new ApiError(409, "Cannot remove", "LAST_LEAD"));
    render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "lead: Project lead" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect((screen.getByRole("checkbox", { name: "lead: Project lead" }) as HTMLInputElement).checked).toBe(true);
  });

  it("confirms all actual affected assignment details before resending with revocation", async () => {
    vi.mocked(api.setMemberRoles).mockRejectedValueOnce(new ApiError(409, "Has work", "MEMBER_HAS_ASSIGNMENTS", { assignments: [{ id: 2, document_id: "doc-reopened", task: "annotate" }, { id: 3, document_id: "doc-in-progress", task: "review" }] })).mockResolvedValueOnce({ ...members[0], roles: [] });
    render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "alice: Annotator" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(api.setMemberRoles).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("checkbox", { name: "alice: Annotator" }) as HTMLInputElement).checked).toBe(true);
  });

  it("adds an exact username and restricts user-list suggestions to actual administrators", async () => {
    const view = render(<MembersSection projectKey="p" isSystemAdmin={true} />);
    fireEvent.change(await screen.findByLabelText(/^Username/), { target: { value: "new.user" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "New member: Annotator" }));
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(api.adminListUsers).toHaveBeenCalledTimes(1);
    expect(api.setMemberRoles).toHaveBeenCalledWith("p", "new.user", ["annotator"], false);
    await screen.findByRole("checkbox", { name: "new.user: Annotator" });
    view.rerender(<MembersSection projectKey="q" isSystemAdmin={false} />);
    await screen.findByRole("checkbox", { name: "alice: Annotator" });
    expect(api.adminListUsers).toHaveBeenCalledTimes(1);
  });

  it("blocks repeated role changes while a write is pending and ignores unmounted replies", async () => {
    const pending = deferred<typeof members[0]>();
    vi.mocked(api.setMemberRoles).mockReturnValue(pending.promise);
    const view = render(<MembersSection projectKey="p" isSystemAdmin={false} />);
    const checkbox = await screen.findByRole("checkbox", { name: "alice: Adjudicator" });
    fireEvent.click(checkbox); fireEvent.click(checkbox);
    expect(api.setMemberRoles).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { pending.resolve({ ...members[0], roles: [] }); });
    expect(screen.queryByRole("table")).toBeNull();
  });
});
