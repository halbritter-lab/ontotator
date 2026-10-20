import { afterEach, describe, expect, it, vi } from "vitest";
import { focusTextAt } from "../src/editor/textFocus";

describe("focusTextAt", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

  it("focuses the text container without scrolling and puts the caret at a codepoint offset", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="text-container" tabindex="0"><span class="run">😀 ab</span><span class="run">cd</span></div>';
    document.body.appendChild(root);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    expect(focusTextAt(root, "😀 abcd", 4)).toBe(true);
    const container = root.querySelector(".text-container")!;
    expect(document.activeElement).toBe(container);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    const selection = window.getSelection()!;
    expect(selection.isCollapsed).toBe(true);
    expect(selection.anchorNode).toBe(root.querySelector(".run")!.firstChild);
    expect(selection.anchorOffset).toBe(5);
  });

  it("returns false without a text container", () => {
    expect(focusTextAt(document.createElement("div"), "abc", 1)).toBe(false);
    expect(focusTextAt(null, "abc", 1)).toBe(false);
  });
});
