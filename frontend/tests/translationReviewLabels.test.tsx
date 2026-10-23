import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { TranslationReviewScreen } from "../src/translation/TranslationReviewScreen";
import { reviewRecord, reviewWorkspace } from "./translationFixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("labels the source and translation columns with language flags instead of codes in brackets (V3)", async () => {
  const workspace = reviewWorkspace();
  vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })));
  vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
  vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 41 });
  vi.spyOn(api, "submitTranslationReview").mockResolvedValue(reviewRecord());
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ ...workspace.variant, translation: null, version: 7, assigned_to_me: false });
  render(<TranslationReviewScreen assignmentId={17} username="alice" onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);

  // The text box keeps its full name for assistive technology.
  const box = await screen.findByRole("textbox", { name: "Translation (de)" });
  // A real (visually hidden) label, not a `hidden` one: axe label-title-only.
  const label = document.querySelector<HTMLLabelElement>(`label[for="${box.id}"]`)!;
  expect(label.textContent).toBe("Translation (de)");
  expect(label.hidden).toBe(false);
  expect(label.className).toBe("visually-hidden");
  const titles = [...document.querySelectorAll<HTMLElement>(".translation-column-title")];
  expect(titles.map(title => title.textContent)).toEqual(["Source en", "Translation de"]);
  expect(titles[0].querySelector(".language-tag [data-flag]")).not.toBeNull();
  expect(titles[1].querySelector(".language-tag [data-flag]")).not.toBeNull();
});
