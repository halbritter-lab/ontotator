import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TermTree } from "../src/editor/TermTree";
import { emptyTree, visibleRows, withLevels, withRoots } from "../src/editor/treeState";

const node = (term_id: string, label: string, child_count = 0) => ({
  term_id,
  label,
  child_count,
  role: "finding" as const,
  external_url: `https://terms.example/${term_id}`,
});

// Root > (Alpha > Shared, Beta > Yonder), everything loaded. Yonder has no known page.
const data = withLevels(withRoots(emptyTree(), [node("R", "Root", 2)]), [
  { term_id: "R", children: [node("A", "Alpha", 1), node("B", "Beta", 1)] },
  { term_id: "A", children: [node("X", "Shared")] },
  { term_id: "B", children: [{ ...node("Y", "Yonder"), external_url: null }] },
]);

interface HarnessProps {
  onSelect?: (key: string) => void;
  onClose?: () => void;
  current?: string | null;
  reveal?: { key: string; focus: boolean } | null;
}

/** The tree with the state its parent would keep. Starts with Root and Alpha open, Alpha selected. */
const Harness = ({ onSelect, onClose, current = null, reveal = null }: HarnessProps) => {
  const [expanded, setExpanded] = useState(() => new Set(["R", "R/A"]));
  const [focused, setFocused] = useState<string | null>("R/A");
  const [selected, setSelected] = useState<string | null>("R/A");
  return (
    <TermTree
      rows={visibleRows(data, expanded)}
      focusedKey={focused}
      selectedKey={selected}
      currentTermId={current}
      loadingKeys={new Set()}
      reveal={reveal}
      label="Terms"
      onFocusKey={setFocused}
      onExpand={(key) => setExpanded((now) => new Set(now).add(key))}
      onCollapse={(key) =>
        setExpanded((now) => {
          const next = new Set(now);
          next.delete(key);
          return next;
        })
      }
      onSelect={(key) => {
        setSelected(key);
        onSelect?.(key);
      }}
      onClose={() => onClose?.()}
    />
  );
};

const item = (label: string) =>
  screen.getByText(label, { selector: ".tree-label" }).closest('[role="treeitem"]') as HTMLElement;
const labels = () => screen.getAllByRole("treeitem").map((el) => el.querySelector(".tree-label")?.textContent);

const originalScroll = (Element.prototype as any).scrollIntoView;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  (Element.prototype as any).scrollIntoView = originalScroll;
});

