import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ImportPlan, type UploadView, type UploadWorkPlan as WorkPlan } from "../src/api/client";
import { UploadPanel } from "../src/admin/UploadPanel";
import { UploadWorkPlan, type UploadWorkPlanResult } from "../src/admin/UploadWorkPlan";

type PlanCase = WorkPlan["cases"][number];
const ids = (count: number, start = 1) => Array.from({ length: count }, (_, index) => `case-${String(start + index).padStart(4, "0")}`);
const source = (caseId: string): PlanCase => ({ case_id: caseId, language: "en", review: null, annotate: false, new_row: true, accepted: false, marked_in_package: false });
const translation = (caseId: string, language: string, extra: Partial<PlanCase> = {}): PlanCase => ({ case_id: caseId, language, review: true, annotate: true, new_row: true, accepted: false, marked_in_package: false, ...extra });

/** 50 cases with an en source and a de translation; fr for 30 of them, 18 marked as reviewed in the package. */
function workPlan(overrides: Partial<WorkPlan> = {}): WorkPlan {
  const cases = ids(50);
  return {
    setting: "review_and_annotate_translations",
    languages: [
      { key: "source", source_languages: ["en"], rows: 50, versions: 50, review: null, annotate: true, source_rule: "if_no_translation", marked_in_package: 0, not_accepted: 0 },
      { key: "de", source_languages: [], rows: 50, versions: 50, review: true, annotate: true, source_rule: null, marked_in_package: 0, not_accepted: 50 },
      { key: "fr", source_languages: [], rows: 30, versions: 30, review: true, annotate: true, source_rule: null, marked_in_package: 18, not_accepted: 12 },
    ],
    cases: [
      ...cases.map(source),
      ...cases.map(id => translation(id, "de")),
      ...cases.slice(0, 30).map((id, index) => index < 18 ? translation(id, "fr", { review: false, accepted: true, marked_in_package: true }) : translation(id, "fr")),
    ],
    existing_rows_kept: 0,
    ...overrides,
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderPlan(plan = workPlan(), props: Partial<Parameters<typeof UploadWorkPlan>[0]> = {}) {
  const onChange = vi.fn<(result: UploadWorkPlanResult) => void>();
  render(<UploadWorkPlan workPlan={plan} onChange={onChange} canAccept {...props} />);
  return onChange;
}
const last = (onChange: ReturnType<typeof renderPlan>) => onChange.mock.calls.at(-1)![0];

describe("UploadWorkPlan", () => {
  it("shows the work plan by language with chips prefilled from the project default", () => {
    const onChange = renderPlan();
    const section = screen.getByRole("region", { name: "Work plan" });
    const table = within(section).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map(item => item.textContent)).toEqual(["Language", "Versions in bundle", "Review", "Annotate"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map(row => row.querySelector("th,td")!.textContent)).toEqual(["Sources (50)", "de · MT (50)", "fr · MT (30)"]);
    expect(rows[0].textContent).toContain("–");
    expect(rows[0].textContent).toContain("if no translation");
    expect(within(rows[0]).getByRole("button", { name: "Annotate, Sources" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Review, de" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Annotate, fr" }).getAttribute("aria-pressed")).toBe("true");
    expect(last(onChange)).toEqual({ plan: { plan_languages: {}, plan_cases: [] }, blockedReason: null });
  });

  it("changes a whole language row with one chip click", () => {
    const onChange = renderPlan(workPlan({ setting: "nothing", languages: workPlan().languages.map(item => ({ ...item, review: item.review === null ? null : false, annotate: false, source_rule: null })) }));
    const review = screen.getByRole("button", { name: "Review, de" });
    expect(review.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(review);
    expect(review.getAttribute("aria-pressed")).toBe("true");
    expect(last(onChange).plan.plan_languages).toEqual({ de: { review: true, annotate: false } });
    fireEvent.click(screen.getByRole("button", { name: "Annotate, Sources" }));
    expect(last(onChange).plan.plan_languages).toEqual({ de: { review: true, annotate: false }, source: { review: null, annotate: true } });
  });

  it("offers per-case exceptions under Adjust per case…", async () => {
    const onChange = renderPlan();
    const disclosure = screen.getByText("Adjust per case…");
    fireEvent.click(disclosure);
    const chip = within(disclosure.closest("details")!).getByRole("button", { name: "Annotate, case-0002 · de" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(last(onChange).plan.plan_cases).toEqual([{ case_id: "case-0002", language: "de", review: true, annotate: false }]);
    fireEvent.click(screen.getByRole("button", { name: "Review, de" }));
    expect(screen.getByRole("button", { name: "Review, case-0001 · de" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("lists new language versions of existing cases with the default and keeps existing rows", () => {
    renderPlan(workPlan({
      languages: [workPlan().languages[2]], existing_rows_kept: 1,
      cases: [{ case_id: "case-0007", language: "de", review: false, annotate: true, new_row: false, accepted: true, marked_in_package: false }, translation("case-0007", "fr")],
    }));
    expect(screen.getByText("1 language version already in the project keeps its plan.")).toBeTruthy();
    fireEvent.click(screen.getByText("Adjust per case…"));
    const existing = screen.getByText("case-0007 · de").closest("tr")!;
    expect(existing.textContent).toContain("keeps its plan");
    expect(within(existing).queryAllByRole("button")).toEqual([]);
    expect(screen.getByRole("button", { name: "Review, case-0007 · fr" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("asks for the acceptance only while the rule is on", () => {
    renderPlan(workPlan(), { ruleOn: false });
    fireEvent.click(screen.getByRole("button", { name: "Review, fr" }));
    expect(screen.queryByRole("checkbox", { name: /reviewed outside Ontocurator/ })).toBeNull();
  });
});

describe("UploadPanel with a work plan", () => {
  const plan: ImportPlan = { input_sha256: "in", documents: [], duplicates: [], collisions: [], proposal_sets: [], documents_only: [], normalised_count: 0, errors: [], warnings: [], counts: { documents_added: 130 }, state_sha256: "s", plan_sha256: "real-plan", committable: true, work_plan: workPlan() };
  const view: UploadView = { id: 7, kind: "t1", language: null, files: [], status: "ready", preview: plan, plan_sha256: "real-plan", commit_job_id: null, created_at: "2026-10-16T10:00:00Z" };
  beforeEach(() => {
    vi.spyOn(api, "listUploads").mockResolvedValue([]);
    vi.spyOn(api, "createUpload").mockResolvedValue({ upload_id: 7, job_id: 11 });
    vi.spyOn(api, "getJob").mockResolvedValue({ id: 11, status: "succeeded", result: null, error: null, kind: "upload_preview", created_at: view.created_at, finished_at: view.created_at });
    vi.spyOn(api, "getUpload").mockResolvedValue(view);
    vi.spyOn(api, "commitUpload").mockResolvedValue({ upload_id: 7, job_id: 12 });
  });

  it("names the import button by count and blocks it with aria-disabled until the acceptance is resolved", async () => {
    render(<UploadPanel projectKey="p" languages={[]} onImported={vi.fn()} canOverrideTranslationStatus />);
    await userEvent.upload(screen.getByLabelText(/^Files/), new File(["{}"], "bundle.json"));
    fireEvent.submit(screen.getByRole("button", { name: "Check" }).closest("form")!);
    const importButton = await screen.findByRole("button", { name: "Import 50 cases" });
    expect(importButton.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review, fr" }));
    expect(screen.getByText("fr: 12 of 30 translations are not marked as reviewed in the package. Annotation needs an accepted translation.")).toBeTruthy();
    expect(screen.getByText(/18 already marked as reviewed in the package metadata need nothing\./)).toBeTruthy();
    expect(importButton.getAttribute("aria-disabled")).toBe("true");
    expect(importButton.hasAttribute("disabled")).toBe(false);
    const reason = document.getElementById(importButton.getAttribute("aria-describedby")!)!;
    expect(reason.textContent).toContain("fr");
    fireEvent.click(importButton);
    expect(api.commitUpload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "These translations were reviewed outside Ontocurator — accept them as they are" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Vendor batch" } });
    expect(importButton.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(importButton);
    await waitFor(() => expect(api.commitUpload).toHaveBeenCalledWith("p", 7, "real-plan", undefined, {
      plan_languages: { fr: { review: false, annotate: true } }, plan_cases: [], accept_external_review: { languages: ["fr"], reason: "Vendor batch" },
    }));
  });
});
