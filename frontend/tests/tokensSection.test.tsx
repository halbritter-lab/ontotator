import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type ApiToken } from "../src/api/client";
import { TokensSection, tokenState } from "../src/me/TokensSection";

const token = (change: Partial<ApiToken> = {}): ApiToken => ({
  id: 1, name: "nightly export", kind: "personal", owner: "alice", owner_display_name: "Alice", project_key: null,
  scopes: ["read", "export"], created_at: "2026-11-01T10:00:00Z", expires_at: "2099-01-30T10:00:00Z",
  last_used_at: null, revoked_at: null, revoked_reason: null, ...change,
});

beforeEach(() => {
  vi.spyOn(api, "listMyTokens").mockResolvedValue([token()]);
  vi.spyOn(api, "listProjectTokens").mockResolvedValue([]);
  vi.spyOn(api, "adminListTokens").mockResolvedValue([token(), token({ id: 2, name: "ops", kind: "system", owner: "root", owner_display_name: "Root", scopes: ["admin"] })]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("API tokens", () => {
  it("lists the user's tokens with scopes and state", async () => {
    render(<TokensSection mode={{ kind: "personal" }} />);
    const table = await screen.findByRole("table", { name: "API tokens" });
    expect(within(table).getByText("nightly export")).toBeDefined();
    expect(within(table).getByText("Read, Export")).toBeDefined();
    expect(within(table).getByText("Active")).toBeDefined();
    expect(within(table).queryByRole("columnheader", { name: "Owner" })).toBeNull();
  });

  it("creates a token, shows the secret once and offers no admin scope to a personal token", async () => {
    const created = token({ id: 7, name: "importer", scopes: ["read", "import"] });
    const create = vi.spyOn(api, "createMyToken").mockResolvedValue({ secret: "ott_secret-value", token: created });
    render(<TokensSection mode={{ kind: "personal" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New token…" }));
    expect(screen.queryByLabelText(/System administration/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Token name (required)"), { target: { value: "importer" } });
    fireEvent.click(screen.getByLabelText(/^Import/));
    fireEvent.change(screen.getByLabelText("Valid for (days) (required)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const dialog = await screen.findByRole("dialog", { name: "New token importer" });
    expect(within(dialog).getByText("ott_secret-value")).toBeDefined();
    expect(within(dialog).getByText(/shown only once/)).toBeDefined();
    expect(create).toHaveBeenCalledWith({ name: "importer", scopes: ["read", "import"], expires_in_days: 30 });
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(screen.queryByText("ott_secret-value")).toBeNull());
    expect(screen.getByText("importer")).toBeDefined();
  });

  it("refuses a lifetime over a year or no scope without asking the server", async () => {
    const create = vi.spyOn(api, "createMyToken");
    render(<TokensSection mode={{ kind: "personal" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New token…" }));
    fireEvent.change(screen.getByLabelText("Token name (required)"), { target: { value: "x" } });
    const days = screen.getByLabelText("Valid for (days) (required)") as HTMLInputElement;
    fireEvent.change(days, { target: { value: "400" } });
    expect(days.max).toBe("365");
    fireEvent.submit(screen.getByRole("form", { name: "New API token" }));
    fireEvent.change(days, { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText(/^Read/));
    fireEvent.submit(screen.getByRole("form", { name: "New API token" }));
    expect(await screen.findByText("Choose at least one scope.")).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });

  it("revokes a token after confirmation", async () => {
    const revoke = vi.spyOn(api, "revokeMyToken").mockResolvedValue(token({ revoked_at: "2026-11-02T10:00:00Z", revoked_reason: "revoked" }));
    render(<TokensSection mode={{ kind: "personal" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke nightly export" }));
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke token" }));
    await waitFor(() => expect(screen.getByText("Revoked")).toBeDefined());
    expect(revoke).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("button", { name: "Revoke nightly export" })).toBeNull();
  });

  it("uses the project routes for a lead and shows errors", async () => {
    vi.spyOn(api, "createProjectToken").mockRejectedValue(new ApiError(403, "raw", "NOT_ALLOWED"));
    render(<TokensSection mode={{ kind: "project", projectKey: "p/key" }} />);
    expect(await screen.findByText("No API tokens yet.")).toBeDefined();
    expect(api.listProjectTokens).toHaveBeenCalledWith("p/key");
    expect(screen.getByRole("heading", { name: "Project API tokens" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "New token…" }));
    fireEvent.change(screen.getByLabelText("Token name (required)"), { target: { value: "sync" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(api.createProjectToken).toHaveBeenCalledWith("p/key", { name: "sync", scopes: ["read"], expires_in_days: 90 });
  });

  it("gives administrators every token and system tokens with the admin scope", async () => {
    const create = vi.spyOn(api, "adminCreateSystemToken").mockResolvedValue({ secret: "ott_x", token: token({ id: 3, kind: "system", scopes: ["admin"] }) });
    render(<TokensSection mode={{ kind: "admin" }} />);
    const table = await screen.findByRole("table", { name: "API tokens" });
    expect(within(table).getByText("System")).toBeDefined();
    expect(within(table).getByText("Root (root)")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "New system token…" }));
    fireEvent.change(screen.getByLabelText("Token name (required)"), { target: { value: "ops" } });
    fireEvent.click(screen.getByLabelText(/^Read/));
    fireEvent.click(screen.getByLabelText(/^System administration/));
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await screen.findByRole("dialog", { name: /New token/ });
    expect(create).toHaveBeenCalledWith({ name: "ops", scopes: ["admin"], expires_in_days: 90 });
  });

  it("says why the server revoked a token, not when its owner did", async () => {
    vi.mocked(api.listMyTokens).mockResolvedValue([
      token({ revoked_at: "2026-11-02T10:00:00Z", revoked_reason: "project.member_roles" }),
      token({ id: 2, name: "by hand", revoked_at: "2026-11-02T10:00:00Z", revoked_reason: "revoked" }),
    ]);
    render(<TokensSection mode={{ kind: "personal" }} />);
    const table = await screen.findByRole("table", { name: "API tokens" });
    expect(within(table).getByText("nightly export").closest("tr")!.textContent).toContain("Revoked project role removed");
    expect(within(table).getByText("by hand").closest("tr")!.textContent).toMatch(/Revoked$/);
  });

  it("tells expired from revoked tokens", () => {
    expect(tokenState(token({ expires_at: "2020-01-01T00:00:00Z" }))).toBe("Expired");
    expect(tokenState(token({ revoked_at: "2020-01-01T00:00:00Z", expires_at: "2020-01-01T00:00:00Z" }))).toBe("Revoked");
  });
});
