import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AxisValue } from "../../src/ui/AxisValue";

afterEach(cleanup);
const show = (value: string | null | undefined) => render(<AxisValue value={value} />).container.firstElementChild as HTMLElement;

it("renders the word for every known value", () => {
  expect(show("present").textContent).toBe("Present");
  cleanup();
  expect(show("family_member").textContent).toBe("Family member");
});

it("uses the fixed slot class", () => {
  expect(show("absent").className).toBe("axis-value axis-value--absent");
});

it("unknown values are neutral and keep their words", () => {
  const element = show("clinically_suspected_only");
  expect(element.className).toBe("axis-value axis-value--neutral");
  expect(element.textContent).toBe("Clinically suspected only");
  cleanup();
  // Inherited object keys are not slots.
  expect(show("constructor").className).toBe("axis-value axis-value--neutral");
});

it("empty value reads Not specified", () => {
  expect(show(null).textContent).toBe("Not specified");
  cleanup();
  expect(show("").className).toBe("axis-value axis-value--neutral");
});
