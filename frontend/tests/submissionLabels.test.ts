// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatTime, fullTimestamp, kindLabels, personLabel, roundCell, submissionLabel } from "../src/app/submissionLabels";

const now = new Date("2026-10-19T12:00:00");

describe("shared submission labels", () => {
  it("formats_local_time_with_year_only_outside_the_current_year", () => {
    expect(formatTime("2026-10-19T00:57:00", { now })).toBe("19 Oct, 00:57");
    expect(formatTime("2025-03-02T08:05:00", { now })).toBe("2 Mar 2025, 08:05");
    expect(formatTime("2026-10-19T00:57:09", { now, seconds: true })).toBe("19 Oct, 00:57:09");
    expect(formatTime("2026-09-03T09:00:00", { now })).toBe("3 Sep, 09:00");
  });
  it("returns_invalid_input_unchanged", () => {
    expect(formatTime("not a date", { now })).toBe("not a date");
    expect(fullTimestamp("not a date")).toBe("not a date");
  });
  it("full_timestamp_includes_year_and_time", () => {
    const text = fullTimestamp("2026-10-19T00:57:09");
    expect(text).toContain("2026");
    expect(text).toContain("00:57:09");
  });
  it("person_label_marks_the_lead_without_nested_parentheses", () => {
    expect(personLabel("ann-0004", false)).toBe("ann-0004");
    expect(personLabel("lead-0002", true)).toBe("lead-0002 (you)");
    expect(roundCell({ ordinal: 1, author: "lead-0002", isMe: true })).toBe("Round 1 (lead-0002, you)");
    expect(roundCell({ ordinal: 3, author: "ann-0004", isMe: false })).toBe("Round 3 (ann-0004)");
    expect(roundCell({ ordinal: null, author: "ann-0004", isMe: false })).toBe("Initial submission (ann-0004)");
  });
  it("submission_label_variants", () => {
    const base = { kind: "annotation" as const, ordinal: 2, author: "ann-0004", isMe: false, language: "de", version: "v1", recordedAt: "2026-10-19T00:57:00" };
    expect(submissionLabel(base, { now })).toBe("Annotation · Round 2 · ann-0004 · de v1 · 19 Oct, 00:57");
    expect(submissionLabel({ ...base, kind: "consolidation", author: "lead-0002", recordedAt: "2026-10-18T10:00:00" }, { now })).toBe("Consolidation · lead-0002 · de v1 · 18 Oct, 10:00");
    expect(submissionLabel({ ...base, ordinal: null }, { now, withLanguage: false })).toBe("Annotation · Initial submission · ann-0004 · v1 · 19 Oct, 00:57");
    expect(submissionLabel({ ...base, isMe: true, kind: "review" }, { now })).toBe("Review · Round 2 · ann-0004 (you) · de v1 · 19 Oct, 00:57");
    expect(submissionLabel({ ...base, version: null, recordedAt: "2026-10-18T10:00:00" }, { now, withLanguage: false })).toBe("Annotation · Round 2 · ann-0004 · 18 Oct, 10:00");
  });
  it("kind_labels", () => {
    expect(kindLabels).toEqual({ annotation: "Annotation", review: "Review", consolidation: "Consolidation", carry_forward: "Carry-forward" });
  });
});

it("uses the display name and pseudonym when a person ref carries a display name", () => {
  const ana = { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false };
  expect(personLabel("ann-0004", false, ana)).toBe("Ana Weber (ann-0004)");
  expect(personLabel("ann-0002", true, { pseudonym: "ann-0002", display_name: "Project Lead", is_me: true })).toBe("Project Lead (ann-0002, you)");
  expect(personLabel("ann-0004", false, { pseudonym: "ann-0004", display_name: null, is_me: false })).toBe("ann-0004");
  expect(personLabel("ann-0002", true, { pseudonym: "ann-0002", display_name: null, is_me: true })).toBe("ann-0002 (you)");
  expect(personLabel("ann-0004", false, null)).toBe("ann-0004");
  expect(roundCell({ ordinal: 3, author: "ann-0004", isMe: false, person: ana })).toBe("Round 3 · Ana Weber (ann-0004)");
  expect(roundCell({ ordinal: null, author: "ann-0004", isMe: false, person: ana })).toBe("Initial submission · Ana Weber (ann-0004)");
  expect(roundCell({ ordinal: null, author: "ann-0004", isMe: false, name: "Consolidation" })).toBe("Consolidation (ann-0004)");
  const base = { kind: "annotation" as const, ordinal: 2, author: "ann-0004", isMe: false, language: "de", version: "v1", recordedAt: "2026-10-19T00:57:00" };
  expect(submissionLabel({ ...base, person: ana }, { now })).toBe("Annotation · Round 2 · Ana Weber (ann-0004) · de v1 · 19 Oct, 00:57");
});
