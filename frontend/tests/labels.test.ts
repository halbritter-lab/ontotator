// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assignmentStatusLabels, formatDateTime, taskCrumbLabel, humanize, jobStatusLabels, labelFor, plural, roleLabels, taskLabels, uploadKindLabels, uploadStatusLabels } from "../src/app/labels";
import { taskActionLabels, taskDescription } from "../src/tasks/MyTasks";

describe("workflow labels", () => {
  it("maps every known code to plain words", () => {
    expect(taskLabels).toEqual({ annotate: "Annotation", review: "Consolidation", translation_review: "Translation review" });
    expect(assignmentStatusLabels.in_progress).toBe("In progress");
    expect(assignmentStatusLabels.submitted).toBe("Submitted");
    expect(roleLabels.lead).toBe("Lead");
    expect(jobStatusLabels.succeeded).toBe("Finished");
    expect(uploadStatusLabels.ready).toBe("Ready to import");
    expect(uploadKindLabels.t1).toBe("Ontospan bundle");
  });

  it("humanizes unknown codes instead of showing snake case", () => {
    expect(humanize("ready_for_review")).toBe("Ready for review");
    expect(humanize("automatic-check_failed")).toBe("Automatic check failed");
    expect(humanize("")).toBe("");
    expect(labelFor(taskLabels, "translation_review")).toBe("Translation review");
    expect(labelFor(taskLabels, "new_server_task")).toBe("New server task");
    expect(labelFor(taskLabels, "toString")).toBe("Tostring");
  });

  it("pluralizes counts", () => {
    expect(plural(0, "document")).toBe("0 documents");
    expect(plural(1, "document")).toBe("1 document");
    expect(plural(2, "document")).toBe("2 documents");
    expect(plural(1, "person", "people")).toBe("1 person");
    expect(plural(3, "person", "people")).toBe("3 people");
  });

  it("formats dates in one English style without seconds", () => {
    const value = "2026-10-16T19:17:15";
    const shown = formatDateTime(value);
    expect(shown).toMatch(/^16 Oct 2026, 19:17$/);
    expect(shown).not.toContain(":15");
    expect(formatDateTime(new Date(value))).toBe(shown);
    expect(formatDateTime("not a date")).toBe("not a date");
  });
});

describe("my task actions", () => {
  it("names the action by task status", () => {
    expect(taskActionLabels).toEqual({ open: "Start", reopened: "Continue", in_progress: "Continue", submitted: "View" });
  });

  it("describes translation reviews with their language direction in words", () => {
    expect(taskDescription({ task: "annotate", language: "de" })).toBe("Annotation");
    expect(taskDescription({ task: "translation_review", language: "de", source_language: "en", target_language: "de" })).toBe("Translation review (en to de)");
    expect(taskDescription({ task: "translation_review", language: "de", source_language: null })).toBe("Translation review (unknown language to de)");
  });

  it("names a task for the breadcrumb", () => {
    expect(taskCrumbLabel({ external_id: "failed-translation", document_id: "d", task: "translation_review", language: "de" })).toBe("failed-translation, Translation review (de)");
    expect(taskCrumbLabel({ external_id: "accepted-translation", document_id: "d", task: "annotate", language: "de" })).toBe("accepted-translation, Annotation (de)");
    expect(taskCrumbLabel({ external_id: null, document_id: "doc-7", task: "review", language: "en" })).toBe("Consolidation (en)");
    expect(taskCrumbLabel({ external_id: "", document_id: "doc-7", task: "review", language: "en" })).toBe("Consolidation (en)");
  });
});
