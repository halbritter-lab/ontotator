import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, onCsrfRejected, onSessionExpired } from "../src/api/client";

afterEach(() => vi.unstubAllGlobals());

describe("ontology administration transport", () => {
  it("keeps the public inventory distinct and sends multiple native multipart files with session CSRF", async () => {
    const rows = [{ filename: "hp.json", sha256: "a".repeat(64) }];
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => rows });
    vi.stubGlobal("fetch", fetch);
    const client = new ApiClient(); client.setCsrfToken("csrf");
    expect(await client.adminListOntologies()).toEqual(rows);
    const files = [new File(["{}"], "hp.json"), new File(["term\tlabel"], "hp-de.tsv")];
    expect(await client.adminUploadOntologies(files)).toEqual(rows);
    await client.listOntologies();
    expect(fetch.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ["/api/v1/admin/ontologies/", "GET"], ["/api/v1/admin/ontologies/", "POST"], ["/api/v1/ontologies", "GET"],
    ]);
    const options = fetch.mock.calls[1][1];
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.getAll("files[]")).toEqual(files);
    expect(new Headers(options.headers).get("Content-Type")).toBeNull();
    expect(new Headers(options.headers).get("X-CSRF-Token")).toBe("csrf");
    expect(options.credentials).toBe("same-origin");
  });

  it.each(["list", "upload"])("retains session-expiry signaling on admin %s", async (operation) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "NOT_AUTHENTICATED", details: "Session ended" }) }));
    const client = new ApiClient(); const listener = vi.fn(); const stop = onSessionExpired(listener);
    try {
      await expect(operation === "list" ? client.adminListOntologies() : client.adminUploadOntologies([])).rejects.toMatchObject({ code: "NOT_AUTHENTICATED", status: 401 });
      expect(listener).toHaveBeenCalledOnce();
    } finally { stop(); }
  });

  it("preserves server validation details and CSRF signals", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ code: "INVALID_ONTOLOGY", details: "Missing graph nodes" }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: "CSRF_FAILED", details: "Stale token" }) });
    vi.stubGlobal("fetch", fetch);
    const listener = vi.fn(); const stop = onCsrfRejected(listener); const client = new ApiClient();
    try {
      await expect(client.adminUploadOntologies([])).rejects.toMatchObject({ code: "INVALID_ONTOLOGY", message: "Missing graph nodes" });
      await expect(client.adminUploadOntologies([])).rejects.toMatchObject({ code: "CSRF_FAILED" });
      expect(listener).toHaveBeenCalledOnce();
    } finally { stop(); }
  });
});
