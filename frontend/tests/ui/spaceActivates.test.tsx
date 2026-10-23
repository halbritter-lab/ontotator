import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { onSpaceActivate } from "../../src/ui/spaceActivates";

afterEach(cleanup);

it("Space clicks the link once; a held Space (key repeat) does not click again", () => {
  const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  render(<a href="#x" className="btn" onKeyDown={onSpaceActivate} onClick={onClick}>Go</a>);
  const link = screen.getByRole("link", { name: "Go" });
  fireEvent.keyDown(link, { key: " " });
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(fireEvent.keyDown(link, { key: " ", repeat: true })).toBe(false);
  expect(onClick).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(link, { key: "Enter" });
  expect(onClick).toHaveBeenCalledTimes(1);
});
