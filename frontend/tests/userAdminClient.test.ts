import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, onCsrfRejected, onSessionExpired } from "../src/api/client";

afterEach(() => vi.unstubAllGlobals());

describe("user administration transport", () => {
  it("uses all four real endpoints, encoded usernames, nullable changes and explicit false flags", async () => {
    const responses = [[{ username: "alex" }], { user: { username: "alex" }, code: "setup", expires_at: "soon" }, { code: "reset", expires_at: "later" }, { username: "alex", active: false }];
    const fetch = vi.fn(); for (const response of responses) fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => response });
    vi.stubGlobal("fetch", fetch); const client = new ApiClient(); client.setCsrfToken("csrf");
    expect(await client.adminListUsers()).toEqual(responses[0]);
    expect(await client.adminCreateUser({ username: "alex", display_name: "Alex", email: null, languages: ["de"], system_admin: false })).toEqual(responses[1]);
    expect(await client.adminIssueResetCode("alex/one")).toEqual(responses[2]);
    expect(await client.adminUpdateUser("alex/one", { email: null, active: false, is_system_admin: false })).toEqual(responses[3]);
    expect(fetch.mock.calls.map(([url, options]) => [url, options.method, options.body && JSON.parse(options.body)])).toEqual([
      ["/api/v1/admin/users/", "GET", undefined],
      ["/api/v1/admin/users/", "POST", { username: "alex", display_name: "Alex", email: null, languages: ["de"], system_admin: false }],
      ["/api/v1/admin/users/alex%2Fone/reset-code", "POST", undefined],
      ["/api/v1/admin/users/alex%2Fone", "PATCH", { email: null, active: false, is_system_admin: false }],
    ]);
    for (const [, options] of fetch.mock.calls.slice(1)) expect(new Headers(options.headers).get("X-CSRF-Token")).toBe("csrf");
    expect(fetch.mock.calls.every(([, options]) => options.credentials === "same-origin")).toBe(true);
  });

  it.each(["list", "create", "reset", "update"])("preserves session expiry on %s", async operation => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "NOT_AUTHENTICATED", details: "Expired" }) }));
    const listener = vi.fn(); const stop = onSessionExpired(listener); const client = new ApiClient();
    try {
      const pending = operation === "list" ? client.adminListUsers() : operation === "create" ? client.adminCreateUser({ username: "alex", display_name: "Alex", system_admin: false }) : operation === "reset" ? client.adminIssueResetCode("alex") : client.adminUpdateUser("alex", { active: false });
      await expect(pending).rejects.toMatchObject({ status: 401, code: "NOT_AUTHENTICATED" }); expect(listener).toHaveBeenCalledOnce();
    } finally { stop(); }
  });

  it("keeps CSRF notifications and specific server validation details", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: "CSRF_FAILED", details: "Old token" }) }).mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ code: "USERNAME_TAKEN", details: "Already in use" }) });
    vi.stubGlobal("fetch", fetch); const client = new ApiClient(); const listener = vi.fn(); const stop = onCsrfRejected(listener);
    try {
      await expect(client.adminIssueResetCode("alex")).rejects.toMatchObject({ code: "CSRF_FAILED" }); expect(listener).toHaveBeenCalledOnce();
      await expect(client.adminCreateUser({ username: "alex", display_name: "Alex", system_admin: false })).rejects.toMatchObject({ code: "USERNAME_TAKEN", message: "Already in use" });
    } finally { stop(); }
  });
});
