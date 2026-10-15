import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { formatKey, Kbd } from "../../src/ui/Kbd";

it("formats_arrow_and_escape_keys", () => {
  expect(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape", "Alt", "K"].map(formatKey)).toEqual(["←", "→", "↑", "↓", "Esc", "Alt", "K"]);
  render(<Kbd>{formatKey("ArrowLeft")}</Kbd>);
  expect(screen.getByText("←").tagName).toBe("KBD");
});
