import { describe, expect, it } from "vitest";
import { chooseValuesLayout, VALUES_HYSTERESIS_PX } from "../src/editor/valuesLayout";

const widths = { row: 244, stacked: 348 };

describe("chooseValuesLayout", () => {
  it("chooses row when every control fits the control cell", () => {
    expect(chooseValuesLayout([200, 244, 120], widths, null)).toBe("row");
  });

  it("chooses stacked when a control fits only the full width", () => {
    expect(chooseValuesLayout([200, 250, 120], widths, null)).toBe("stacked");
    expect(chooseValuesLayout([348], widths, "row")).toBe("stacked");
  });

  it("chooses boxes when a control does not fit the full width", () => {
    expect(chooseValuesLayout([200, 349], widths, null)).toBe("boxes");
  });

  it("returns from stacked to row only with 8 px to spare", () => {
    expect(VALUES_HYSTERESIS_PX).toBe(8);
    expect(chooseValuesLayout([240], widths, "stacked")).toBe("stacked");
    expect(chooseValuesLayout([237], widths, "stacked")).toBe("stacked");
    expect(chooseValuesLayout([236], widths, "stacked")).toBe("row");
  });

  it("returns from boxes to stacked only with 8 px to spare", () => {
    expect(chooseValuesLayout([345], widths, "boxes")).toBe("boxes");
    expect(chooseValuesLayout([340], widths, "boxes")).toBe("stacked");
    expect(chooseValuesLayout([236], widths, "boxes")).toBe("row");
  });

  it("drops to a worse layout at once without hysteresis", () => {
    expect(chooseValuesLayout([245], widths, "row")).toBe("stacked");
    expect(chooseValuesLayout([349], widths, "stacked")).toBe("boxes");
    expect(chooseValuesLayout([244], widths, "row")).toBe("row");
    expect(chooseValuesLayout([348], widths, "stacked")).toBe("stacked");
  });

  it("ignores axes rendered as a Select", () => {
    expect(chooseValuesLayout([], widths, null)).toBe("row");
    expect(chooseValuesLayout([], { row: 0, stacked: 0 }, "boxes")).toBe("row");
  });
});
