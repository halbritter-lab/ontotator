import { describe, expect, it } from "vitest";
import {
  emptyTree,
  keyAction,
  keysAlong,
  parentKeyOf,
  pathKey,
  termOfKey,
  visibleRows,
  withLevels,
  withRoots,
} from "../src/editor/treeState";

const node = (term_id: string, label: string, child_count = 0) => ({ term_id, label, child_count });

// Root > (Alpha > Shared, Beta > Shared): "Shared" sits under two parents.
// Beta's children are not loaded yet.
const sample = () =>
  withLevels(withRoots(emptyTree(), [node("R", "Root", 2)]), [
    { term_id: "R", children: [node("A", "Alpha", 1), node("B", "Beta", 1)] },
    { term_id: "A", children: [node("X", "Shared")] },
  ]);

const keys = (data: ReturnType<typeof sample>, expanded: string[]) =>
  visibleRows(data, new Set(expanded)).map((row) => row.key);

describe("tree keys", () => {
  it("a key is the path of term ids from the root", () => {
    expect(pathKey(["R", "A", "X"])).toBe("R/A/X");
    expect(termOfKey("R/A/X")).toBe("X");
    expect(termOfKey("R")).toBe("R");
    expect(parentKeyOf("R/A/X")).toBe("R/A");
    expect(parentKeyOf("R")).toBeNull();
    expect(keysAlong(["R", "A", "X"])).toEqual(["R", "R/A", "R/A/X"]);
    expect(keysAlong([])).toEqual([]);
  });
});

describe("visibleRows", () => {
  it("shows only the roots while nothing is expanded", () => {
    expect(visibleRows(sample(), new Set())).toEqual([
      { key: "R", termId: "R", label: "Root", depth: 1, parentKey: null, childCount: 2, expanded: false, posInSet: 1, setSize: 1 },
    ]);
  });

  it("lists expanded branches depth-first with level and position", () => {
    const rows = visibleRows(sample(), new Set(["R", "R/A"]));

    expect(rows.map((row) => row.key)).toEqual(["R", "R/A", "R/A/X", "R/B"]);
    expect(rows.map((row) => row.depth)).toEqual([1, 2, 3, 2]);
    expect(rows.map((row) => row.parentKey)).toEqual([null, "R", "R/A", "R"]);
    expect(rows.map((row) => [row.posInSet, row.setSize])).toEqual([[1, 1], [1, 2], [1, 1], [2, 2]]);
    expect(rows.map((row) => row.expanded)).toEqual([true, true, false, false]);
  });

  it("gives a term with two parents one row per place, expanded independently", () => {
    const data = withLevels(sample(), [{ term_id: "B", children: [node("X", "Shared")] }]);

    expect(keys(data, ["R", "R/A"])).toEqual(["R", "R/A", "R/A/X", "R/B"]);
    expect(keys(data, ["R", "R/A", "R/B"])).toEqual(["R", "R/A", "R/A/X", "R/B", "R/B/X"]);
    const shared = visibleRows(data, new Set(["R", "R/A", "R/B"])).filter((row) => row.termId === "X");
    expect(shared.map((row) => row.parentKey)).toEqual(["R/A", "R/B"]);
  });

  it("does not show a branch as open before its children are loaded", () => {
    const rows = visibleRows(sample(), new Set(["R", "R/B"]));

    expect(rows.map((row) => row.key)).toEqual(["R", "R/A", "R/B"]);
    expect(rows.find((row) => row.key === "R/B")?.expanded).toBe(false);
  });

  it("never shows a leaf as open", () => {
    const rows = visibleRows(sample(), new Set(["R", "R/A", "R/A/X"]));

    expect(rows.find((row) => row.key === "R/A/X")?.expanded).toBe(false);
  });

  it("replaces the roots and keeps loaded children when levels arrive later", () => {
    const data = withLevels(sample(), [{ term_id: "B", children: [node("Y", "Yonder")] }]);

    expect(data.roots).toEqual(["R"]);
    expect(data.children.A).toEqual(["X"]);
    expect(data.children.B).toEqual(["Y"]);
    expect(data.nodes.Y.label).toBe("Yonder");
  });
});

describe("keyAction", () => {
  const rows = visibleRows(sample(), new Set(["R", "R/A"])); // R, R/A, R/A/X, R/B

  it("moves up and down through the visible rows and stops at the ends", () => {
    expect(keyAction(rows, "R/A", "ArrowDown")).toEqual({ type: "focus", key: "R/A/X" });
    expect(keyAction(rows, "R/A/X", "ArrowUp")).toEqual({ type: "focus", key: "R/A" });
    expect(keyAction(rows, "R/B", "ArrowDown")).toBeNull();
    expect(keyAction(rows, "R", "ArrowUp")).toBeNull();
    expect(keyAction(rows, "R/A/X", "Home")).toEqual({ type: "focus", key: "R" });
    expect(keyAction(rows, "R", "End")).toEqual({ type: "focus", key: "R/B" });
  });

  it("right opens a closed branch, then goes to its first child; nothing on a leaf", () => {
    expect(keyAction(rows, "R/B", "ArrowRight")).toEqual({ type: "expand", key: "R/B" });
    expect(keyAction(rows, "R/A", "ArrowRight")).toEqual({ type: "focus", key: "R/A/X" });
    expect(keyAction(rows, "R/A/X", "ArrowRight")).toBeNull();
  });

  it("left closes an open branch, otherwise goes to the parent", () => {
    expect(keyAction(rows, "R/A", "ArrowLeft")).toEqual({ type: "collapse", key: "R/A" });
    expect(keyAction(rows, "R/A/X", "ArrowLeft")).toEqual({ type: "focus", key: "R/A" });
    expect(keyAction(rows, "R/B", "ArrowLeft")).toEqual({ type: "focus", key: "R" });
    expect(keyAction(visibleRows(sample(), new Set()), "R", "ArrowLeft")).toBeNull();
  });

  it("Enter and Space select, Escape closes, other keys are not the tree's", () => {
    expect(keyAction(rows, "R/A/X", "Enter")).toEqual({ type: "select", key: "R/A/X" });
    expect(keyAction(rows, "R/A/X", " ")).toEqual({ type: "select", key: "R/A/X" });
    expect(keyAction(rows, "R/A", "Escape")).toEqual({ type: "close" });
    expect(keyAction([], null, "Escape")).toEqual({ type: "close" });
    expect(keyAction(rows, "R/A", "j")).toBeNull();
    expect(keyAction(rows, "R/A", "Tab")).toBeNull();
  });

  it("starts at the first row when no row has the focus", () => {
    expect(keyAction(rows, null, "ArrowDown")).toEqual({ type: "focus", key: "R" });
    expect(keyAction(rows, "gone", "ArrowUp")).toEqual({ type: "focus", key: "R" });
    expect(keyAction(rows, null, "Enter")).toBeNull();
    expect(keyAction([], null, "ArrowDown")).toBeNull();
  });
});
