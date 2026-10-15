import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { IconButton } from "../../src/ui/IconButton";

it("label_is_the_accessible_name_and_title", () => {
  render(<IconButton label="Download results" icon={<svg />} />);
  expect(screen.getByRole("button", { name: "Download results" }).getAttribute("title")).toBe("Download results");
});

it("icon_is_hidden_from_assistive_tech", () => {
  render(<IconButton label="Download results" icon={<svg role="img" aria-label="Arrow" />} />);
  expect(screen.queryByRole("img")).toBeNull();
});
it("caller_title_can_describe_a_shortcut_without_changing_the_accessible_name", () => {
  render(<IconButton label="Keyboard shortcuts" title="Keyboard shortcuts (?)" icon={<svg />} />);
  expect(screen.getByRole("button", { name: "Keyboard shortcuts" }).getAttribute("title")).toBe("Keyboard shortcuts (?)");
});
