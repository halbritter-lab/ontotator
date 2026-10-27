import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { LoginScreen } from "../src/app/LoginScreen";
import { testUser } from "./session";

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  api.setCsrfToken(null);
});

describe("demo accounts on the login screen", () => {
  it("shows no demo section when the server does not offer demo accounts (404)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404, { detail: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginScreen onLoggedIn={vi.fn()} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/demo-logins", expect.anything()));
    expect(await api.demoLogins()).toEqual([]);
    expect(screen.queryByRole("region", { name: "Demo accounts" })).toBeNull();
    expect(screen.getByRole("button", { name: "Log in" })).toBeDefined();
  });

  it("logs in through the normal login with the chosen demo account", async () => {
    vi.spyOn(api, "demoLogins").mockResolvedValue([
      { username: "demo-lead", password: "lead-pw", label: "Project lead" },
      { username: "demo-annotator", password: "ann-pw", label: "" },
    ]);
    const user = testUser("demo-lead");
    const login = vi.spyOn(api, "login").mockResolvedValue(user);
    const onLoggedIn = vi.fn();

    render(<LoginScreen onLoggedIn={onLoggedIn} />);

    const section = await screen.findByRole("region", { name: "Demo accounts" });
    expect(section.textContent).toContain("demo-annotator");
    fireEvent.click(screen.getByRole("button", { name: "demo-lead (demo-lead), Project lead" }));

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(user));
    expect(login).toHaveBeenCalledWith("demo-lead", "lead-pw");
  });

  it("shows the display name, the username and the role", async () => {
    // The server adds display_name (null before the user exists); `DemoLogin` does not declare it.
    const accounts = [
      { username: "demo-annotator", password: "pw", label: "Annotator", display_name: "Tom Reis" },
      { username: "demo-new", password: "pw", label: "Consolidator", display_name: null },
    ];
    vi.spyOn(api, "demoLogins").mockResolvedValue(accounts);

    render(<LoginScreen onLoggedIn={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Tom Reis (demo-annotator), Annotator" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "demo-new (demo-new), Consolidator" })).toBeTruthy();
  });

  it("offers no demo accounts in the dialog after a session ended", async () => {
    const demoLogins = vi.spyOn(api, "demoLogins").mockResolvedValue([{ username: "demo-lead", password: "pw", label: "" }]);

    render(<LoginScreen overlay onLoggedIn={vi.fn()} />);

    await screen.findByRole("dialog", { name: "Log in to Ontotator" });
    expect(demoLogins).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Demo accounts" })).toBeNull();
  });

  it("hides the demo accounts while a setup code is entered", async () => {
    vi.spyOn(api, "demoLogins").mockResolvedValue([{ username: "demo-lead", password: "pw", label: "Project lead" }]);

    render(<LoginScreen onLoggedIn={vi.fn()} />);
    await screen.findByRole("region", { name: "Demo accounts" });
    fireEvent.click(screen.getByRole("button", { name: "I have a setup or reset code" }));

    expect(screen.queryByRole("region", { name: "Demo accounts" })).toBeNull();
  });
});
