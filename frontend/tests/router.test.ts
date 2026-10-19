import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigate, parseRoute, routeHref, useRoute, type Route } from "../src/app/router";

beforeEach(() => { window.history.replaceState(null, "", "/"); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("hash route parsing and links", () => {
  const routes: Route[] = [
    { name: "tasks" },
    { name: "tasks", project: "study-a" },
    { name: "tasks", project: "" },
    { name: "task", assignmentId: 1 },
    { name: "task", assignmentId: Number.MAX_SAFE_INTEGER },
    { name: "me" },
    { name: "adminUsers" },
    { name: "adminOntologies" },
    { name: "projectNew" },
    { name: "projectSettings", key: "study-a" },
    { name: "projectDocuments", key: "study-a" },
    { name: "projectProgress", key: "study-a" },
    { name: "projectExport", key: "study-a" },
    { name: "projectProblemReport", key: "study/a %", reportId: "report/1 %é" },
    { name: "notFound", hash: "#/missing-page" },
    { name: "projectDocuments", key: "study", language: "de", status: "in_progress", q: "doc prefix", select: "doc/1 % α" },
    { name: "projectDocuments", key: "study", language: "", status: "", q: "", select: "" },
  ];

  it.each(routes)("round trips $name %j", (route) => {
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it.each(["", "#/"])("opens My tasks for the root hash %j", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "tasks" });
  });

  it("uses the documented fixed paths", () => {
    expect(routeHref({ name: "tasks" })).toBe("#/");
    expect(routeHref({ name: "task", assignmentId: 42 })).toBe("#/tasks/42");
    expect(routeHref({ name: "me" })).toBe("#/me");
    expect(routeHref({ name: "adminUsers" })).toBe("#/admin/users");
    expect(routeHref({ name: "adminOntologies" })).toBe("#/admin/ontologies");
    expect(routeHref({ name: "projectNew" })).toBe("#/projects/new");
    expect(routeHref({ name: "projectSettings", key: "a" })).toBe("#/projects/a/settings");
    expect(routeHref({ name: "projectDocuments", key: "a" })).toBe("#/projects/a/documents");
    expect(routeHref({ name: "projectProgress", key: "a" })).toBe("#/projects/a/progress");
    expect(routeHref({ name: "projectExport", key: "a" })).toBe("#/projects/a/export");
    expect(routeHref({ name: "projectProblemReport", key: "a", reportId: "report-42" })).toBe("#/projects/a/problem-reports/report-42");
  });

  it.each(["study-a", "a b", "100%", "a/b", "%2F", "日本語 α", "a?b#c+d&x=y"])("round trips encoded project/document IDs %j", (id) => {
    for (const name of ["projectSettings", "projectDocuments", "projectProgress", "projectExport"] as const) {
      const route = { name, key: id };
      expect(routeHref(route)).toBe(`#/projects/${encodeURIComponent(id)}/${name.slice("project".length).toLowerCase()}`);
      expect(parseRoute(routeHref(route))).toEqual(route);
    }
    const documents: Route = { name: "projectDocuments", key: id, select: id, q: id };
    expect(parseRoute(routeHref(documents))).toEqual(documents);
    const tasks: Route = { name: "tasks", project: id };
    expect(parseRoute(routeHref(tasks))).toEqual(tasks);
  });

  it("reads the root project filter without leaking it to unrelated routes", () => {
    expect(parseRoute("#/?project=study%2Fa+b%25")).toEqual({ name: "tasks", project: "study/a b%" });
    expect(parseRoute("#/me?project=study")).toEqual({ name: "me" });
    expect(parseRoute("#/projects/a/documents?project=other&language=de&status=reopened&q=prefix+%25&select=doc%2F1"))
      .toEqual({ name: "projectDocuments", key: "a", language: "de", status: "reopened", q: "prefix %", select: "doc/1" });
  });

  it("ignores unrelated query keys and keeps the first duplicate value", () => {
    expect(parseRoute("#/?project=first&project=second&extra=x")).toEqual({ name: "tasks", project: "first" });
    expect(parseRoute("#/projects/a/documents?q=first&q=second&extra=x")).toEqual({ name: "projectDocuments", key: "a", q: "first" });
  });

  it.each(["#main", "#/unknown", "#/tasks", "#/tasks/1/extra", "#/me/", "#/projects", "#/projects/a", "#/projects//settings", "#/projects/a/b/settings", "#/projects/a/unknown", "/me"])("returns NotFound for unknown hash %j", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "notFound", hash });
  });

  it.each(["#/projects/%/settings", "#/projects/%GG/documents", "#/projects/%FF/progress", "#/projects/%E0%A4%A/export", "#/?project=%", "#/?project=%FF", "#/projects/a/documents?select=%E0%A4%A", "#/projects/a/documents?ignored=%GG"])("handles malformed encoding safely %j", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "notFound", hash });
  });

  it.each(["0", "-1", "+1", "1.5", "1e3", "01", "NaN", "Infinity", "9007199254740992", "99999999999999999999999", "%31", " 1"])("rejects invalid assignment ID %j", (id) => {
    const hash = `#/tasks/${id}`;
    expect(parseRoute(hash)).toEqual({ name: "notFound", hash });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("does not generate a task URL for invalid ID %s", (assignmentId) => {
    expect(() => routeHref({ name: "task", assignmentId })).toThrow(RangeError);
  });
});

describe("hash route subscription", () => {
  it("reads the current hash on mount and follows native hash changes", async () => {
    window.history.replaceState(null, "", "#/me");
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: "me" });
    act(() => { window.location.hash = "#/tasks/42"; });
    await waitFor(() => expect(result.current).toEqual({ name: "task", assignmentId: 42 }));
    act(() => {
      window.history.replaceState(null, "", "#/unknown");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current).toEqual({ name: "notFound", hash: "#/unknown" });
  });

  it("navigates through the shared href contract and updates subscribers", async () => {
    const { result } = renderHook(() => useRoute());
    const route: Route = { name: "projectDocuments", key: "study / α", q: "doc %", select: "doc/1" };
    act(() => navigate(route));
    expect(window.location.hash).toBe(routeHref(route));
    await waitFor(() => expect(result.current).toEqual(route));
    act(() => navigate(route));
    expect(result.current).toEqual(route);
  });

  it("cleans up its hashchange listener on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const hook = renderHook(() => useRoute());
    const subscription = add.mock.calls.find(([event]) => event === "hashchange");
    expect(subscription).toBeDefined();
    hook.unmount();
    expect(remove).toHaveBeenCalledWith("hashchange", subscription![1]);
  });
});
