import { afterEach, describe, expect, it } from "vitest";
import {
  badgeFor, changeReason, clearVisits, MAX_RETAIN, recordDecision, rememberShown, retainedKeys, rowBadges, snapshotOf, visitStorageKey,
} from "../../src/documents/visitState";
import { final, row, work } from "./fixtures";

const FILTER = JSON.stringify({ decision: "all" });
const OTHER = JSON.stringify({ decision: "missing-final" });

const pausedRow = (overrides: Partial<Parameters<typeof row>[0]> = {}) => row({
  case_id: "case-1", language: "en", categories: ["report-or-pause"],
  work: [work({ assignment_id: 7, document_id: "case-1-en", held: true })], ...overrides,
});

afterEach(() => sessionStorage.clear());

describe("visit state", () => {
  it("stores a snapshot of each matching row under the project and filter and returns the keys to retain", () => {
    rememberShown("p", FILTER, [pausedRow(), row({ case_id: "case-2", language: "de", matches_decision: false })]);
    expect(retainedKeys("p", FILTER)).toEqual(["case-1:en"]);
    expect(retainedKeys("p", OTHER)).toEqual([]);
    expect(retainedKeys("q", FILTER)).toEqual([]);
    const stored = JSON.parse(sessionStorage.getItem(`ontocurator:documents-visit:p:${FILTER}`)!);
    expect(stored.shown["case-1:en"]).toEqual({ categories: ["report-or-pause"], work: [{ assignment_id: 7, held: true }], final: null, reports: [] });
    expect(visitStorageKey("p", FILTER)).toBe(`ontocurator:documents-visit:p:${FILTER}`);
  });

  it("keeps the snapshot from when a row last matched", () => {
    rememberShown("p", FILTER, [pausedRow()]);
    rememberShown("p", FILTER, [pausedRow({ matches_decision: false, retained: true, categories: [], work: [work({ assignment_id: 7, document_id: "case-1-en" })] })]);
    const badges = rowBadges("p", FILTER, [pausedRow({ matches_decision: false, retained: true, categories: [], work: [work({ assignment_id: 7, document_id: "case-1-en" })] })]);
    expect(badges.get("case-1:en")).toEqual({ tone: "neutral", text: "Changed: Task resumed" });
  });

  it("caps the retained keys at the server limit", () => {
    rememberShown("p", FILTER, Array.from({ length: MAX_RETAIN + 5 }, (_, index) => row({ case_id: `c${index}`, language: "en", categories: ["missing-final"] })));
    expect(retainedKeys("p", FILTER)).toHaveLength(MAX_RETAIN);
  });

  it("shows Resolved only after a recorded decision on that row, in every visit of the project", () => {
    rememberShown("p", FILTER, [pausedRow()]);
    rememberShown("p", OTHER, [pausedRow()]);
    const resumed = pausedRow({ matches_decision: false, retained: true, categories: [], work: [work({ assignment_id: 7, document_id: "case-1-en" })] });
    expect(rowBadges("p", FILTER, [resumed]).get("case-1:en")?.text).toBe("Changed: Task resumed");
    recordDecision("p", "case-1:en");
    recordDecision("p", "unknown:en");
    expect(rowBadges("p", FILTER, [resumed]).get("case-1:en")).toEqual({ tone: "success", text: "Resolved" });
    expect(rowBadges("p", OTHER, [resumed]).get("case-1:en")).toEqual({ tone: "success", text: "Resolved" });
  });

  it("forgets a decision when the row matches again", () => {
    rememberShown("p", FILTER, [pausedRow()]);
    recordDecision("p", "case-1:en");
    rememberShown("p", FILTER, [pausedRow()]);
    const changed = pausedRow({ matches_decision: false, categories: [], work: [work({ assignment_id: 7, document_id: "case-1-en" })] });
    expect(rowBadges("p", FILTER, [changed]).get("case-1:en")?.text).toBe("Changed: Task resumed");
  });

  it("gives no badge to matching or never-remembered rows", () => {
    rememberShown("p", FILTER, [pausedRow()]);
    expect(rowBadges("p", FILTER, [pausedRow(), row({ case_id: "x", language: "en", matches_decision: false })]).size).toBe(0);
  });

  it("names the change reasons of open question 8", () => {
    const missing = row({ case_id: "c", language: "en", categories: ["missing-final"], work: [work({ assignment_id: 1, document_id: "c-en", held: false })] });
    const snapshot = snapshotOf(missing);
    expect(changeReason(snapshot, { ...missing, work: [...missing.work, work({ assignment_id: 2, document_id: "c-en" })], missing_final: { counts: false, reason: "work_open" } })).toBe("Work assigned");
    expect(changeReason(snapshot, { ...missing, work: [work({ assignment_id: 1, document_id: "c-en", held: true })] })).toBe("Task paused");
    expect(changeReason(snapshotOf({ ...missing, work: [work({ assignment_id: 1, document_id: "c-en", held: true })] }), missing)).toBe("Task resumed");
    expect(changeReason(snapshot, { ...missing, final: final({ case_id: "c", language: "en", document_id: "c-en", submission_id: "s1" }) })).toBe("Final result changed");
    expect(changeReason(snapshot, { ...missing, work: [] })).toBe("Updated elsewhere");
    expect(badgeFor(snapshot, missing, false)).toEqual({ tone: "neutral", text: "Changed: Updated elsewhere" });
    expect(badgeFor(snapshot, missing, true)).toEqual({ tone: "success", text: "Resolved" });
  });

  it("clears other filters of the project on a filter change and everything on reload", () => {
    rememberShown("p", FILTER, [pausedRow()]);
    rememberShown("p", OTHER, [pausedRow()]);
    rememberShown("q", FILTER, [pausedRow()]);
    clearVisits("p", OTHER);
    expect(retainedKeys("p", FILTER)).toEqual([]);
    expect(retainedKeys("p", OTHER)).toEqual(["case-1:en"]);
    expect(retainedKeys("q", FILTER)).toEqual(["case-1:en"]);
    sessionStorage.setItem("unrelated", "1");
    window.dispatchEvent(new Event("beforeunload"));
    expect(retainedKeys("p", OTHER)).toEqual([]);
    expect(retainedKeys("q", FILTER)).toEqual([]);
    expect(sessionStorage.getItem("unrelated")).toBe("1");
  });

  it("starts over on unreadable state", () => {
    sessionStorage.setItem(visitStorageKey("p", FILTER), "{not json");
    expect(retainedKeys("p", FILTER)).toEqual([]);
    rememberShown("p", FILTER, [pausedRow()]);
    expect(retainedKeys("p", FILTER)).toEqual(["case-1:en"]);
  });
});
