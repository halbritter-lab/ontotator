import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigate, parseRoute, routeHref, SETTINGS_SECTIONS, useRoute, type Route } from "../src/app/router";

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
    { name: "tasks", status: "submitted" },
    { name: "tasks", project: "p1", status: "todo" },
    { name: "tasks", status: "all" },
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

  it("reads and writes the My tasks status tab (F7)", () => {
    expect(parseRoute("#/?status=submitted")).toEqual({ name: "tasks", status: "submitted" });
    expect(routeHref({ name: "tasks", status: "submitted" })).toBe("#/?status=submitted");
    expect(parseRoute("#/?project=p1&status=todo")).toEqual({ name: "tasks", project: "p1", status: "todo" });
    expect(routeHref({ name: "tasks", project: "p1", status: "todo" })).toBe("#/?project=p1&status=todo");
    expect(parseRoute("#/?status=all")).toEqual({ name: "tasks", status: "all" });
    expect(routeHref({ name: "tasks", status: "all" })).toBe("#/?status=all");
    expect(parseRoute("#/?status=bogus")).toEqual({ name: "tasks" });
    expect(parseRoute("#/?project=p1&status=bogus")).toEqual({ name: "tasks", project: "p1" });
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

describe("Documents deep-link parameters", () => {
  it("round_trips_documents_decision_final_case_panel_and_page", () => {
    const route: Route = { name: "projectDocuments", key: "p", language: "de", case: "case/1 #é", decision: "confirm-final", panel: "case-1:de", page: "2" };
    const href = routeHref(route);
    expect(href).toContain("panel=case-1%3Ade");
    expect(parseRoute(href)).toEqual(route);
    expect(parseRoute("#/projects/p/documents?final=missing")).toEqual({ name: "projectDocuments", key: "p", final: "missing" });
  });
  it("round_trips_the_row_panel_with_its_stage_filter_and_tab", () => {
    const route: Route = { name: "projectDocuments", key: "p", stage: "annotation", panel: "c:de", panel_stage: "annotation", panel_tab: "versions" };
    expect(routeHref(route)).toBe("#/projects/p/documents?stage=annotation&panel=c%3Ade&panel_stage=annotation&panel_tab=versions");
    expect(parseRoute(routeHref(route))).toEqual(route);
  });
  it("maps_the_legacy_open_parameter_to_the_row_panel", () => {
    expect(parseRoute("#/projects/p/documents?open=a%3Ade&open=b%3Aen"))
      .toEqual({ name: "projectDocuments", key: "p", panel: "a:de" });
    expect(parseRoute("#/projects/p/documents?panel=b%3Aen&open=a%3Ade"))
      .toEqual({ name: "projectDocuments", key: "p", panel: "b:en" });
    expect(parseRoute("#/projects/p/cases/c?documents_open=a%3Ade"))
      .toEqual({ name: "projectCase", key: "p", caseId: "c", documents: { panel: "a:de" } });
  });
  it("passes_the_full_documents_query_through_case_and_report_routes", () => {
    const documents = { decision: "report-or-pause", panel: "c:de", panel_stage: "review", panel_tab: "details", page: "3", case: "c", language: "de" };
    const viewer: Route = { name: "projectCase", key: "p", caseId: "c", variant: "d", annotations: JSON.stringify(["submission", "s1"]), compare: JSON.stringify(["submission", "s2"]), documents };
    expect(parseRoute(routeHref(viewer))).toEqual(viewer);
    const report: Route = { name: "projectProblemReport", key: "p", reportId: "r 1", action: "resume", documents };
    expect(parseRoute(routeHref(report))).toEqual(report);
  });
  it("keeps case parameter order: variant, annotations, compare, then documents_*", () => {
    const href = routeHref({ name: "projectCase", key: "p", caseId: "c", documents: { q: "x", panel: "c:de" }, compare: "b", annotations: "a", variant: "v" });
    expect(href).toBe("#/projects/p/cases/c?variant=v&annotations=a&compare=b&documents_q=x&documents_panel=c%3Ade");
  });
  it("round_trips_lead_workflow_filters_segment_step_stage_owner_plan_sort_and_final_none", () => {
    const route: Route = { name: "projectDocuments", key: "p", segment: "assign", step: "assign_translation_review", stage: "translation_review", owner: "me", plan: "review_and_annotate", sort: "activity", final: "none", language: "de" };
    expect(parseRoute(routeHref(route))).toEqual(route);
    for (const [field, value] of [["segment", "decision"], ["step", "choose_final"], ["stage", "final"], ["owner", "ann-0004"], ["plan", "not_in_plan"], ["sort", "import"], ["final", "none"]] as const) {
      const single: Route = { name: "projectDocuments", key: "p", [field]: value };
      expect(routeHref(single)).toBe(`#/projects/p/documents?${field}=${value}`);
      expect(parseRoute(routeHref(single))).toEqual(single);
    }
    const viewer: Route = { name: "projectCase", key: "p", caseId: "c", documents: { segment: "progress", plan: "review", sort: "case" } };
    expect(parseRoute(routeHref(viewer))).toEqual(viewer);
  });
  it("round-trips comma-joined step, stage and plan", () => {
    const route: Route = { name: "projectDocuments", key: "p", plan: "review,review_and_annotate", step: "resolve_rejected,resolve_queried", stage: "final,done" };
    expect(routeHref(route)).toBe("#/projects/p/documents?step=resolve_rejected,resolve_queried&stage=final,done&plan=review,review_and_annotate");
    expect(parseRoute(routeHref(route))).toEqual(route);
    expect(parseRoute("#/projects/p/documents?step=resolve_rejected%2Cresolve_queried")).toEqual({ name: "projectDocuments", key: "p", step: "resolve_rejected,resolve_queried" });
    const viewer: Route = { name: "projectCase", key: "p", caseId: "c", documents: { step: "annotation_in_progress,annotation_review_in_progress" } };
    expect(parseRoute(routeHref(viewer))).toEqual(viewer);
  });
  it("parses and builds the new repeatable fields and panel", () => {
    const route: Route = {
      name: "projectDocuments", key: "p", language: "de,fr", origin: "machine_translation,correction", segment: "done",
      review_state: "in_progress,re_review", annotation_state: "old_text_open,old_text_submitted", final_state: "none,after_annotation",
      waiting_on: "me,ann-0001", plan: "not_decided", sort: "-activity", panel: "case-1:de",
    };
    expect(routeHref(route)).toBe("#/projects/p/documents?language=de,fr&origin=machine_translation,correction&segment=done&plan=not_decided&sort=-activity"
      + "&review_state=in_progress,re_review&annotation_state=old_text_open,old_text_submitted&final_state=none,after_annotation&waiting_on=me,ann-0001&panel=case-1%3Ade");
    expect(parseRoute(routeHref(route))).toEqual(route);
    const viewer: Route = { name: "projectCase", key: "p", caseId: "c", documents: { review_state: "check_failed", waiting_on: "me", panel: "c:de" } };
    expect(parseRoute(routeHref(viewer))).toEqual(viewer);
  });
  it("keeps final=any and paused", () => {
    const route: Route = { name: "projectDocuments", key: "p", plan: "annotate,review_and_annotate", final: "any", paused: "no" };
    expect(routeHref(route)).toBe("#/projects/p/documents?final=any&plan=annotate,review_and_annotate&paused=no");
    expect(parseRoute(routeHref(route))).toEqual(route);
    const report: Route = { name: "projectProblemReport", key: "p", reportId: "r", documents: { paused: "yes" } };
    expect(parseRoute(routeHref(report))).toEqual(report);
  });
  it("round_trips_the_report_decide_section", () => {
    const report: Route = { name: "projectProblemReport", key: "p", reportId: "r-1", section: "decide" };
    expect(routeHref(report)).toBe("#/projects/p/problem-reports/r-1?section=decide");
    expect(parseRoute(routeHref(report))).toEqual(report);
    const both: Route = { name: "projectProblemReport", key: "p", reportId: "r-1", section: "decide", documents: { segment: "decision" } };
    expect(parseRoute(routeHref(both))).toEqual(both);
    expect(parseRoute("#/projects/p/problem-reports/r?section=other")).toEqual({ name: "projectProblemReport", key: "p", reportId: "r" });
  });
  it("drops_unknown_report_actions", () => {
    expect(parseRoute("#/projects/p/problem-reports/r?action=restart")).toEqual({ name: "projectProblemReport", key: "p", reportId: "r" });
  });
});

describe("settings section addresses", () => {
  it("parses and builds settings section addresses", () => {
    expect(parseRoute("#/projects/a/settings")).toEqual({ name: "projectSettings", key: "a" });
    expect(parseRoute("#/projects/a/settings/rules")).toEqual({ name: "projectSettings", key: "a", section: "rules" });
    expect(parseRoute("#/projects/a/settings/unknown").name).toBe("notFound");
    expect(routeHref({ name: "projectSettings", key: "a", section: "general" })).toBe("#/projects/a/settings");
    expect(routeHref({ name: "projectSettings", key: "a", section: "defaults" })).toBe("#/projects/a/settings/defaults");
    for (const section of SETTINGS_SECTIONS) expect(parseRoute(routeHref({ name: "projectSettings", key: "a", section }))).toMatchObject({ key: "a" });
  });
});

describe("project guidelines addresses", () => {
  it("parses and builds #/projects/{key}/guidelines and /guidelines/v{n}", () => {
    expect(parseRoute("#/projects/study%2Fa/guidelines")).toEqual({ name: "projectGuidelines", key: "study/a" });
    expect(parseRoute("#/projects/a/guidelines/v3")).toEqual({ name: "projectGuidelines", key: "a", version: 3 });
    expect(routeHref({ name: "projectGuidelines", key: "study/a" })).toBe("#/projects/study%2Fa/guidelines");
    expect(routeHref({ name: "projectGuidelines", key: "a", version: 12 })).toBe("#/projects/a/guidelines/v12");
  });

  it.each(["#/projects/a/guidelines/v0", "#/projects/a/guidelines/vx", "#/projects/a/guidelines/v01", "#/projects/a/guidelines/3",
    "#/projects/a/guidelines/v", "#/projects/a/guidelines/v1.5", "#/projects/a/guidelines/v9007199254740992", "#/projects/a/guidelines/"])("v0 and non-numeric versions are notFound %j", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "notFound", hash });
  });
});

