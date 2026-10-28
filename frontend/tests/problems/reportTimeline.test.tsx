import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportTimeline } from "../../src/problems/ReportTimeline";
import { event, hold, report } from "./fixtures";

afterEach(cleanup);

describe("ReportTimeline", () => {
  it("renders_an_ordered_list_with_a_time_per_item_and_quoted_reasons", () => {
    const { container } = render(<ReportTimeline report={report({ events: [event(), event({ event_id: "e2", action: "resolve", actor_label: "lead-0002", own_task: false, reason: "Fixed\nsecond line", created_at: "2026-10-19T01:31:00Z" })] })} />);
    const list = container.querySelector("ol.report-timeline");
    expect(list).toBeTruthy();
    const items = within(list as HTMLElement).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("You reported the problem. Your task paused.");
    expect(items.map(item => item.querySelector("time")?.getAttribute("datetime"))).toEqual(["2026-10-19T01:12:00Z", "2026-10-19T01:13:00Z", "2026-10-19T01:31:00Z"]);
    const quotes = container.querySelectorAll("blockquote.report-text");
    expect([...quotes].map(q => q.textContent)).toEqual(["upsi", "Fixed\nsecond line"]);
    quotes.forEach(q => expect(q.hasAttribute("lang")).toBe(false));
    expect(within(items[2]).getByText("Outcome")).toBeTruthy();
  });

  it("does_not_repeat_a_quote_label_already_in_the_sentence", () => {
    render(<ReportTimeline report={report({ viewer_is_lead: true, viewer_label: "lead-0002", events: [event({ action: "extend_hold", actor_label: "lead-0002", own_task: false, reason: "Wait", affected: [{ assignment_id: 7, owner_label: "ann-0005", case_id: "c", language: "de", task: "annotate" }] })] })} />);
    expect(screen.getAllByText(/Reason shown to their owners/)).toHaveLength(1);
  });

  it("shows_the_translation_draft_disclosure", () => {
    render(<ReportTimeline report={report({ events: [event({ action: "restart", actor_label: "lead-0002", round_ordinal: 3, abandoned_round_ordinal: 2, abandoned_translation_draft: { text: "Alter Entwurf", form: { target_language: "de", issues: ["a", "b"] } } })] })} />);
    expect(screen.getByText("Translation draft kept from before the restart").tagName).toBe("SUMMARY");
    expect(screen.getByText("Alter Entwurf")).toBeTruthy();
    expect(screen.getByText("target language")).toBeTruthy();
    expect(screen.getByText("a, b")).toBeTruthy();
  });

  it("reporter_view_never_shows_other_tasks", () => {
    // Lead events on other tasks arrive already redacted for the reporter: no affected list, own_task false.
    const redacted = report({ holds: [hold()], events: [
      event({ event_id: "e2", action: "extend_hold", actor_label: "lead-0002", own_task: false, reason: null }),
      event({ event_id: "e3", action: "resume", actor_label: "lead-0002", own_task: false, reason: null }),
      event({ event_id: "e4", action: "resolve", actor_label: "lead-0002", own_task: false, reason: "Done" }),
    ] });
    const { container } = render(<ReportTimeline report={redacted} />);
    expect(container.textContent).not.toContain("ann-0005");
    expect(container.textContent).not.toContain("Task 7");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("event actors use personLabel", () => {
    const lead = report({ viewer_is_lead: true, viewer_label: "lead-0002", reporter: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false }, events: [
      event({ event_id: "e2", actor_label: "lead-0002", actor: { pseudonym: "lead-0002", display_name: "Lea Lang", is_me: true }, own_task: false, reason: null,
        affected: [{ assignment_id: 7, owner_label: "ann-0005", case_id: "c", language: "de", task: "annotate" }] }),
      event({ event_id: "e3", action: "resolve", actor_label: "lead-0003", actor: { pseudonym: "lead-0003", display_name: "Max Mohr", is_me: false }, own_task: false, reason: null, created_at: "2026-10-19T01:31:00Z" }),
    ] });
    const { container } = render(<ReportTimeline report={lead} />);
    const items = [...container.querySelectorAll("li")].map(li => li.textContent);
    expect(items[0]).toContain("Ana Weber (ann-0004) reported the problem. Task 4 paused.");
    expect(items[1]).toContain("Lea Lang (lead-0002, you) released the pause on Task 7 (ann-0005).");
    expect(items[2]).toContain("Max Mohr (lead-0003) closed the report.");
    cleanup();
    // Reporters see the role, never the lead's name or pseudonym (D1).
    const reporterView = report({ events: [event({ event_id: "e3", action: "resolve", actor_label: "lead-0003", actor: { pseudonym: "lead-0003", display_name: "Max Mohr", is_me: false }, own_task: false, reason: null })] });
    const second = render(<ReportTimeline report={reporterView} />);
    expect(second.container.textContent).toContain("The project lead closed the report.");
    expect(second.container.textContent).not.toContain("lead-0003");
    expect(second.container.textContent).not.toContain("Max Mohr");
  });

  it("labels_the_list_with_an_optional_heading", () => {
    render(<ReportTimeline report={report()} headingLevel={3} />);
    expect(screen.getByRole("list", { name: "History" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "History" })).toBeTruthy();
  });
});
