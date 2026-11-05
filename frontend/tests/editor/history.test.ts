import { describe, expect, it } from "vitest";
import type { HistoryStepView } from "../../src/api/client";
import { stepText } from "../../src/editor/history";

const step = (action: string, outcome: string | null = null, term = true): HistoryStepView => ({
  before_revision: 1, after_revision: 2, action, outcome, commands: 1,
  annotation_id: "a1", layer_id: term ? "hpo" : null, term_id: term ? "HP:0001250" : null,
});
const name = (s: HistoryStepView) => stepText(s, () => "Seizure");

describe("stepText (issue 320)", () => {
  it("names a finding by its term", () => {
    expect(name(step("delete_draft_annotation"))).toBe("delete finding Seizure");
    expect(name(step("create_annotation"))).toBe("add finding Seizure");
  });

  it("an Edit & Replace copy is not an added finding", () => {
    expect(name(step("create_annotation", "copy"))).toBe("edit and replace proposal Seizure");
  });

  it("a layer step says whether the layer was checked or unchecked", () => {
    expect(name(step("check_layer", "checked", false))).toBe("mark a layer as checked");
    expect(name(step("check_layer", "unchecked", false))).toBe("mark a layer as not checked");
  });

  it("a carried finding is checked, linked or dismissed", () => {
    expect(name(step("resolve_round_input", "checked"))).toBe("check carried finding Seizure");
    expect(name(step("resolve_round_input", "completed"))).toBe("check carried finding Seizure");
    expect(name(step("resolve_round_input", "linked"))).toBe("link carried finding Seizure");
    expect(name(step("resolve_round_input", "dismissed"))).toBe("dismiss carried finding Seizure");
  });
});
