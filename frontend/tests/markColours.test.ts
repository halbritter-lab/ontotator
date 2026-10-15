// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MARK_COLOUR_MEANING,
  MARK_PALETTE_SIZE,
  hashSlot,
  markColourSlot,
} from "../src/editor/markColours";

describe("mark colour meanings", () => {
  it("colours_marks_by_term_by_default", () => {
    expect(MARK_COLOUR_MEANING).toBe("term");
    const a = markColourSlot({ termId: "HP:0001250", layerId: "phenotype", kind: "own" });
    const b = markColourSlot({ termId: "HP:0001250", layerId: "diseases", kind: "source" });
    expect(a).toBe(b);
    expect(a).toBe(hashSlot("HP:0001250"));
  });

  it("another_meaning_is_a_change_of_one_argument", () => {
    const byLayer = (termId: string) => markColourSlot({ termId, layerId: "phenotype" }, "layer");
    expect(byLayer("HP:0001250")).toBe(byLayer("HP:0001252"));
    expect(markColourSlot({ termId: "HP:0001250", kind: "own" }, "kind")).not.toBe(
      markColourSlot({ termId: "HP:0001250", kind: "target" }, "kind"),
    );
  });

  it("slots_stay_inside_the_palette", () => {
    for (const key of ["", "HP:0000001", "MONDO:0001250", "x".repeat(200), "Ünïcødé"]) {
      const slot = hashSlot(key);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(MARK_PALETTE_SIZE);
    }
  });
});
