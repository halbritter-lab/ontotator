import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../src/api/client";
import { LAST_PROJECT_PREFIX, landingProject, rememberProject, rememberedProject } from "../src/app/lastProject";

const project = (key: string, roles: ProjectSummary["roles"]): ProjectSummary => ({
  project_key: key, name: `Project ${key}`, description: null, roles, allowed_modes: ["independent"], document_count: 0,
  can_manage: roles.includes("lead"),
});

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

it("returns the remembered project for any role while it is accessible", () => {
  rememberProject("ana", "x");
  expect(landingProject("ana", [project("w", ["lead"]), project("x", ["lead"])])).toBe("x");
  expect(landingProject("ana", [project("w", ["lead"]), project("x", ["annotator"])])).toBe("x");
  expect(landingProject("ana", [project("x", ["adjudicator"])])).toBe("x");
});

it("returns undefined when the remembered project is not in the list", () => {
  rememberProject("ana", "gone");
  expect(landingProject("ana", [project("w", ["lead"]), project("x", ["annotator"])])).toBeUndefined();
});

it("returns undefined when nothing is remembered, without a first-led fallback", () => {
  expect(landingProject("ana", [project("w", ["lead"])])).toBeUndefined();
  expect(landingProject("ana", [])).toBeUndefined();
});

it("keeps one entry per user", () => {
  rememberProject("ana", "x");
  rememberProject("ben", "y");
  expect(rememberedProject("ana")).toBe("x");
  expect(window.localStorage.getItem(`${LAST_PROJECT_PREFIX}ben`)).toBe("y");
  expect(landingProject("ben", [project("x", ["lead"])])).toBeUndefined();
  expect(landingProject("ben", [project("y", ["annotator"])])).toBe("y");
});

it("survives unavailable storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(() => rememberProject("ana", "x")).not.toThrow();
  expect(rememberedProject("ana")).toBeNull();
  expect(landingProject("ana", [project("w", ["lead"])])).toBeUndefined();
});
