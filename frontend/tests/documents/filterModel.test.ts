import { describe, expect, it } from "vitest";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import {
  activeTab, chipsOf, clearAllPatch, FACET_GROUPS, facetGroups, filtersActive, optionChecked, optionCount, rowsRequest, tabRoute, toggleOption,
} from "../../src/documents/filterModel";

const optionOf = (label: string) => FACET_GROUPS.flatMap(group => group.options).find(option => option.label === label)!;
const labels = (query: ProjectDocumentsQuery) => chipsOf(query).map(chip => chip.label);

describe("filter model", () => {
  // Spec "Mapping of today's filters (VD9)": every old route filter still reaches the server and shows where it lives now.
  it.each<[string, ProjectDocumentsQuery, Record<string, unknown>, string[]]>([
    ["Language select → Language facet (repeatable)", { language: "de,fr" }, { language: ["de", "fr"] }, ["Language: de", "Language: fr"]],
    ["one language stays one value", { language: "de" }, { language: "de" }, ["Language: de"]],
    ["Next step → chip", { step: "choose_final" }, { step: "choose_final" }, ["Step: Choose final result"]],
    ["Plan → route parameter and chip", { plan: "review,not_decided" }, { plan: ["review", "not_decided"] }, ["Plan: Review", "Plan: Not decided"]],
    ["Case ID → search field (no chip)", { q: "case-104 de" }, { q: "case-104 de" }, []],
    ["Final result none → route parameter and chip", { final: "none" }, { final: "none" }, ["Final result: None"]],
    ["Final result any", { final: "any" }, { final: "any" }, ["Final result: Has a final result"]],
    ["Origin → Final · Origin facet", { origin: "machine_translation,native" }, { origin: ["machine_translation", "native"] }, ["Origin: Machine translation", "Origin: Source"]],
    ["Translation status → chip", { translation_status: "accepted_without_review" }, { translation_status: "accepted_without_review" }, ["Translation status: Accepted without review"]],
    ["Status → chip", { status: "submitted" }, { status: "submitted" }, ["Assignment status: Submitted"]],
    ["Sort → header and popover footer (no chip)", { sort: "-activity" }, { sort: "-activity" }, []],
    ["Bar segments → tabs (no chip)", { segment: "done" }, { segment: "done" }, []],
    ["Decision category → chip under Needs your decision", { decision: "translation" }, { decision: "translation" }, ["Translation rejected or queried"]],
    ["Stage → chip", { stage: "final" }, { stage: "final" }, ["Stage: Final result"]],
    ["Owner → chip", { owner: "me" }, { owner: "me" }, ["Owner: You"]],
    ["Paused → chip", { paused: "yes" }, { paused: "yes" }, ["Paused tasks"]],
    ["Review facet", { review_state: "in_progress,re_review,check_failed" }, { review_state: ["in_progress", "re_review", "check_failed"] }, ["Review: In progress", "Review: Check failed"]],
    ["Annotation facet", { annotation_state: "old_text_open" }, { annotation_state: "old_text_open" }, ["Annotation: On old text"]],
    ["Final facet", { final_state: "none,after_annotation,after_review,choose" }, { final_state: ["none", "after_annotation", "after_review", "choose"] }, ["Final: No final yet"]],
    ["Waiting on facet", { waiting_on: "me,ann-0001" }, { waiting_on: ["me", "ann-0001"] }, ["Waiting on: You", "Waiting on: ann-0001"]],
    ["Exact case (deep link)", { case: "case-104" }, { case: "case-104" }, ["Case ID: case-104"]],
  ])("maps every old filter per VD9: %s", (_name, query, request, chips) => {
    expect(rowsRequest(query)).toEqual(request);
    expect(labels(query)).toEqual(chips);
  });

  it("drops unknown values and keeps the API's precedence", () => {
    expect(rowsRequest({ origin: "nope", review_state: "nope,accepted", step: "x", segment: "elsewhere", sort: "case", page: "1" })).toEqual({ review_state: "accepted" });
    expect(rowsRequest({ segment: "assign", decision: "translation", final: "none" })).toEqual({ segment: "assign", final: "none" });
    expect(rowsRequest({ decision: "translation", final: "none", page: "3" })).toEqual({ decision: "translation", page: 3 });
    expect(labels({ review_state: "nope", status: "x" })).toEqual([]);
  });

  it("legacy step, stage, paused, status, translation_status, final, owner become chips with labels", () => {
    expect(labels({ step: "resolve_rejected,resolve_queried", stage: "final,done", paused: "no", status: "held", translation_status: "automatic_check_failed", final: "missing", owner: "ann-0004" })).toEqual([
      "Step: Resolve rejected translation", "Step: Resolve queried translation", "Stage: Final result", "Stage: Done", "Owner: ann-0004",
      "Not paused", "Assignment status: Paused", "Translation status: Check failed", "Final result missing",
    ]);
    // Removing one value of a comma-joined parameter keeps the others.
    const step = chipsOf({ step: "resolve_rejected,resolve_queried" })[0];
    expect(step.patch).toEqual({ step: "resolve_queried" });
    const grouped = chipsOf({ review_state: "in_progress,re_review,accepted" })[0];
    expect(grouped.patch).toEqual({ review_state: "accepted" });
    // A decision category chip leaves the lead under Needs your decision.
    expect(chipsOf({ decision: "confirm-final" })[0].patch).toEqual({ decision: undefined, segment: "decision" });
  });

  it("Clear all keeps tab and order", () => {
    const query: ProjectDocumentsQuery = {
      segment: "assign", sort: "-case", panel: "c:de", page: "2", select: "x", language: "de", q: "case", step: "assign_annotation",
      review_state: "accepted", waiting_on: "me", case: "c", plan: "review", final: "none",
    };
    const next = { ...query, ...clearAllPatch(query) };
    expect(Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined))).toEqual({ segment: "assign", sort: "-case", panel: "c:de" });
    expect(clearAllPatch({ decision: "translation", language: "de" })).toMatchObject({ decision: undefined, segment: "decision", language: undefined });
    expect(filtersActive({ segment: "assign", sort: "-case" })).toBe(false);
    expect(filtersActive({ q: "c" })).toBe(true);
  });

  it("tab change keeps facets and search, drops page, open, select", () => {
    const query: ProjectDocumentsQuery = { segment: "assign", language: "de", q: "case-1", review_state: "accepted", sort: "activity", page: "3", select: "x", panel: "c:de", panel_stage: "review", panel_tab: "details", decision: "translation" };
    expect(tabRoute("p", query, "done")).toEqual({ name: "projectDocuments", key: "p", segment: "done", language: "de", q: "case-1", review_state: "accepted", sort: "activity" });
    expect(tabRoute("p", query, "all")).toEqual({ name: "projectDocuments", key: "p", language: "de", q: "case-1", review_state: "accepted", sort: "activity" });
    expect(activeTab({})).toBe("all");
    expect(activeTab({ segment: "done" })).toBe("done");
    expect(activeTab({ decision: "translation" })).toBe("decision");
    expect(activeTab({ segment: "nope" })).toBe("all");
  });

  it("toggles grouped options and counts their values", () => {
    const inProgress = optionOf("In progress");
    expect(inProgress.values).toEqual(["in_progress", "re_review"]);
    expect(toggleOption({ review_state: "accepted" }, inProgress, true)).toEqual({ review_state: "accepted,in_progress,re_review" });
    expect(toggleOption({ review_state: "accepted,re_review" }, inProgress, false)).toEqual({ review_state: "accepted" });
    expect(toggleOption({ review_state: "re_review" }, inProgress, false)).toEqual({ review_state: undefined });
    expect(optionChecked({ review_state: "re_review" }, inProgress)).toBe(true);
    expect(optionCount({ review_state: { in_progress: 2, re_review: 1, accepted: 4 } }, inProgress)).toBe(3);
    expect(optionCount({}, inProgress)).toBe(0);
  });

  it("builds the Language and Waiting on groups from the facet counts and the route", () => {
    const groups = facetGroups({ language: { de: 8, en: 3 }, waiting_on: { "ann-0002": 1, me: 2 } }, { language: "fr", waiting_on: "ann-0009" }, new Set(["en"]));
    expect(groups.map(group => group.legend)).toEqual(["Language", "Review", "Annotation", "Final", "Origin", "Plan", "Waiting on"]);
    expect(groups[0].options.map(option => option.label)).toEqual(["de", "en (source)", "fr"]);
    expect(groups[6].options.map(option => option.label)).toEqual(["You", "ann-0002", "ann-0009"]);
    const named = facetGroups({ waiting_on: { "ann-0002": 1 } }, {}, new Set(), new Map([["ann-0002", "Ana Weber"]]));
    expect(named.at(-1)!.options.map(option => option.label)).toEqual(["Ana Weber"]);
    expect(chipsOf({ waiting_on: "ann-0002" }, new Map([["ann-0002", "Ana Weber"]])).map(chip => chip.label)).toEqual(["Waiting on: Ana Weber"]);
    expect(facetGroups({}, {}, new Set()).map(group => group.legend)).toEqual(["Language", "Review", "Annotation", "Final", "Origin", "Plan"]);
  });
});
