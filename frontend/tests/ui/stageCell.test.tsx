import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StageCell, type StageTone } from "../../src/ui/StageCell";

afterEach(cleanup);
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/components.css"), "utf8");

it("symbol is aria-hidden and the word carries the meaning", () => {
  const { container } = render(<StageCell symbol="◐" word="In progress" detail="Tom Reis" tone="running" />);
  const cell = container.firstElementChild as HTMLElement;
  const symbol = cell.querySelector(".stage-cell-symbol")!;
  expect(symbol.querySelector("svg circle")).not.toBeNull();
  expect(symbol.getAttribute("aria-hidden")).toBe("true");
  expect(cell.querySelector(".stage-cell-status")?.textContent).toBe(" In progress");
  expect(cell.querySelector(".stage-cell-detail")?.textContent).toBe("Tom Reis");
  const exposed = cell.cloneNode(true) as HTMLElement;
  exposed.querySelectorAll("[aria-hidden=true]").forEach((node) => node.remove());
  expect(exposed.textContent?.trim()).toBe("In progressTom Reis");
});

it("draws ○ ◐ ● as SVG circles of one size and keeps other glyphs as text", () => {
  for (const symbol of ["○", "◐", "●"]) {
    const { container, unmount } = render(<StageCell symbol={symbol} word="x" tone="waiting" />);
    expect(container.querySelector(".stage-cell-symbol svg")?.getAttribute("viewBox")).toBe("0 0 16 16");
    unmount();
  }
  const { container } = render(<StageCell symbol="✓" word="Final" tone="done" />);
  expect(container.querySelector(".stage-cell-symbol")?.textContent).toBe("✓");
  expect(css).toMatch(/\.stage-cell-symbol svg \{[^}]*width: 0\.8em; height: 0\.8em/);
});

it("omits the second line without detail", () => {
  const { container } = render(<StageCell symbol="?" word="not decided" tone="undecided" />);
  expect(container.querySelector(".stage-cell-detail")).toBeNull();
});

it("tone classes per tone", () => {
  const tones: StageTone[] = ["none", "undecided", "waiting", "todo", "running", "decision", "rejected", "done"];
  for (const tone of tones) {
    const { container, unmount } = render(<StageCell symbol="○" word="x" tone={tone} />);
    expect(container.firstElementChild?.className).toBe(`stage-cell stage-cell--${tone}`);
    unmount();
    expect(css).toMatch(new RegExp(`\\.stage-cell--${tone}[^{]*\\{`));
  }
  const { container } = render(<StageCell symbol="✓" word="Final" tone="done" muted />);
  expect(container.firstElementChild?.className).toBe("stage-cell stage-cell--done stage-cell--muted");
});

it("keeps symbols and the decision edge visible in forced colours", () => {
  const forced = [...css.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join("\n");
  expect(forced).toMatch(/\.stage-cell-symbol \{[^}]*CanvasText/);
  expect(forced).toMatch(/\.data-table-row--decision[^{]*\{[^}]*CanvasText/);
});
