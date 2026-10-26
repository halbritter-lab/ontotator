import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CarriedInputLike, CarriedState, CheckVariant, ResolutionLike } from "../../src/editor/carried/checkState";
import { CarriedChecksReadOnly } from "../../src/editor/carried/CarriedChecksReadOnly";
import { CarriedSection, type CarriedError } from "../../src/editor/carried/CarriedSection";
import { ExceptionPanel } from "../../src/editor/carried/ExceptionPanel";
import { SESSION_ENDED_MESSAGE } from "../../src/editor/autosave";

const input: CarriedInputLike = {
  input_id: "in-1",
  source_submission_id: "sub-1",
  source_snapshot: { annotation: { annotation_id: "a-1", layer_id: "hpo", type_id: "phenotype", term_id: "HP:0001250" }, version: "v1" },
  target_snapshot: { annotation: { annotation_id: "a-1", layer_id: "hpo", type_id: "phenotype", term_id: "HP:0001250" }, version: "v1" },
  mapping_status: "carried",
  source_round_ordinal: 2,
};

function stateOf(variant: CheckVariant, resolution?: ResolutionLike, home: CarriedState["home"] = "carried"): CarriedState {
  const unchecked = variant === "needed" || variant === "changed" || variant === "removed";
  return {
    input, index: 0, variant, unchecked, resolution, home,
    homeId: home === "placeholder" ? null : "a-1",
    carriedId: home === "placeholder" ? null : "a-1",
    missing: home === "placeholder" ? "mapping_failed" : null,
  };
}

const whatToCheck = {
  textSpan: "Same text as in Round 2 (de v1).",
  values: ["Carried unchanged. Carrying does not confirm values."],
  noteFirstLine: "First line",
};

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function section(overrides: Partial<Parameters<typeof CarriedSection>[0]> = {}) {
  return <CarriedSection
    state={stateOf("needed")}
    origin="Carried from Round 2"
    recordedAt="2026-10-19T00:57:00Z"
    whatToCheck={whatToCheck}
    readOnly={false}
    onMarkChecked={vi.fn().mockResolvedValue(undefined)}
    onShowOriginal={vi.fn()}
    onDismiss={vi.fn().mockResolvedValue(true)}
    {...overrides}
  />;
}

