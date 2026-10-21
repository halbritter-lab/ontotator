import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { profile, settings } from "./projectFixtures";
afterEach(() => { vi.restoreAllMocks(); });

it("uses exact project endpoints, changed-only PATCH, structural PUTs, encoded keys and member revocation", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => settings });
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient(); client.setCsrfToken("token");
  await client.listTemplates();
  await client.createProject({ key: "p", name: "Project", template: "template", pins: [] });
  await client.getProjectSettings("p/key");
  await client.updateProjectSettings("p/key", { name: "Research" });
  await client.updatePins("p/key", []);
  await client.updateProjectProfile("p/key", profile);
  await client.listMembers("p/key");
  await client.setMemberRoles("p/key", "alice.name", [], true);
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
    ["/api/v1/projects/templates", "GET"], ["/api/v1/projects/", "POST"],
    ["/api/v1/projects/p%2Fkey/settings", "GET"], ["/api/v1/projects/p%2Fkey/settings", "PATCH"],
    ["/api/v1/projects/p%2Fkey/pins", "PUT"], ["/api/v1/projects/p%2Fkey/profile", "PUT"],
    ["/api/v1/projects/p%2Fkey/members", "GET"], ["/api/v1/projects/p%2Fkey/members/alice.name", "PUT"],
  ]);
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ name: "Research" });
  expect(JSON.parse(fetch.mock.calls[7][1].body)).toEqual({ roles: [], revoke_assignments: true });
  expect(fetch.mock.calls.every(([, init]) => init.credentials === "same-origin")).toBe(true);
  for (const [, init] of fetch.mock.calls) expect(new Headers(init.headers).get("X-CSRF-Token")).toBe(init.method === "GET" ? null : "token");
  vi.unstubAllGlobals();
});
