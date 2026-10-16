import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, onCsrfRejected, onSessionExpired } from "../src/api/client";
afterEach(() => vi.unstubAllGlobals());
it("uses escaped project paths, native multipart and exact plan hash with session and CSRF", async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" } })));
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient(); client.setCsrfToken("csrf");
  await client.listProjectDocuments("a/b", { language: "en", status: "open", q: "ID +" });
  expect(fetch.mock.calls[0][0]).toBe("/api/v1/projects/a%2Fb/documents?language=en&status=open&q=ID+%2B");
  const file = new File(["hello"], "case.txt");
  await client.createUpload("a/b", "text", [file], "en");
  const [url, options] = fetch.mock.calls[1];
  expect(url).toBe("/api/v1/projects/a%2Fb/uploads");
  expect(options.body.getAll("files[]")).toEqual([file]);
  expect(options.body.get("language")).toBe("en");
  expect(options.body.get("kind")).toBe("text");
  expect(options.headers.get("Content-Type")).toBeNull();
  expect(options.headers.get("X-CSRF-Token")).toBe("csrf");
  expect(options.credentials).toBe("same-origin");
  await client.commitUpload("a/b", 7, "actual-sha");
  expect(fetch.mock.calls[2][0]).toBe("/api/v1/projects/a%2Fb/uploads/7/commit");
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ plan_sha256: "actual-sha" });
});
it("reads persisted uploads and jobs, and discards via POST", async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetch); const client = new ApiClient();
  await client.listUploads("p"); await client.getUpload("p", 7); await client.getJob(12); await client.discardUpload("p", 7); await client.getProjectSettings("p");
  expect(fetch.mock.calls.map(call => [call[0], call[1].method])).toEqual([
    ["/api/v1/projects/p/uploads", "GET"], ["/api/v1/projects/p/uploads/7", "GET"],
    ["/api/v1/jobs/12", "GET"], ["/api/v1/projects/p/uploads/7/discard", "POST"], ["/api/v1/projects/p/settings", "GET"],
  ]);
});
it("preserves shared session/CSRF signals and real upload error codes", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: "NOT_AUTHENTICATED", details: "Session ended" }), { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: "CSRF_FAILED", details: "Stale token" }), { status: 403 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: "UPLOAD_STALE", details: "Project changed" }), { status: 409 })));
  const session = vi.fn(); const csrf = vi.fn(); const stopSession = onSessionExpired(session); const stopCsrf = onCsrfRejected(csrf);
  const client = new ApiClient();
  try {
    await expect(client.getJob(1)).rejects.toMatchObject({ status: 401, code: "NOT_AUTHENTICATED" });
    await expect(client.createUpload("p", "t1", [])).rejects.toMatchObject({ status: 403, code: "CSRF_FAILED" });
    await expect(client.commitUpload("p", 7, "sha")).rejects.toMatchObject({ status: 409, code: "UPLOAD_STALE", message: "Project changed" });
    expect(session).toHaveBeenCalledOnce(); expect(csrf).toHaveBeenCalledOnce();
  } finally { stopSession(); stopCsrf(); }
});
