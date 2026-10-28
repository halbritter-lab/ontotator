import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../src/api/client";
import { ReportAnswerNotice } from "../../src/problems/ReportAnswerNotice";
import { event, report } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

const closed = (answered: boolean) => report({ state: "resolved", resolution: "Word restored", state_changed_by_label: "lead-0002", answered,
  events: [event({ event_id: "e2", action: "resolve", actor_label: "lead-0002", reason: "Word restored" })] });

it("shows a lead's answer on the task page after the answer was read elsewhere, until dismissed", async () => {
  const list = vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([closed(false)]);
  const seen = vi.spyOn(api, "markProblemReportSeen");
  render(<ReportAnswerNotice projectKey="p" assignmentId={4} held={false} onNavigate={vi.fn()} />);
  expect(await screen.findByText(/Your problem report was answered by the project lead: Word restored\. You can continue\./)).toBeDefined();
  expect(list).toHaveBeenCalledWith("p", 4);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
  expect(screen.queryByText(/was answered/)).toBeNull();
  expect(seen).not.toHaveBeenCalled(); // already read
  cleanup();
  render(<ReportAnswerNotice projectKey="p" assignmentId={4} held={false} onNavigate={vi.fn()} />);
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(screen.queryByText(/was answered/)).toBeNull(); // dismissal is remembered
});

it("dismissing an unread answer marks it seen", async () => {
  vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([closed(true)]);
  const seen = vi.spyOn(api, "markProblemReportSeen").mockResolvedValue(closed(false));
  render(<ReportAnswerNotice projectKey="p" assignmentId={4} held={false} onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Dismiss message" }));
  expect(seen).toHaveBeenCalledWith("r1");
});
