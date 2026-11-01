import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../../src/api/client";
import { ReporterReportPage } from "../../src/problems/ReporterReportPage";
import { report } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows the reporter's own report from a direct link and marks it seen (#49 R-26)", async () => {
  const seen = vi.spyOn(api, "markProblemReportSeen").mockResolvedValue(report({ state: "resolved", resolution: "Source fixed", answered: false }));
  const onNavigate = vi.fn();
  render(<ReporterReportPage reportId="r1" onNavigate={onNavigate} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Text is cut off after the second paragraph" })).toBeDefined();
  expect(seen).toHaveBeenCalledWith("r1");
  expect(screen.getByText(/Outcome: Source fixed/)).toBeDefined();
  fireEvent.click(screen.getByRole("link", { name: "Open your task on accepted-translation de" }));
  expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 4 });
});

it("says not found for a report that is not the viewer's", async () => {
  vi.spyOn(api, "markProblemReportSeen").mockRejectedValue(new ApiError(404, "Not found", "REPORT_NOT_FOUND"));
  render(<ReporterReportPage reportId="other" onNavigate={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "Problem report not found or no access" })).toBeDefined();
});
