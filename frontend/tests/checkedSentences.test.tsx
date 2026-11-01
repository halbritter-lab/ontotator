import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import type { RouteLeaveGuard } from "../src/app/router";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { resolveMarks, sentenceHash, splitSentences, storedMarks, toggled } from "../src/translation/sentences";
import { reviewWorkspace } from "./translationFixtures";

const SOURCE = "First source. Second source! Third source?";
const TRANSLATION = "Erster Satz. Zweiter Satz. Dritter Satz. Vierter Satz.";
const KEY = "ontotator.translationReview.markChecked.v1:alice";

// jsdom has no PointerEvent; without it button, shiftKey and pointerId would be dropped.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;
}

afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(changes: Parameters<typeof reviewWorkspace>[0] = {}, marking = true) {
  if (marking) window.localStorage.setItem(KEY, "1");
  const base = reviewWorkspace();
  const workspace = reviewWorkspace({ text: TRANSLATION, draft: { ...base.draft, text: TRANSLATION }, source: { ...base.source, text: SOURCE }, ...changes });
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width/.test(query), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  const saveDraft = vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 7 });
  const saveMarks = vi.spyOn(api, "saveCheckedSentences").mockImplementation(async (_id, body) => body);
  const routeLeaveRef: { current: RouteLeaveGuard | null } = { current: null };
  const leaveGuardRef: { current: ((proceed: () => void) => void) | null } = { current: null };
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={routeLeaveRef} leaveGuardRef={leaveGuardRef} />);
  return { saveDraft, saveMarks };
}
const region = (name: string) => screen.getByRole("region", { name });
const sentences = (name: string) => [...region(name).querySelectorAll<HTMLElement>("[data-sentence]")];
const pressed = (name: string) => sentences(name).map(element => element.getAttribute("aria-pressed") === "true");
const counter = () => [...document.querySelectorAll(".sentence-count")].map(element => element.textContent).join(" / ");
function click(element: HTMLElement, init: PointerEventInit = {}) {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, ...init });
  fireEvent.pointerUp(element, { button: 0, pointerId: 1, ...init });
}
function drag(from: HTMLElement, over: HTMLElement[]) {
  fireEvent.pointerDown(from, { button: 0, pointerId: 2 });
  for (const element of over) fireEvent.pointerMove(element, { pointerId: 2 });
  fireEvent.pointerUp(over.at(-1) ?? from, { pointerId: 2 });
}

describe("sentence splitting", () => {
  it("splits one long paragraph into sentences with and without Intl.Segmenter", () => {
    for (const segmenter of [true, false]) {
      const parts = splitSentences("One sentence here. Another one follows! And a third? Yes.", "en", { segmenter });
      expect(parts.map(part => part.text)).toEqual(["One sentence here.", "Another one follows!", "And a third?", "Yes."]);
    }
  });
  it("does not end a sentence at an abbreviation", () => {
    const de = "Aufnahme durch Dr. Müller am 3. Mai. V. a. Pneumonie, z. B. mit Fieber bis ca. 39 °C. Keine Allergien.";
    for (const segmenter of [true, false]) {
      expect(splitSentences(de, "de", { segmenter }).map(part => part.text)).toEqual(["Aufnahme durch Dr. Müller am 3. Mai.", "V. a. Pneumonie, z. B. mit Fieber bis ca. 39 °C.", "Keine Allergien."]);
      expect(splitSentences("The dose was 5. Seen by Dr. Smith.", "en", { segmenter }).map(part => part.text)).toEqual(["The dose was 5.", "Seen by Dr. Smith."]);
    }
  });
  it("never lets a sentence span a line break and keeps offsets exact", () => {
    const text = "Kopf\n\nErster Satz. Zweiter Satz.\nLetzter";
    const parts = splitSentences(text, "de");
    expect(parts.map(part => part.text)).toEqual(["Kopf", "Erster Satz.", "Zweiter Satz.", "Letzter"]);
    for (const part of parts) expect(text.slice(part.start, part.end)).toBe(part.text);
  });
  it("matches a moved sentence by hash and makes an edited one stale", () => {
    const before = splitSentences("A one. B two. C three.", "en");
    const marks = storedMarks(before, toggled(toggled(before.map(() => null), 0), 2));
    const moved = splitSentences("New first. A one. B two. C three.", "en");
    expect(resolveMarks(moved, marks).map(state => state?.kind ?? null)).toEqual([null, "checked", null, "checked"]);
    const edited = splitSentences("A one. B two. C changed.", "en");
    expect(resolveMarks(edited, marks)).toEqual([{ kind: "checked" }, null, { kind: "stale", hash: sentenceHash("C three.") }]);
  });
});

