import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, onCsrfRejected, onSessionExpired } from "../src/api/client";

afterEach(() => vi.unstubAllGlobals());

describe("profile client endpoints", () => {
  it("uses GET/PATCH profile and POST password with changed fields, nulls and CSRF intact", async () => {
    const profile = { username: "alex" };
    const json = vi.fn(async () => profile);
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json })
      .mockResolvedValueOnce({ ok: true, status: 200, json })
      .mockResolvedValueOnce({ ok: true, status: 204, json });
    vi.stubGlobal("fetch", fetch);
    const client = new ApiClient();
    client.setCsrfToken("csrf");
    expect(await client.getProfile()).toEqual(profile);
    expect(await client.updateOwnProfile({ email: null, orcid: null, orcid_consent: false })).toEqual(profile);
    expect(await client.changePassword("old", "new-password-123")).toBeUndefined();
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.body && JSON.parse(init.body)])).toEqual([
      ["/api/v1/me/profile", "GET", undefined],
      ["/api/v1/me/profile", "PATCH", { email: null, orcid: null, orcid_consent: false }],
      ["/api/v1/me/password", "POST", { current_password: "old", new_password: "new-password-123" }],
    ]);
    expect(json).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls.slice(1)) {
      expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf");
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    }
    expect(fetch.mock.calls.every(([, init]) => init.credentials === "same-origin")).toBe(true);
  });

  it.each(["read", "update", "password"])("preserves session signals for %s", async (kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "NOT_AUTHENTICATED", details: "Session ended" }) }));
    const client = new ApiClient();
    const listener = vi.fn();
    const stop = onSessionExpired(listener);
    try {
      const result = kind === "read" ? client.getProfile() : kind === "update" ? client.updateOwnProfile({ display_name: "Alex" }) : client.changePassword("old", "new-password-123");
      await expect(result).rejects.toMatchObject({ status: 401, code: "NOT_AUTHENTICATED" });
      expect(listener).toHaveBeenCalledOnce();
    } finally { stop(); }
  });

  it("preserves CSRF signaling and server ORCID validation details", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: "CSRF_FAILED", details: "Stale token" }) })
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ code: "ORCID_INVALID", details: "ORCID checksum is invalid." }) });
    vi.stubGlobal("fetch", fetch);
    const listener = vi.fn();
    const stop = onCsrfRejected(listener);
    const client = new ApiClient();
    try {
      await expect(client.changePassword("old", "new-password-123")).rejects.toMatchObject({ code: "CSRF_FAILED" });
      expect(listener).toHaveBeenCalledOnce();
      await expect(client.updateOwnProfile({ orcid: "bad" })).rejects.toMatchObject({ code: "ORCID_INVALID", message: "ORCID checksum is invalid." });
    } finally { stop(); }
  });
});