describe("consolidation view addresses", () => {
  it("parses and builds #/projects/{key}/consolidations/{roundId} with an optional group", () => {
    expect(parseRoute("#/projects/study%2Fa/consolidations/r%201")).toEqual({ name: "projectConsolidation", key: "study/a", roundId: "r 1" });
    expect(parseRoute("#/projects/a/consolidations/r-9?group=abc123")).toEqual({ name: "projectConsolidation", key: "a", roundId: "r-9", group: "abc123" });
    expect(routeHref({ name: "projectConsolidation", key: "study/a", roundId: "r 1" })).toBe("#/projects/study%2Fa/consolidations/r%201");
    expect(routeHref({ name: "projectConsolidation", key: "a", roundId: "r-9", group: "abc123" })).toBe("#/projects/a/consolidations/r-9?group=abc123");
    for (const route of [{ name: "projectConsolidation" as const, key: "a", roundId: "r-9" }, { name: "projectConsolidation" as const, key: "a", roundId: "r-9", group: "g" }]) {
      expect(parseRoute(routeHref(route))).toEqual(route);
    }
  });

  it("keeps the flags facet in the Documents query", () => {
    expect(parseRoute("#/projects/a/documents?flags=guidelines_unclear")).toEqual({ name: "projectDocuments", key: "a", flags: "guidelines_unclear" });
    expect(routeHref({ name: "projectDocuments", key: "a", flags: "guidelines_unclear" })).toBe("#/projects/a/documents?flags=guidelines_unclear");
  });
});