describe("Mark checked sentences", () => {
  it("is off by default: texts behave as today and the choice is remembered", async () => {
    const { saveMarks } = setup({}, false);
    const toggle = await screen.findByRole("checkbox", { name: "Mark checked sentences" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByRole("textbox", { name: "Translation (de)" })).toBeDefined();
    expect(region("Source (en)").querySelector("[data-sentence]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next unchecked" })).toBeNull();
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(KEY)).toBe("1");
    expect(screen.queryByRole("textbox", { name: "Translation (de)" })).toBeNull();
    expect(sentences("Source (en)")).toHaveLength(3);
    expect(sentences("Translation (de)")).toHaveLength(4);
    expect((screen.getByRole("checkbox", { name: "Show changes" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(KEY)).toBe("0");
    expect(screen.getByRole("textbox", { name: "Translation (de)" })).toBeDefined();
    expect(saveMarks).not.toHaveBeenCalled();
  });

  it("click toggles one side only and saves the marks without a draft save", async () => {
    const { saveMarks, saveDraft } = setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    vi.useFakeTimers();
    click(sentences("Translation (de)")[1]);
    expect(pressed("Translation (de)")).toEqual([false, true, false, false]);
    expect(pressed("Source (en)")).toEqual([false, false, false]);
    expect(sentences("Translation (de)")[1].className).toContain("is-checked");
    expect(counter()).toBe("Source: 0 of 3 checked / Translation: 1 of 4 checked");
    click(sentences("Translation (de)")[1]);
    expect(pressed("Translation (de)")).toEqual([false, false, false, false]);
    click(sentences("Source (en)")[2]);
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(saveMarks).toHaveBeenCalledTimes(1);
    expect(saveMarks).toHaveBeenLastCalledWith(17, { source: [{ index: 2, hash: sentenceHash("Third source?") }], translation: [] });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("Shift+click and Shift+Enter mark the range from the last clicked sentence", async () => {
    setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    click(sentences("Translation (de)")[0]);
    click(sentences("Translation (de)")[2], { shiftKey: true });
    expect(pressed("Translation (de)")).toEqual([true, true, true, false]);
    fireEvent.keyDown(sentences("Source (en)")[0], { key: "Enter" });
    expect(pressed("Source (en)")).toEqual([true, false, false]);
    fireEvent.keyDown(sentences("Source (en)")[2], { key: "Enter", shiftKey: true });
    expect(pressed("Source (en)")).toEqual([true, true, true]);
    fireEvent.keyDown(sentences("Source (en)")[1], { key: " " });
    expect(pressed("Source (en)")).toEqual([true, false, true]);
    // The submit shortcut leaves the marks alone.
    fireEvent.keyDown(sentences("Source (en)")[1], { key: "Enter", ctrlKey: true });
    expect(pressed("Source (en)")).toEqual([true, false, true]);
  });

  it("drag from an unchecked sentence marks the range and from a checked one unmarks it", async () => {
    setup();
    await screen.findByRole("button", { name: "Next unchecked" });
    const items = () => sentences("Translation (de)");
    fireEvent.pointerDown(items()[0], { button: 0, pointerId: 3 });
    fireEvent.pointerMove(items()[2], { pointerId: 3 });
    // The live range shows what the release will do.
    expect(items().slice(0, 3).every(element => element.className.includes("is-range-mark"))).toBe(true);
    expect(items()[3].className).not.toContain("is-range");
    fireEvent.pointerUp(items()[2], { pointerId: 3 });
    expect(pressed("Translation (de)")).toEqual([true, true, true, false]);
    drag(items()[3], [items()[2], items()[1]]);
    // Started on an unchecked sentence: everything passed is checked.
    expect(pressed("Translation (de)")).toEqual([true, true, true, true]);
    drag(items()[2], [items()[1]]);
    expect(pressed("Translation (de)")).toEqual([true, false, false, true]);
    expect(pressed("Source (en)")).toEqual([false, false, false]);
  });

  it("shows stored marks, an edited checked sentence as changed since checked, and Next unchecked", async () => {
    const translation = splitSentences(TRANSLATION, "de");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    setup({
      draft: { text: "Erster Satz. Zweiter Satz geändert. Dritter Satz. Vierter Satz.", form: {}, revision: 6 },
      checked_sentences: { source: [{ index: 0, hash: sentenceHash("First source.") }], translation: [0, 1, 3].map(index => ({ index, hash: translation[index].hash })) },
    });
    await screen.findByRole("button", { name: "Next unchecked" });
    const items = sentences("Translation (de)");
    expect(pressed("Translation (de)")).toEqual([true, false, false, true]);
    expect(items[1].className).toContain("is-stale");
    expect(items[1].textContent).toContain("changed since checked");
    expect(counter()).toBe("Source: 1 of 3 checked / Translation: 2 of 4 checked · 1 changed");
    fireEvent.click(screen.getByRole("button", { name: "Next unchecked" }));
    expect(document.activeElement).toBe(items[1]);
    expect(scroll).toHaveBeenCalled();
    click(items[1]);
    expect(sentences("Translation (de)")[1].className).toContain("is-checked");
    expect(counter()).toBe("Source: 1 of 3 checked / Translation: 3 of 4 checked");
    fireEvent.click(screen.getByRole("button", { name: "Next unchecked" }));
    expect(document.activeElement).toBe(sentences("Translation (de)")[2]);
  });

  it("an edit after checking makes the mark stale until it is ticked again", async () => {
    setup({}, false);
    const toggle = await screen.findByRole("checkbox", { name: "Mark checked sentences" });
    fireEvent.click(toggle);
    click(sentences("Translation (de)")[0]);
    click(sentences("Translation (de)")[3]);
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("textbox", { name: "Translation (de)" }), { target: { value: "Erster Satz neu. Zweiter Satz. Dritter Satz. Vierter Satz." } });
    fireEvent.click(toggle);
    expect(sentences("Translation (de)")[0].className).toContain("is-stale");
    expect(sentences("Translation (de)")[3].className).toContain("is-checked");
    expect(counter()).toBe("Source: 0 of 3 checked / Translation: 1 of 4 checked · 1 changed");
  });

  it("is not offered on a touch-only device", async () => {
    setup();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: /min-width|pointer: coarse/.test(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    cleanup();
    render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
    await screen.findByRole("checkbox", { name: "Show changes" });
    expect(screen.queryByRole("checkbox", { name: "Mark checked sentences" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next unchecked" })).toBeNull();
  });

  it("is not offered on a read-only review", async () => {
    setup({ read_only: true, assignment: { ...reviewWorkspace().assignment, status: "submitted" } });
    await screen.findByRole("region", { name: "Source (en)" });
    expect(screen.queryByRole("checkbox", { name: "Mark checked sentences" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next unchecked" })).toBeNull();
  });
});