describe("CarriedSection", () => {
  it("unchecked_layout_and_first_tab_stop", async () => {
    const user = userEvent.setup();
    render(<><button>before</button>{section({ whatToCheck: { ...whatToCheck, noteFull: "First line\nSecond line" } })}</>);
    const region = screen.getByRole("region", { name: "Carried finding" });
    expect(within(region).getByRole("heading", { level: 3, name: "Carried finding" })).toBeTruthy();
    expect(within(region).getByText("Check needed")).toBeTruthy();
    expect(region.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-19T00:57:00Z");
    const terms = Array.from(region.querySelectorAll("dt")).map(node => node.textContent);
    expect(terms).toEqual(["Text span", "Values", "Note"]);
    expect(within(region).getByText("Any later change to this finding needs a new check.")).toBeTruthy();
    screen.getByRole("button", { name: "before" }).focus();
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Mark as checked");
    expect(document.activeElement?.hasAttribute("data-carried-primary")).toBe(true);
    // Main actions are only "Mark as checked" and "Show original evidence" plus the quiet dismissal.
    expect(within(region).getByRole("button", { name: "Show original evidence" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Does not apply…" })).toBeTruthy();
  });

  it("shows_and_hides_the_full_note", () => {
    render(section({ whatToCheck: { ...whatToCheck, noteFull: "First line\nSecond line" } }));
    const toggle = screen.getByRole("button", { name: "Show full note" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide full note" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Second line/)).toBeTruthy();
  });

  it("omits_the_note_term_without_a_note", () => {
    render(section({ whatToCheck: { textSpan: "x", values: ["y"] } }));
    expect(Array.from(document.querySelectorAll("dt")).map(node => node.textContent)).toEqual(["Text span", "Values"]);
  });

  it("changed_variant_adds_the_check_again_line", () => {
    render(section({ state: stateOf("changed") }));
    expect(screen.getByText("You changed this finding after checking it. Check it again.")).toBeTruthy();
  });

  it("focuses_the_collapsed_line_after_the_check", async () => {
    const check = deferred();
    const onMarkChecked = vi.fn(() => check.promise);
    const onNext = vi.fn();
    const { rerender } = render(section({ onMarkChecked, onNextUnchecked: onNext }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as checked" }));
    await act(async () => { check.resolve(); await check.promise; });
    rerender(section({ state: stateOf("checked"), onMarkChecked, onNextUnchecked: onNext }));
    expect(document.activeElement?.hasAttribute("data-carried-collapsed")).toBe(true);
    expect(document.activeElement?.textContent).toContain("Checked, Carried from Round 2");
    expect(screen.queryByRole("button", { name: "Mark as checked" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show original evidence" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next unchecked/ }));
    expect(onNext).toHaveBeenCalled();
  });

  it("does_not_steal_focus_when_rendered_checked", () => {
    render(section({ state: stateOf("checked") }));
    expect(document.activeElement?.hasAttribute("data-carried-collapsed")).toBe(false);
    expect(screen.queryByRole("button", { name: /Next unchecked/ })).toBeNull();
  });

  it("busy_keeps_focus_and_blocks_other_check_actions", async () => {
    const check = deferred();
    const onMarkChecked = vi.fn(() => check.promise);
    render(section({ onMarkChecked }));
    const primary = screen.getByRole("button", { name: "Mark as checked" });
    primary.focus();
    fireEvent.click(primary);
    expect(primary.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(primary);
    fireEvent.click(primary);
    expect(onMarkChecked).toHaveBeenCalledTimes(1);
    const show = screen.getByRole("button", { name: "Show original evidence" });
    expect(show.getAttribute("aria-disabled")).toBeNull();
    expect((show as HTMLButtonElement).disabled).toBe(false);
    const dismiss = screen.getByRole("button", { name: "Does not apply…" });
    expect(dismiss.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(dismiss);
    expect(screen.queryByRole("group", { name: "Dismiss carried finding" })).toBeNull();
    await act(async () => { check.resolve(); await check.promise; });
    expect(primary.getAttribute("aria-disabled")).toBeNull();
  });

  it("a_rejected_check_clears_busy", async () => {
    const check = deferred();
    render(section({ onMarkChecked: () => check.promise }));
    const primary = screen.getByRole("button", { name: "Mark as checked" });
    fireEvent.click(primary);
    await act(async () => { check.reject(new Error("x")); await check.promise.catch(() => undefined); });
    expect(primary.getAttribute("aria-disabled")).toBeNull();
  });

  it.each<[CarriedError, string]>([
    [{ kind: "stale" }, "This finding changed before the check was saved. Check it again."],
    [{ kind: "rejected", message: "Mapped server message." }, "Mapped server message."],
  ])("error_%#_keeps_mark_as_checked_available", (error, text) => {
    render(section({ error, onRetry: vi.fn() }));
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark as checked" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("network_error_offers_retry_only", () => {
    const onRetry = vi.fn();
    const onMarkChecked = vi.fn().mockResolvedValue(undefined);
    render(section({ error: { kind: "network" }, onRetry, onMarkChecked }));
    expect(screen.getByText("Could not save the check. Nothing changed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
    const primary = screen.getByRole("button", { name: "Mark as checked" });
    expect(primary.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(primary);
    expect(onMarkChecked).not.toHaveBeenCalled();
  });

  it("session_error_has_no_retry", () => {
    render(section({ error: { kind: "session" }, onRetry: vi.fn() }));
    expect(screen.getByText(SESSION_ENDED_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark as checked" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("note_error_offers_save_note_and_check", async () => {
    const onSaveNoteAndCheck = vi.fn().mockResolvedValue(undefined);
    render(section({ error: { kind: "note", action: "check" }, onSaveNoteAndCheck }));
    expect(screen.getByText("Save the note first.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save note and mark as checked" })); });
    expect(onSaveNoteAndCheck).toHaveBeenCalled();
  });

  it("note_error_of_a_dismissal_does_not_offer_mark_as_checked", () => {
    render(section({ error: { kind: "note", action: "dismiss" }, onSaveNoteAndCheck: vi.fn() }));
    expect(screen.getByText("Save the note first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save note and mark as checked" })).toBeNull();
  });

  it("read_only_paused_has_no_check_actions", () => {
    render(section({ readOnly: "paused" }));
    expect(screen.queryByRole("button", { name: "Mark as checked" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Does not apply…" })).toBeNull();
    expect(screen.getByText("Checks are unavailable while the task is paused.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show original evidence" })).toBeTruthy();
    expect(screen.getByText("Check needed")).toBeTruthy();
  });

  it("read_only_submitted_has_no_paused_sentence", () => {
    render(section({ readOnly: "submitted", state: stateOf("checked") }));
    expect(screen.queryByText("Checks are unavailable while the task is paused.")).toBeNull();
    expect(screen.getByText("Checked")).toBeTruthy();
  });

  it("dismiss_requires_a_reason", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn().mockResolvedValue(true);
    render(section({ onDismiss }));
    await user.click(screen.getByRole("button", { name: "Does not apply…" }));
    const group = screen.getByRole("group", { name: "Dismiss carried finding" });
    expect(within(group).getByText("It is removed from this text and recorded as dismissed with your reason.")).toBeTruthy();
    const confirm = within(group).getByRole("button", { name: "Dismiss" });
    await user.click(confirm);
    expect(within(group).getByText("Give a reason to dismiss this finding.")).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
    const field = within(group).getByLabelText(/Why does this finding not apply to this text\?/);
    expect(field.getAttribute("rows")).toBe("3");
    await user.type(field, "Not here");
    await user.click(confirm);
    expect(onDismiss).toHaveBeenCalledWith("Not here");
  });

  it("a_dismissal_that_was_not_applied_keeps_the_confirm_and_reason", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn().mockResolvedValue(false);
    render(section({ onDismiss }));
    await user.click(screen.getByRole("button", { name: "Does not apply…" }));
    const group = screen.getByRole("group", { name: "Dismiss carried finding" });
    await user.type(within(group).getByLabelText(/Why does this finding not apply/), "Not here");
    await user.click(within(group).getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("Not here");
    const still = screen.getByRole("group", { name: "Dismiss carried finding" });
    expect((within(still).getByLabelText(/Why does this finding not apply/) as HTMLTextAreaElement).value).toBe("Not here");
  });

  it("escape_cancels_the_dismissal_and_returns_focus", async () => {
    const user = userEvent.setup();
    render(section());
    const trigger = screen.getByRole("button", { name: "Does not apply…" });
    await user.click(trigger);
    await user.click(screen.getByLabelText(/Why does this finding not apply/));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Dismiss carried finding" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

const original = {
  term: "Seizure",
  values: [{ label: "Assertion", value: "Present" }],
  note: "Seen twice",
  quote: "Krampfanfälle werden beobachtet",
};

const candidates = [
  { annotationId: "own", version: "v3", label: "Seizure, “Krampfanfälle werden …”", technicalId: "own" },
  { annotationId: "other", version: "v1", label: "Seizure, no text span", technicalId: "other" },
];

function panel(overrides: Partial<Parameters<typeof ExceptionPanel>[0]> = {}) {
  return <ExceptionPanel
    state={stateOf("needed", undefined, "placeholder")}
    origin="Carried from Round 2"
    reason="Its text span could not be found in this text."
    original={original}
    candidates={candidates}
    readOnly={false}
    onMarkInText={vi.fn()}
    onLink={vi.fn().mockResolvedValue(true)}
    onDismiss={vi.fn().mockResolvedValue(true)}
    onUndoDismissal={vi.fn().mockResolvedValue(undefined)}
    onShowOriginal={vi.fn()}
    {...overrides}
  />;
}

describe("ExceptionPanel", () => {
  it("shows_reason_original_and_actions_in_order", () => {
    const onMarkInText = vi.fn();
    render(panel({ onMarkInText }));
    const region = screen.getByRole("region", { name: "Carried finding" });
    expect(within(region).getByText("Check needed")).toBeTruthy();
    expect(within(region).getByText("Its text span could not be found in this text.")).toBeTruthy();
    expect(within(region).getByText((_, el) => el?.tagName === "LI" && el.textContent === "Assertion: Present")).toBeTruthy();
    expect(within(region).getByText("“Krampfanfälle werden beobachtet”")).toBeTruthy();
    const primary = within(region).getByRole("button", { name: "Mark in text" });
    expect(primary.hasAttribute("data-carried-primary")).toBe(true);
    const actions = Array.from(region.querySelectorAll(".carried-actions button")).map(node => node.textContent);
    expect(actions).toEqual(["Mark in text", "Link to an existing finding…", "Dismiss with reason…"]);
    expect(within(region).getByRole("button", { name: "Dismiss with reason…" }).hasAttribute("data-carried-dismiss")).toBe(true);
    fireEvent.click(primary);
    expect(onMarkInText).toHaveBeenCalled();
  });

  it("shows_no_text_span_without_a_quote", () => {
    render(panel({ original: { ...original, quote: null } }));
    expect(screen.getByText("No text span")).toBeTruthy();
  });

  it("link_chooser_is_a_radio_group", async () => {
    const user = userEvent.setup();
    const onLink = vi.fn().mockResolvedValue(true);
    render(panel({ onLink }));
    await user.click(screen.getByRole("button", { name: "Link to an existing finding…" }));
    const group = screen.getByRole("group", { name: "Link to an existing finding" });
    expect(within(group).getByRole("radio", { name: "Seizure, “Krampfanfälle werden …”" })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: "Seizure, no text span" })).toBeTruthy();
    expect(within(group).getAllByText("Technical details")).toHaveLength(2);
    expect(screen.queryByRole("combobox")).toBeNull();
    await user.click(within(group).getByRole("radio", { name: "Seizure, “Krampfanfälle werden …”" }));
    await user.click(screen.getByRole("button", { name: "Link and mark as checked" }));
    expect(onLink).toHaveBeenCalledWith("own");
    // Linked: the chooser closes and focus returns to its trigger, never to the body.
    expect(screen.queryByRole("group", { name: "Link to an existing finding" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Link to an existing finding…" });
    expect(trigger.hasAttribute("data-carried-link")).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("a_link_that_was_not_applied_keeps_the_chooser_open", async () => {
    const user = userEvent.setup();
    const onLink = vi.fn().mockResolvedValue(false);
    render(panel({ onLink }));
    await user.click(screen.getByRole("button", { name: "Link to an existing finding…" }));
    await user.click(screen.getByRole("radio", { name: "Seizure, no text span" }));
    await user.click(screen.getByRole("button", { name: "Link and mark as checked" }));
    expect(onLink).toHaveBeenCalledWith("other");
    const group = screen.getByRole("group", { name: "Link to an existing finding" });
    expect(within(group).getByRole("radio", { name: "Seizure, no text span" })).toHaveProperty("checked", true);
  });

  it("link_cancel_returns_focus_to_the_trigger", async () => {
    const user = userEvent.setup();
    render(panel());
    const trigger = screen.getByRole("button", { name: "Link to an existing finding…" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Link to an existing finding" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("link_chooser_without_candidates_offers_no_confirm", async () => {
    const user = userEvent.setup();
    render(panel({ candidates: [] }));
    await user.click(screen.getByRole("button", { name: "Link to an existing finding…" }));
    expect(screen.getByText("No finding of this type exists on this text. Mark it in the text first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link and mark as checked" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("dismiss_with_reason", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn().mockResolvedValue(true);
    render(panel({ onDismiss }));
    await user.click(screen.getByRole("button", { name: "Dismiss with reason…" }));
    const group = screen.getByRole("group", { name: "Dismiss carried finding" });
    await user.click(within(group).getByRole("button", { name: "Dismiss" }));
    expect(within(group).getByText("Give a reason to dismiss this finding.")).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
    await user.type(within(group).getByLabelText(/Why does this finding not apply/), "Not here");
    await user.click(within(group).getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("Not here");
  });

  it("dismissed_state_offers_undo_and_link", async () => {
    const user = userEvent.setup();
    const onUndoDismissal = vi.fn().mockResolvedValue(undefined);
    render(panel({ state: stateOf("dismissed", { input_id: "in-1", outcome: "dismissed", reason: "Not here" }, "placeholder"), onUndoDismissal }));
    expect(screen.getByText("Dismissed")).toBeTruthy();
    expect(screen.getByText("Dismissal reason: Not here")).toBeTruthy();
    expect(screen.getByText("Dismissed by You")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss with reason…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Link to an existing finding…" })).toBeTruthy();
    const undo = screen.getByRole("button", { name: "Undo dismissal" });
    expect(undo.hasAttribute("data-carried-undo")).toBe(true);
    await user.click(undo);
    expect(onUndoDismissal).toHaveBeenCalled();
  });

  it("read_only_dismissed_does_not_name_you", () => {
    render(panel({ readOnly: "submitted", state: stateOf("dismissed", { input_id: "in-1", outcome: "dismissed", reason: "Not here" }, "placeholder") }));
    expect(screen.queryByText("Dismissed by You")).toBeNull();
    expect(screen.getAllByText("Dismissed")).toHaveLength(2);
  });

  it("note_error_offers_save_note", async () => {
    const onSaveNote = vi.fn().mockResolvedValue(undefined);
    render(panel({ error: { kind: "note", action: "link" }, onSaveNote }));
    expect(screen.getByText("Save the note first.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save note" })); });
    expect(onSaveNote).toHaveBeenCalled();
  });

  it("read_only_paused_has_no_actions", () => {
    render(panel({ readOnly: "paused" }));
    expect(screen.queryByRole("button", { name: "Mark in text" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Link to an existing finding…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss with reason…" })).toBeNull();
    expect(screen.getByText("Checks are unavailable while the task is paused.")).toBeTruthy();
  });

  it("shows_the_section_error", () => {
    render(panel({ error: { kind: "stale" } }));
    expect(screen.getByText("This finding changed before the check was saved. Check it again.")).toBeTruthy();
  });
});

describe("CarriedChecksReadOnly", () => {
  it("lists_badges_origins_and_dismissal_reasons", () => {
    render(<CarriedChecksReadOnly items={[
      { term: "Seizure", state: "dismissed", reason: "Not here", origin: "Carried from Round 2" },
      { term: "Ataxia", state: "checked", origin: "Carried from Round 2" },
      { term: "Fever", state: "needed", origin: "Carried from Round 1" },
    ]} />);
    const region = screen.getByRole("region", { name: "Carried findings" });
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Dismissed")).toBeTruthy();
    expect(within(items[0]).getByText("Dismissal reason: Not here")).toBeTruthy();
    expect(within(items[1]).getByText("Checked")).toBeTruthy();
    expect(within(items[2]).getByText("Check needed")).toBeTruthy();
    expect(within(items[2]).getByText("Carried from Round 1")).toBeTruthy();
  });
});
