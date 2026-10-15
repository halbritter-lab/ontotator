import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiClient, AuthError, isSessionExpired, onSessionExpired } from "../src/api/client";
import { AuthGate } from "../src/app/AuthGate";
import { testUser } from "./session";

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const notLoggedIn = () => new AuthError("Log in to continue.", undefined, "NOT_AUTHENTICATED", 401);

const oneCaseServer = () => {
  vi.spyOn(api, "getSettings").mockResolvedValue({ allowed_modes: ["independent", "review", "assisted"], default_mode: "independent" } as any);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ mode_by_package: {} } as any);
  vi.spyOn(api, "listOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
  vi.spyOn(api, "listDocuments").mockResolvedValue([
    { document_id: "doc-1", text_length: 10, language: "en", position: 1, status: "not_started" as const },
  ]);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sessions in the API client", () => {
  it("sends cookies, and the CSRF token on writes but not on reads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, testUser("ann-0007")))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(200, { mode_by_package: {} }))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error("no body"); } });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();

    await client.me();
    await client.listPackages();
    await client.updatePreferences({ mode_by_package: { pkg: "review" } });
    await expect(client.logout()).resolves.toBeUndefined();

    const [meUrl, meInit] = fetchMock.mock.calls[0];
    expect(meUrl).toBe("/api/v1/auth/me");
    expect(meInit.credentials).toBe("same-origin");
    expect((meInit.headers as Headers).has("X-CSRF-Token")).toBe(false);
    const [, readInit] = fetchMock.mock.calls[1];
    expect(readInit.credentials).toBe("same-origin");
    expect((readInit.headers as Headers).has("X-CSRF-Token")).toBe(false);
    expect((readInit.headers as Headers).has("Authorization")).toBe(false);
    const [, writeInit] = fetchMock.mock.calls[2];
    expect(writeInit.method).toBe("PUT");
    expect(writeInit.credentials).toBe("same-origin");
    expect((writeInit.headers as Headers).get("X-CSRF-Token")).toBe("csrf-test");
    const [logoutUrl, logoutInit] = fetchMock.mock.calls[3];
    expect(logoutUrl).toBe("/api/v1/auth/logout");
    expect((logoutInit.headers as Headers).get("X-CSRF-Token")).toBe("csrf-test");
  });

  it("reports an ended session on 401, but not a failed login", async () => {
    const seen: number[] = [];
    const off = onSessionExpired(() => seen.push(1));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: "LOGIN_FAILED", details: "Wrong username or password." }))
      .mockResolvedValueOnce(jsonResponse(401, { code: "NOT_AUTHENTICATED", details: "Log in to continue." }))
      .mockResolvedValueOnce(jsonResponse(403, { code: "CSRF_FAILED", details: "The page is out of date; reload it." }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();

    const failedLogin = await client.login("alice", "wrong").catch((e) => e);
    expect(failedLogin).toBeInstanceOf(AuthError);
    expect(failedLogin.status).toBe(401);
    expect(failedLogin.code).toBe("LOGIN_FAILED");
    expect(isSessionExpired(failedLogin)).toBe(false);
    expect(seen).toHaveLength(0);

    const ended = await client.listPackages().catch((e) => e);
    expect(ended).toBeInstanceOf(AuthError);
    expect(ended.status).toBe(401);
    expect(isSessionExpired(ended)).toBe(true);

    const forbidden = await client.listPackages().catch((e) => e);
    expect(forbidden).toBeInstanceOf(AuthError);
    expect(forbidden.status).toBe(403);
    expect(forbidden.code).toBe("CSRF_FAILED");
    expect(isSessionExpired(forbidden)).toBe(false);

    expect(seen).toHaveLength(1);
    off();
  });
});

describe("the login gate", () => {
  it("shows the login form without a session and the app after logging in", async () => {
    vi.spyOn(api, "me").mockRejectedValue(notLoggedIn());
    const login = vi.spyOn(api, "login").mockResolvedValue(testUser("ann-0007", { display_name: "Alice" }));
    oneCaseServer();
    render(<AuthGate />);

    const form = await screen.findByRole("form", { name: "Log in to Ontocurator" });
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(within(form).getByLabelText("Password"), { target: { value: "correct horse battery" } });
    fireEvent.click(within(form).getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("alice", "correct horse battery"));
    expect((await screen.findByTestId("current-user")).textContent).toBe("Alice · ann-0007");
    expect(screen.getByRole("button", { name: "Log out" })).toBeDefined();
    await screen.findByRole("table");
  });

  it("redeems a setup code after checking that both passwords match", async () => {
    vi.spyOn(api, "me").mockRejectedValue(notLoggedIn());
    const redeem = vi.spyOn(api, "redeemCode").mockResolvedValue(testUser("ann-0008", { display_name: "Bob", is_system_admin: false }));
    oneCaseServer();
    render(<AuthGate />);

    await screen.findByRole("form", { name: "Log in to Ontocurator" });
    fireEvent.click(screen.getByRole("button", { name: "I have a setup or reset code" }));
    const form = screen.getByRole("form", { name: "Set your password" });
    expect(within(form).getByText("At least 12 characters.")).toBeDefined();
    fireEvent.change(within(form).getByLabelText("Username"), { target: { value: "bob" } });
    fireEvent.change(within(form).getByLabelText("Setup or reset code"), { target: { value: "ABCD-EFGH" } });
    fireEvent.change(within(form).getByLabelText("New password"), { target: { value: "a long new password" } });
    fireEvent.change(within(form).getByLabelText("Repeat the new password"), { target: { value: "a long new passwort" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set password and log in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The two passwords differ.");
    expect(redeem).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText("Repeat the new password"), { target: { value: "a long new password" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set password and log in" }));

    await waitFor(() => expect(redeem).toHaveBeenCalledWith("bob", "ABCD-EFGH", "a long new password"));
    expect((await screen.findByTestId("current-user")).textContent).toBe("Bob · ann-0008");
  });
});