describe("TermTree", () => {
  it("Enter on a mouse-focused external link keeps native navigation and does not select", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const link = item("Beta").querySelector<HTMLAnchorElement>("a.tree-external")!;
    act(() => link.focus());
    expect(document.activeElement).toBe(link);
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(item("Beta").getAttribute("aria-selected")).toBe("false");
  });


  it("shows each row's term id and links to the term's page in a new tab", () => {
    render(<Harness />);

    const alpha = item("Alpha");
    expect(alpha.querySelector(".tree-id")?.textContent).toBe("A");
    const link = alpha.querySelector<HTMLAnchorElement>("a.tree-external")!;
    expect(link.getAttribute("href")).toBe("https://terms.example/A");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("aria-label")).toBe("View A on terms.example");
    // Not a stop of its own in the Tab order: the tree keeps one roving tab stop.
    expect(link.getAttribute("tabindex")).toBe("-1");
  });

  it("names each row by its label only, not by its id or link", () => {
    render(<Harness />);
    expect(screen.getByRole("treeitem", { name: "Alpha" })).toBe(item("Alpha"));
  });

  it("following the link neither selects nor opens the row", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    fireEvent.click(item("Beta").querySelector("a.tree-external")!);

    expect(onSelect).not.toHaveBeenCalled();
    expect(item("Beta").getAttribute("aria-selected")).toBe("false");
    expect(item("Beta").getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter on a row still selects it; the link does not take over the key", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.keyDown(item("Alpha"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("R/A");
  });

  it("shows the id without a link where no page is known", () => {
    render(<Harness />);
    fireEvent.click(item("Beta").querySelector(".tree-toggle")!);

    expect(item("Yonder").querySelector(".tree-id")?.textContent).toBe("Y");
    expect(item("Yonder").querySelector("a.tree-external")).toBeNull();
  });

  it("is an ARIA tree whose rows carry level, position, state and child count", () => {
    render(<Harness />);

    expect(screen.getByRole("tree", { name: "Terms" })).toBeDefined();
    expect(labels()).toEqual(["Root", "Alpha", "Shared", "Beta"]);

    const alpha = item("Alpha");
    expect(alpha.getAttribute("aria-level")).toBe("2");
    expect(alpha.getAttribute("aria-posinset")).toBe("1");
    expect(alpha.getAttribute("aria-setsize")).toBe("2");
    expect(alpha.getAttribute("aria-expanded")).toBe("true");
    expect(alpha.getAttribute("aria-selected")).toBe("true");
    expect(alpha.dataset.key).toBe("R/A");
    expect(alpha.querySelector(".tree-count")?.textContent).toBe("1");
    expect(item("Beta").getAttribute("aria-expanded")).toBe("false");
    expect(item("Beta").getAttribute("aria-selected")).toBe("false");

    // A leaf has no triangle, no count and no expanded state.
    const leaf = item("Shared");
    expect(leaf.hasAttribute("aria-expanded")).toBe(false);
    expect(leaf.querySelector(".tree-count")).toBeNull();
    expect(leaf.querySelector(".tree-toggle")?.textContent).toBe("");
    expect(alpha.querySelector(".tree-toggle")?.textContent).toBe("▾");
    expect(item("Beta").querySelector(".tree-toggle")?.textContent).toBe("▸");
  });

  it("keeps exactly one row in the Tab order and moves it with the focus", () => {
    render(<Harness />);
    const tabStops = () => screen.getAllByRole("treeitem").filter((el) => el.getAttribute("tabindex") === "0");

    expect(tabStops()).toEqual([item("Alpha")]);

    item("Alpha").focus();
    fireEvent.keyDown(item("Alpha"), { key: "ArrowDown" });

    expect(document.activeElement).toBe(item("Shared"));
    expect(tabStops()).toEqual([item("Shared")]);
    // Moving the focus selected nothing.
    expect(item("Alpha").getAttribute("aria-selected")).toBe("true");
    expect(item("Shared").getAttribute("aria-selected")).toBe("false");
  });

  it("opens, closes and walks branches with the arrow keys", () => {
    render(<Harness />);
    item("Alpha").focus();

    fireEvent.keyDown(item("Alpha"), { key: "ArrowLeft" });
    expect(labels()).toEqual(["Root", "Alpha", "Beta"]);
    expect(item("Alpha").getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(item("Alpha"), { key: "ArrowRight" });
    expect(labels()).toEqual(["Root", "Alpha", "Shared", "Beta"]);
    expect(document.activeElement).toBe(item("Alpha"));

    fireEvent.keyDown(item("Alpha"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(item("Shared"));

    fireEvent.keyDown(item("Shared"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("Alpha"));

    fireEvent.keyDown(item("Alpha"), { key: "End" });
    expect(document.activeElement).toBe(item("Beta"));
    fireEvent.keyDown(item("Beta"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("Shared"));
    fireEvent.keyDown(item("Shared"), { key: "Home" });
    expect(document.activeElement).toBe(item("Root"));
  });

  it("selects with Enter or a click, and a click on the triangle only opens", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    item("Alpha").focus();
    fireEvent.keyDown(item("Alpha"), { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(item("Shared"), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("R/A/X");
    expect(item("Shared").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(item("Beta").querySelector(".tree-toggle") as HTMLElement);
    expect(labels()).toEqual(["Root", "Alpha", "Shared", "Beta", "Yonder"]);
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(item("Yonder"));
    expect(onSelect).toHaveBeenLastCalledWith("R/B/Y");
    expect(item("Yonder").getAttribute("aria-selected")).toBe("true");
    expect(item("Shared").getAttribute("aria-selected")).toBe("false");
  });

  it("handles its keys itself: Escape closes and reaches no handler further up", () => {
    const onClose = vi.fn();
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    try {
      render(<Harness onClose={onClose} />);

      fireEvent.keyDown(item("Alpha"), { key: "Escape" });
      fireEvent.keyDown(item("Alpha"), { key: "ArrowDown" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(outside).not.toHaveBeenCalled();

      // A key the tree does not use passes through, and so does a shortcut with a modifier.
      fireEvent.keyDown(item("Alpha"), { key: "j" });
      fireEvent.keyDown(item("Alpha"), { key: "ArrowRight", altKey: true });
      expect(outside).toHaveBeenCalledTimes(2);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", outside);
    }
  });

  it("marks the term the annotation carries", () => {
    render(<Harness current="X" />);

    expect(item("Shared").getAttribute("aria-current")).toBe("true");
    expect(item("Shared").querySelector(".tree-current")?.textContent).toBe("current");
    expect(item("Alpha").hasAttribute("aria-current")).toBe(false);
    expect(item("Alpha").querySelector(".tree-current")).toBeNull();
  });

  // jsdom lays nothing out: this sees that the row is asked into view, and with "nearest"
  // (scroll only as far as needed, so a tree that fits stays at its top), not where it
  // ends up. That is asserted in a real browser, in browser/tree.spec.ts.
  it("asks the revealed row into view, no further than needed, and focuses it only when asked", () => {
    const scrolled: Array<[string | undefined, unknown]> = [];
    (Element.prototype as any).scrollIntoView = function (this: HTMLElement, options: unknown) {
      scrolled.push([this.dataset.key, options]);
    };

    const first = render(<Harness reveal={{ key: "R/A/X", focus: false }} />);
    expect(scrolled).toEqual([["R/A/X", { block: "nearest" }]]);
    expect(document.activeElement).not.toBe(item("Shared"));
    first.unmount();

    render(<Harness reveal={{ key: "R/A/X", focus: true }} />);
    expect(scrolled).toEqual([
      ["R/A/X", { block: "nearest" }],
      ["R/A/X", { block: "nearest" }],
    ]);
    expect(document.activeElement).toBe(item("Shared"));
  });
});
