import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { EmptyValue } from "../src/ui";

it("shows a dash that screen readers read as not set", () => {
  const { container } = render(<EmptyValue />);
  expect(container.textContent).toBe("—not set");
  expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("—");
  expect(container.querySelector(".visually-hidden")?.textContent).toBe("not set");
});
