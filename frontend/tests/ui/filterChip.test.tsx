import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FilterChip } from "../../src/ui/FilterChip";

afterEach(cleanup);

it("button named Remove filter Language: de", () => {
  const onRemove = vi.fn();
  render(<FilterChip label="Language: de" onRemove={onRemove} />);
  const chip = screen.getByRole("button", { name: "Remove filter Language: de" });
  expect(chip.getAttribute("type")).toBe("button");
  expect(chip.className).toBe("ui-filter-chip");
  expect(chip.textContent).toBe("Language: de");
  expect(chip.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(chip);
  expect(onRemove).toHaveBeenCalledOnce();
});
