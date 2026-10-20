// @vitest-environment node
import { describe, expect, it } from "vitest";
import { caseRange, memberReason, needsPeopleMessage, onePersonSummary, partlyAssignedLines, resultMessage, skippedLines, splitSummary, stepLabel } from "../src/admin/assignSummary";

const ana = { pseudonym: "ann-0004", display_name: "Ana Weber" };
const ben = { pseudonym: "ann-0007", display_name: "Ben Roth" };

describe("assign summary", () => {
  it("summarises one person", () => {
    expect(onePersonSummary({ person: ana, gets: 20, task: "translation_review", language: "de", openBefore: 3, openAfter: 23 }))
      .toBe("Ana Weber gets 20 translation reviews (de). Open tasks: 3 → 23.");
    expect(onePersonSummary({ person: { pseudonym: "ann-0004" }, gets: 1, task: "annotate", language: "fr", openBefore: 0, openAfter: 1 }))
      .toBe("ann-0004 gets 1 annotation (fr). Open tasks: 0 → 1.");
  });

  it("summarises split blocks in list order", () => {
    expect(splitSummary([
      { person: ana, first_case: "case-0101", last_case: "case-0110", gets: 10 },
      { person: ben, first_case: "case-0111", last_case: "case-0120", gets: 10 },
      { person: { pseudonym: "ann-0009", display_name: "Clara Diaz" }, first_case: null, last_case: null, gets: 0 },
    ])).toBe("Cases in list order: case-0101…0110 → Ana, case-0111…0120 → Ben.");
    expect(caseRange("case-0101", "case-0101")).toBe("case-0101");
    expect(caseRange("alpha", "beta")).toBe("alpha…beta");
    // Two people with the same first name keep their full label.
    expect(splitSummary([
      { person: ana, first_case: "c1", last_case: "c1", gets: 1 },
      { person: { pseudonym: "ann-0010", display_name: "Ana Roth" }, first_case: "c2", last_case: "c2", gets: 1 },
    ])).toBe("Cases in list order: c1 → Ana Weber, c2 → Ana Roth.");
  });

  it("states skipped cases", () => {
    const skipped = [
      ...Array.from({ length: 6 }, (_, index) => ({ case_id: `w${index}`, language: "de", reason: "waiting_for_review" as const })),
      ...Array.from({ length: 4 }, (_, index) => ({ case_id: `n${index}`, language: "de", reason: "not_in_plan" as const })),
      { case_id: "a", language: "de", reason: "already_assigned" as const },
    ];
    expect(skippedLines(skipped, "de")).toEqual([
      "6 still in translation review: waiting for review, they join the next batch",
      "4 not in plan for de",
      "1 already assigned",
    ]);
  });

  it("asks for enough people for n annotations", () => {
    expect(needsPeopleMessage(2, "annotate")).toBe("Choose at least 2 annotators for 2 annotations per text.");
    expect(needsPeopleMessage(2, "review")).toBe("Choose at least 2 reviewers for 2 reviews per text.");
  });

  it("labels steps, reasons, partial targets and results", () => {
    expect(stepLabel("translation_review", "de", 20)).toBe("Translation review · de · 20 versions");
    expect(stepLabel("annotate", "fr", 1)).toBe("Annotation · fr · 1 version");
    expect(memberReason({ unavailable: "does_not_read", already_assigned: 0, reads: ["en"] }, "annotate", "de")).toBe("does not read de");
    expect(memberReason({ unavailable: "does_not_read", already_assigned: 0, reads: ["de"] }, "translation_review", "de")).toBe("does not read the source language");
    expect(memberReason({ unavailable: "role_missing", already_assigned: 0, reads: ["de"] }, "annotate", "de")).toBe("Not an annotator in this project");
    expect(memberReason({ unavailable: "role_missing", already_assigned: 0, reads: ["de"] }, "review", "de")).toBe("Not an adjudicator in this project");
    expect(memberReason({ unavailable: null, already_assigned: 3, reads: ["de"] }, "annotate", "de")).toBe("Already annotating 3 of these cases");
    expect(memberReason({ unavailable: null, already_assigned: 0, reads: ["de"] }, "annotate", "de")).toBeNull();
    expect(partlyAssignedLines([{ case_id: "case-0101", language: "de", remaining: 1 }, { case_id: "case-0102", language: "de", remaining: 2 }], 2)).toEqual(["case-0101 · de: 1 of 2 assigned"]);
    expect(resultMessage("translation_review", 20, [{ person: ana, count: 20 }], true)).toBe("20 translation reviews assigned to Ana Weber");
    expect(resultMessage("translation_review", 20, [{ person: ana, count: 10 }, { person: ben, count: 10 }], true)).toBe("20 translation reviews split between Ana Weber (10) and Ben Roth (10)");
    expect(resultMessage("annotate", 2, [{ person: ana, count: 1 }, { person: ben, count: 1 }], false)).toBe("2 annotations assigned to Ana Weber and Ben Roth");
  });
});
