import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, type LeadCorrectionRequest } from "../src/api/client";

afterEach(() => { vi.unstubAllGlobals(); });

it("posts the lead correction", async () => {
  const view = { id: 7, lead_correction: true };
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => view });
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient();
  client.setCsrfToken("token");
  const body: LeadCorrectionRequest = { expected_text_sha256: "a".repeat(64), confirm_language: true };
  await expect(client.startLeadCorrection("p/key", "case-1/de", body)).resolves.toEqual(view);
  const [url, init] = fetch.mock.calls[0];
  expect([url, init.method]).toEqual(["/api/v1/projects/p%2Fkey/documents/case-1%2Fde/lead-correction", "POST"]);
  expect(JSON.parse(init.body)).toEqual(body);
  expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("token");
});
