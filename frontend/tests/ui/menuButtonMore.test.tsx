import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { IconMore } from "../../src/ui/icons";
import { MenuButton } from "../../src/ui/MenuButton";

afterEach(cleanup);

it("shows More with the icon and keeps the accessible name", () => {
  render(<MenuButton label="More actions, case-1 de" buttonLabel="More" icon={<IconMore />}
    items={[{ id: "a", label: "Remove…", onSelect: () => {} }]} />);
  const button = screen.getByRole("button", { name: "More actions, case-1 de" });
  expect(button.textContent).toBe("More");
  expect(button.querySelector("svg")).not.toBeNull();
});
