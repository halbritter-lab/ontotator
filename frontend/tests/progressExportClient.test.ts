import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, onCsrfRejected, onSessionExpired, type ProjectProgress } from "../src/api/client";
afterEach(() => vi.unstubAllGlobals());
it("uses actual progress/export endpoints, escaping project keys and preserving CSRF JSON transport", async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetch); const client = new ApiClient(); client.setCsrfToken("token");
  await client.getProgress("a/b"); await client.startExport("a/b", "edit_log");
  expect(fetch.mock.calls[0][0]).toBe("/api/v1/projects/a%2Fb/progress");
  const [url, options] = fetch.mock.calls[1];
  expect(url).toBe("/api/v1/projects/a%2Fb/exports"); expect(options.method).toBe("POST");
  expect(options.body).toBe(JSON.stringify({ kind: "edit_log" }));
  expect(options.headers.get("X-CSRF-Token")).toBe("token");
  expect(options.headers.get("Content-Type")).toBe("application/json");
  expect(options.credentials).toBe("same-origin");
});
it.each([
  ["application/zip", [80, 75, 0, 255], "attachment; filename=\"fallback.zip\"; filename*=UTF-8''r%C3%A9sultats.zip", "résultats.zip"],
  ["application/x-ndjson", [123, 125, 10], "attachment; filename=\"project-edit_log.jsonl\"", "project-edit_log.jsonl"],
])("downloads %s bytes intact through authenticated raw response transport", async (mime, bytes, disposition, filename) => {
  const response = new Response(new Uint8Array(bytes as number[]), { headers: { "Content-Type": mime as string, "Content-Disposition": disposition as string } });
  const json = vi.spyOn(response, "json"); const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetch);
  const payload = await new ApiClient().downloadJob(17);
  expect(fetch.mock.calls[0][0]).toBe("/api/v1/jobs/17/download"); expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(payload.blob);
  });
  expect([...new Uint8Array(data)]).toEqual(bytes); expect(payload.filename).toBe(filename);
  expect(payload.blob.type).toBe(mime); expect(json).not.toHaveBeenCalled();
});
it("shares session, CSRF, conflict and validation errors across raw and JSON responses", async () => {
  const fetch = vi.fn().mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ code: "NOT_AUTHENTICATED", details: "Session ended" }), { status: 401 })))
    .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ code: "CSRF_FAILED", details: "Token changed" }), { status: 403 })))
    .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ code: "FUTURE_CONFLICT", details: "Current conflict" }), { status: 409 })))
    .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ code: "FUTURE_VALIDATION", details: "Current validation" }), { status: 422 })));
  vi.stubGlobal("fetch", fetch); const expired = vi.fn(); const csrf = vi.fn(); const stopExpired = onSessionExpired(expired); const stopCsrf = onCsrfRejected(csrf);
  try {
    const client = new ApiClient();
    await expect(client.downloadJob(1)).rejects.toMatchObject({ status: 401, code: "NOT_AUTHENTICATED", message: "Session ended" });
    await expect(client.startExport("p", "t1")).rejects.toMatchObject({ status: 403, code: "CSRF_FAILED" });
    await expect(client.downloadJob(2)).rejects.toMatchObject({ status: 409, code: "FUTURE_CONFLICT" });
    await expect(client.getProgress("p")).rejects.toMatchObject({ status: 422, code: "FUTURE_VALIDATION" });
    expect(expired).toHaveBeenCalledOnce(); expect(csrf).toHaveBeenCalledOnce();
  } finally { stopExpired(); stopCsrf(); }
});
it("does not expire a renewed session for a late binary 401", async () => {
  let resolve!: (response: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const client = new ApiClient(); client.setCsrfToken("old"); const expired = vi.fn(); const stop = onSessionExpired(expired);
  try {
    const pending = client.downloadJob(1); client.setCsrfToken("new"); resolve(new Response("{}", { status: 401 }));
    await expect(pending).rejects.toMatchObject({ status: 401 }); expect(expired).not.toHaveBeenCalled();
  } finally { stop(); }
});
it("reads progress stages and workload", async () => {
  const card = (scope: "review" | "annotate", counts: Record<string, number>) => ({ scope, done: 1, total: 4, counts });
  const body: ProjectProgress = {
    documents: [], people: [],
    totals: { documents: 0, unassigned: 0, open: 0, in_progress: 0, submitted: 0, reopened: 0 },
    lede: { cases: 3, translations_to_review: 3, versions_to_annotate: 4, not_in_plan: 1, needs_decision: 2, to_assign: 1 },
    stages: {
      translation_review: card("review", { to_assign: 1, in_review: 1, check_failed: 2, check_failed_with_reviewer: 1, rejected_or_queried: 1, accepted: 1 }),
      annotation: card("annotate", { waiting_for_review: 2, to_assign: 0, in_progress: 1, paused: 1, submitted: 1 }),
      final: card("annotate", { not_ready: 3, to_choose: 0, to_confirm: 0, final: 1, would_be_omitted: 3 }),
    },
    workload: [{
      person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false }, username: "ana",
      translation_reviews_open: 1, annotations_open: 1, reviews_open: 0, paused: 0, submitted: 0,
    }],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  const progress = await new ApiClient().getProgress("proj");
  expect(progress.lede?.needs_decision).toBe(2);
  expect(progress.stages?.translation_review.counts.check_failed_with_reviewer).toBe(1);
  expect(progress.stages?.final.counts.would_be_omitted).toBe(3);
  expect(progress.workload?.[0].person).toEqual({ pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false });
});
