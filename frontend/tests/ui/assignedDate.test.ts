import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
import { assignedText, assignedTitle } from "../../src/app/assignedDate";
import { AssignedDate } from "../../src/ui/AssignedDate";

afterEach(cleanup);
// Local dates, so the tests do not depend on the machine's time zone.
const NOW = new Date(2026, 9, 23, 18, 5); // Fri 23 Oct 2026

it("today shows the time", () => {
  expect(assignedText(new Date(2026, 9, 23, 10, 40), NOW)).toBe("assigned today 10:40");
});

it("yesterday", () => {
  expect(assignedText(new Date(2026, 9, 22, 23, 59), NOW)).toBe("assigned yesterday");
});

it("within a week shows the weekday", () => {
  expect(assignedText(new Date(2026, 9, 19, 9, 0), new Date(2026, 9, 22, 8, 0))).toBe("assigned Mon");
});

it("older shows day and month", () => {
  expect(assignedText(new Date(2026, 9, 14, 9, 0), NOW)).toBe("assigned 14 Oct");
});

it("title with and without by", () => {
  const at = new Date(2026, 9, 21, 16, 44);
  expect(assignedTitle(at, "Project lead")).toBe("Assigned 21 Oct 2026, 16:44 by Project lead");
  expect(assignedTitle(at, null)).toBe("Assigned 21 Oct 2026, 16:44");
});

it("AssignedDate renders a time element, nothing without a date", () => {
  const at = new Date(2026, 9, 23, 10, 40).toISOString();
  const time = render(createElement(AssignedDate, { at, by: "Lead", now: NOW })).container.querySelector("time");
  expect(time?.textContent).toBe("assigned today 10:40");
  expect(time?.getAttribute("dateTime")).toBe(at);
  expect(time?.getAttribute("title")).toBe("Assigned 23 Oct 2026, 10:40 by Lead");
  cleanup();
  expect(render(createElement(AssignedDate, { at: null })).container.innerHTML).toBe("");
});
