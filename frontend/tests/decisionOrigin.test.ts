import { describe, expect, it } from "vitest";
import { autoNoteText, chooseDecision, reactToTextEdit, USER_ORIGIN } from "../src/translation/decisionOrigin";

const MACHINE = "Dosis 5 mg.";
describe("chooseDecision", () => {
  it("implies a clinical change for query and rejected and keeps categories and rationale", () => {
    expect(chooseDecision({ rationale: "r" }, "query")).toEqual({ rationale: "r", decision: "query", clinical_change: true });
    expect(chooseDecision({ decision: "query", clinical_change: true, categories: ["value"], rationale: "r" }, "rejected"))
      .toEqual({ decision: "rejected", clinical_change: true, categories: ["value"], rationale: "r" });
  });
  it("keeps clinical change and categories when switching to accepted with corrections", () => {
    expect(chooseDecision({ decision: "query", clinical_change: true, categories: ["value"], rationale: "r" }, "accepted_corrected"))
      .toEqual({ decision: "accepted_corrected", clinical_change: true, categories: ["value"], rationale: "r" });
  });
  it("clears clinical change and categories for accepted unchanged but keeps the rationale", () => {
    expect(chooseDecision({ decision: "rejected", clinical_change: true, categories: ["value"], rationale: "r" }, "accepted_unchanged"))
      .toEqual({ decision: "accepted_unchanged", clinical_change: false, categories: [], rationale: "r" });
  });
  it("keeps unknown raw keys untouched", () => {
    expect(chooseDecision({ extra: 1 }, "query")).toEqual({ extra: 1, decision: "query", clinical_change: true });
  });
});
describe("reactToTextEdit (spec A.4)", () => {
  it("selects accepted with corrections on the first difference when nothing is chosen", () => {
    const { state, form } = reactToTextEdit(USER_ORIGIN, {}, MACHINE, "Dosis 5 mg täglich.");
    expect(form).toEqual({ decision: "accepted_corrected" });
    expect(state).toEqual({ origin: { kind: "auto", previous: undefined }, note: { kind: "selected", from: undefined } });
    expect(autoNoteText(state.note)).toBe("Selected because you edited the translation. You can choose another decision.");
  });
  it("changes a user's accepted unchanged and names it", () => {
    const { state, form } = reactToTextEdit(USER_ORIGIN, { decision: "accepted_unchanged", clinical_change: false }, MACHINE, "x");
    expect(form).toEqual({ decision: "accepted_corrected", clinical_change: false });
    expect(autoNoteText(state.note)).toBe("Changed from Accepted unchanged because you edited the translation.");
  });
  it.each(["query", "rejected", "accepted_corrected"] as const)("leaves %s alone", (decision) => {
    const raw = { decision, clinical_change: decision !== "accepted_corrected" };
    const result = reactToTextEdit(USER_ORIGIN, raw, MACHINE, "x");
    expect(result.form).toEqual(raw); expect(result.state).toBe(USER_ORIGIN);
  });
  it("reverts an automatic selection when the text equals the machine text again", () => {
    const first = reactToTextEdit(USER_ORIGIN, {}, MACHINE, "x");
    const back = reactToTextEdit(first.state, first.form, MACHINE, MACHINE);
    expect(back.form).toEqual({}); // the decision key is removed
    expect(back.state).toEqual({ origin: { kind: "user" }, note: { kind: "reverted", to: undefined } });
    expect(autoNoteText(back.state.note)).toBe("Your edits are undone, so the decision is back to not chosen.");
    const fromUnchanged = reactToTextEdit(USER_ORIGIN, { decision: "accepted_unchanged", clinical_change: false }, MACHINE, "x");
    const undone = reactToTextEdit(fromUnchanged.state, fromUnchanged.form, MACHINE, MACHINE);
    expect(undone.form).toEqual({ decision: "accepted_unchanged", clinical_change: false, categories: [] });
    expect(autoNoteText(undone.state.note)).toBe("Your edits are undone, so the decision is back to Accepted unchanged.");
  });
  it("keeps a user's accepted with corrections when the edit is undone", () => {
    const raw = { decision: "accepted_corrected", clinical_change: false };
    expect(reactToTextEdit(USER_ORIGIN, raw, MACHINE, MACHINE)).toEqual({ state: USER_ORIGIN, form: raw });
  });
  it("returns the same state object for further edits while auto, so the note is announced once", () => {
    const first = reactToTextEdit(USER_ORIGIN, {}, MACHINE, "x");
    expect(reactToTextEdit(first.state, first.form, MACHINE, "xy").state).toBe(first.state);
  });
  it("compares canonically: BOM, CRLF and NFC differences are not edits", () => {
    expect(reactToTextEdit(USER_ORIGIN, {}, "a\nb\u00e9", "\ufeffa\r\nbe\u0301").form).toEqual({});
  });
  it("never overrides an unknown raw decision", () => {
    expect(reactToTextEdit(USER_ORIGIN, { decision: "legacy" }, MACHINE, "x").form).toEqual({ decision: "legacy" });
  });
});
