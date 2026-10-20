import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, type BulkPlanRequest } from "../src/api/client";

function mockFetch(body: unknown = {}) {
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  globalThis.fetch = fetchSpy;
  return fetchSpy;
}

describe("work plan client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes key, case id and language in the plan path", async () => {
    const fetchSpy = mockFetch();
    const client = new ApiClient();
    client.setCsrfToken("csrf-plan");
    await client.patchWorkPlan("proj a", "EN 1/7 #é", "pt-BR", { review: true, expected_revision: 2 });
    await client.discardVariant("proj a", "doc/1 #é", { reason: "Wrong text", confirm: true });
    await client.annotationTargetPreview("proj a", 2);
    expect(fetchSpy.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/projects/proj%20a/work-plans/EN%201%2F7%20%23%C3%A9/pt-BR", "PATCH"],
      ["/api/v1/projects/proj%20a/variants/doc%2F1%20%23%C3%A9/discard", "POST"],
      ["/api/v1/projects/proj%20a/work-plans/annotation-target-preview?annotations_per_text=2", "GET"],
    ]);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ review: true, expected_revision: 2 });
    expect(new Headers(fetchSpy.mock.calls[0][1].headers).get("X-CSRF-Token")).toBe("csrf-plan");
  });

  it("posts bulk preview and save bodies unchanged", async () => {
    const fetchSpy = mockFetch();
    const client = new ApiClient();
    const body: BulkPlanRequest = {
      case_ids: ["c1", "c2"],
      languages: { de: { review: "on", annotate: "keep" }, source: { annotate: "off" } },
      accept_external_review: { languages: ["fr"], reason: "Reviewed outside" },
      expected_revisions: { c1: 2, c2: 3 },
      confirm: true,
    };
    await client.previewWorkPlans("proj", body);
    await client.saveWorkPlans("proj", body);
    await client.setWorkPlanRows("proj", {
      rows: [{ case_id: "c1", language: "de", review: false, annotate: false, restored_revision: null }],
      expected_revisions: { c1: 3 },
      undo: true,
    });
    await client.lookupCaseIds("proj", ["c1", " c2 "]);
    expect(fetchSpy.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/projects/proj/work-plans/bulk/preview", "POST"],
      ["/api/v1/projects/proj/work-plans/bulk", "PUT"],
      ["/api/v1/projects/proj/work-plans/rows", "PUT"],
      ["/api/v1/projects/proj/case-ids/lookup", "POST"],
    ]);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual(body);
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual(body);
    expect(JSON.parse(fetchSpy.mock.calls[2][1].body).undo).toBe(true);
    expect(JSON.parse(fetchSpy.mock.calls[3][1].body)).toEqual({ ids: ["c1", " c2 "] });
  });

  it("keeps the old commit body without a plan", async () => {
    const fetchSpy = mockFetch();
    const client = new ApiClient();
    await client.commitUpload("proj", 4, "sha");
    await client.commitUpload("proj", 4, "sha", [{ external_id: "d", language: "de", version: 1, reason: "ok" }]);
    await client.commitUpload("proj", 4, "sha", undefined, {
      plan_languages: { de: { review: true, annotate: true } },
      accept_external_review: { languages: ["fr"], reason: "Reviewed outside" },
    });
    const bodies = fetchSpy.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[0]).toEqual({ plan_sha256: "sha" });
    expect(bodies[1]).toEqual({ plan_sha256: "sha", status_overrides: [{ external_id: "d", language: "de", version: 1, reason: "ok" }] });
    expect(bodies[2]).toEqual({
      plan_sha256: "sha",
      plan_languages: { de: { review: true, annotate: true } },
      accept_external_review: { languages: ["fr"], reason: "Reviewed outside" },
    });
  });
});
