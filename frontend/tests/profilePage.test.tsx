import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, type Profile } from "../src/api/client";
import { ProfilePage } from "../src/me/ProfilePage";

const profile: Profile = { qualification: null, username: "long-username-123", pseudonym: "ann-0042", display_name: "Alex", email: "alex@example.org", orcid: "0000-0002-1825-0097", orcid_consent: true, languages: ["en"] };
beforeEach(() => { vi.spyOn(api, "getProfile").mockResolvedValue(profile); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const loaded = async () => { await screen.findByText("ann-0042"); };
const passwordForm = () => screen.getByRole("form", { name: "Change password" });
function passwordValues(next: string, repeat = next) {
  fireEvent.change(screen.getByLabelText("Current password (required)"), { target: { value: "current-password" } });
  fireEvent.change(screen.getByLabelText("New password (required)"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Repeat new password (required)"), { target: { value: repeat } });
}

describe("ProfilePage component", () => {
  it("loads read-only identity and patches only changed fields, preserving null clears and false consent", async () => {
    const updated = { ...profile, display_name: "Alex Smith", email: null, orcid: null, orcid_consent: false };
    const save = vi.spyOn(api, "updateOwnProfile").mockResolvedValue(updated);
    const onSaved = vi.fn();
    render(<ProfilePage onSaved={onSaved} />);
    await loaded();
    const account = screen.getByText("Username").closest("dl")!;
    expect(account.textContent).toContain(`Username${profile.username}`);
    expect(account.textContent).toContain(`Pseudonym${profile.pseudonym}`);
    expect(screen.queryByRole("textbox", { name: "Username" })).toBeNull();
    expect(screen.getByText("Your pseudonym appears in exports instead of your name.")).toBeDefined();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Display name (required)"));
    await user.type(screen.getByLabelText("Display name (required)"), "Alex Smith");
    await user.clear(screen.getByLabelText("E-mail"));
    await user.clear(screen.getByLabelText("ORCID"));
    await user.click(screen.getByLabelText("Name me (display name and ORCID) as a contributor in exports"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(save).toHaveBeenCalledWith({ display_name: "Alex Smith", email: null, orcid: null, orcid_consent: false });
    expect(onSaved).toHaveBeenCalledWith(updated);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledOnce();
  });

  it("uses the actual normalized server response as the next baseline", async () => {
    const save = vi.spyOn(api, "updateOwnProfile").mockResolvedValue({ ...profile, display_name: "Alex Smith" });
    render(<ProfilePage />); await loaded();
    fireEvent.change(screen.getByLabelText("Display name (required)"), { target: { value: " Alex Smith " } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect((screen.getByLabelText("Display name (required)") as HTMLInputElement).value).toBe("Alex Smith");
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "other@example.org" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual({ email: "other@example.org" });
  });

  it("shows the server ORCID message and keeps editable input after refusal", async () => {
    vi.spyOn(api, "updateOwnProfile").mockRejectedValue(new ApiError(422, "ORCID checksum is invalid.", "ORCID_INVALID"));
    render(<ProfilePage />); await loaded();
    fireEvent.change(screen.getByLabelText("ORCID"), { target: { value: "invalid-orcid" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("ORCID checksum is invalid.");
    expect((screen.getByLabelText("ORCID") as HTMLInputElement).value).toBe("invalid-orcid");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps profile edits on a session error and does not create another login dialog", async () => {
    vi.spyOn(api, "updateOwnProfile").mockRejectedValue(new AuthError("Expired", undefined, "NOT_AUTHENTICATED", 401));
    render(<ProfilePage />); await loaded();
    fireEvent.change(screen.getByLabelText("Display name (required)"), { target: { value: "Unsaved Alex" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Display name (required)") as HTMLInputElement).value).toBe("Unsaved Alex");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retries a failed load", async () => {
    vi.mocked(api.getProfile).mockRejectedValueOnce(new Error("Network unavailable"));
    render(<ProfilePage />);
    await screen.findByText("Network unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    await loaded();
    expect(api.getProfile).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale load response after the effect was cleaned up", async () => {
    let finish!: (value: Profile) => void;
    vi.mocked(api.getProfile).mockReset()
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(profile);
    render(<StrictMode><ProfilePage /></StrictMode>);
    await loaded();
    await act(async () => finish({ ...profile, display_name: "Stale response" }));
    expect((screen.getByLabelText("Display name (required)") as HTMLInputElement).value).toBe("Alex");
  });

  it("commits a pending valid language before Save and blocks invalid pending language input", async () => {
    const save = vi.spyOn(api, "updateOwnProfile").mockResolvedValue({ ...profile, languages: ["de", "en"] });
    render(<ProfilePage />); await loaded();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Languages you can read"), "DE");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(save).toHaveBeenCalledWith({ languages: ["en", "de"] });
    await user.type(screen.getByLabelText("Languages you can read"), "deu");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Use a two-letter language code, e.g. de.")).toBeDefined();
    expect(save).toHaveBeenCalledOnce();
  });

  it.each([
    ["short", "short", "12"],
    ["x".repeat(257), "x".repeat(257), "256"],
    ["new-password-123", "different-password", "match"],
    [" LONG-USERNAME-123 ", " LONG-USERNAME-123 ", "username"],
    ["long-uſername-123", "long-uſername-123", "username"],
    ["e\u0301".repeat(11), "e\u0301".repeat(11), "12"],
  ])("checks password rules before sending for %j", async (next, repeat, message) => {
    const change = vi.spyOn(api, "changePassword");
    render(<ProfilePage />); await loaded();
    passwordValues(next, repeat);
    await userEvent.setup().click(within(passwordForm()).getByRole("button", { name: "Change password" }));
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(change).not.toHaveBeenCalled();
  });

  it("shows PASSWORD_WRONG using the approved message", async () => {
    vi.spyOn(api, "changePassword").mockRejectedValue(new ApiError(422, "Backend wording", "PASSWORD_WRONG"));
    render(<ProfilePage />); await loaded();
    passwordValues("new-password-123");
    await userEvent.setup().click(within(passwordForm()).getByRole("button", { name: "Change password" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The current password is wrong.");
    expect((screen.getByLabelText("New password (required)") as HTMLInputElement).value).toBe("new-password-123");
  });

  it("accepts FEFF-wrapped username text because Python strip retains FEFF", async () => {
    const change = vi.spyOn(api, "changePassword").mockResolvedValue();
    render(<ProfilePage />); await loaded();
    const next = `\uFEFF${profile.username}\uFEFF`;
    passwordValues(next);
    await userEvent.setup().click(within(passwordForm()).getByRole("button", { name: "Change password" }));
    expect(change).toHaveBeenCalledWith("current-password", next);
    expect(screen.getByText("Password changed. Other sessions were logged out.")).toBeDefined();
  });

  it.each(["\u0085", "\u001C", "\u001D", "\u001E", "\u001F"])("rejects Python-strip whitespace %j around the username before sending", async (space) => {
    const change = vi.spyOn(api, "changePassword").mockResolvedValue();
    render(<ProfilePage />); await loaded();
    passwordValues(`${space}${profile.username}${space}`);
    await userEvent.setup().click(within(passwordForm()).getByRole("button", { name: "Change password" }));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("The password must differ from the username.");
  });

  it("counts NFC Unicode codepoints and clears password fields after success", async () => {
    const change = vi.spyOn(api, "changePassword").mockResolvedValue();
    render(<ProfilePage />); await loaded();
    const next = "😀".repeat(128);
    passwordValues(next);
    await userEvent.setup().click(within(passwordForm()).getByRole("button", { name: "Change password" }));
    await screen.findByText("Password changed. Other sessions were logged out.");
    expect(change).toHaveBeenCalledWith("current-password", next);
    for (const label of ["Current password", "New password", "Repeat new password"]) expect((screen.getByLabelText(`${label} (required)`) as HTMLInputElement).value).toBe("");
  });

  it("ignores a save result after unmount instead of updating caller identity", async () => {
    let finish!: (value: Profile) => void;
    vi.spyOn(api, "updateOwnProfile").mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const onSaved = vi.fn();
    const page = render(<ProfilePage onSaved={onSaved} />); await loaded();
    fireEvent.change(screen.getByLabelText("Display name (required)"), { target: { value: "Changed" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    page.unmount();
    await act(async () => finish({ ...profile, display_name: "Changed" }));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
