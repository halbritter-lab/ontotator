// @vitest-environment node
import { describe, expect, it } from "vitest";
import { submissionHistoryLabel } from "../src/editor/submissionHistoryLabel";

describe("submission history labels", () => {
  const timestamp = new Date(2026, 9, 17, 9, 5).toISOString();
  it("formats an English date/time and displayed ordinal", () => {
    expect(submissionHistoryLabel(timestamp, 1)).toBe("Submission 1 · 17 Oct 2026, 09:05");
  });
  it("distinguishes submissions with matching timestamps", () => {
    expect(submissionHistoryLabel(timestamp, 2)).toBe("Submission 2 · 17 Oct 2026, 09:05");
  });
  it.each(["", "not-a-date", "2026-99-99T25:00:00Z"])("handles an invalid date safely: %s", value => {
    expect(submissionHistoryLabel(value, 3)).toBe("Submission 3 · Date unavailable");
  });
});
